/** Read-only agent draft gallery and preview; the composition owns guarded adoption. */
import { button, element } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ProjectApi } from '../project/project-api.mts';
import { array, record, string } from '../shared/decode.mts';
import { decodeCandidate, type Candidate } from './artwork-contracts.mts';
import { artworkPng } from './artwork-png.mts';

/** Export at most two full envelopes concurrently; retain only small gallery canvases. */
const THUMBNAIL_CONCURRENCY = 2;
const THUMBNAIL_AXIS = 192;
type Handle = Record<string, unknown>;

export function createAgentDrafts(
  lifetime: EditorLifetime,
  api: ProjectApi['json'],
  ports: {
    available: () => boolean;
    run: (work: () => Promise<void>) => Promise<void>;
    adopt: (handle: Handle) => Promise<void>;
    download: (value: unknown, name: string) => void;
    focusEditor: () => void;
  },
) {
  const gallery = element('art-handoff-candidates', HTMLElement);
  const status = element('art-agent-status', HTMLElement);
  const dialog = element('art-agent-preview', HTMLDialogElement);
  const previewStatus = element('art-agent-preview-status', HTMLElement);
  const image = element('art-agent-image', HTMLElement);
  let listing = 0;
  let previewRequest = 0;
  let selected: Handle | null = null;
  let preview: Candidate | null = null;
  let adopting = false;
  let reading = false;
  let thumbnailGeneration = 0;
  let thumbnailActive = 0;
  let thumbnailQueue: (() => Promise<void>)[] = [];
  const observer = lifetime.observe(
    new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            const work = thumbnailWork.get(entry.target);
            if (work) {
              thumbnailQueue.push(work);
            }
          }
        }
        pump();
      },
      { root: element('art-setup', HTMLElement) },
    ),
  );
  const thumbnailWork = new WeakMap<Element, () => Promise<void>>();
  function pump() {
    if (lifetime.disposed) {
      return;
    }
    while (thumbnailActive < THUMBNAIL_CONCURRENCY && thumbnailQueue.length) {
      const work = thumbnailQueue.shift();
      if (!work) {
        break;
      }
      thumbnailActive++;
      void work().finally(() => {
        thumbnailActive--;
        pump();
      });
    }
  }
  function metadata(value: Candidate) {
    const d = value.descriptor;
    return `${d.width} × ${d.height} px · ${d.kind === 'tile' ? 'Tile' : 'Sprite / illustration'}${d.version === 2 ? ' sheet' : ''}`;
  }
  function pixels(value: Candidate) {
    return Uint8ClampedArray.from(atob(value.rgba), (c) => c.charCodeAt(0));
  }
  function paint(value: Candidate, thumbnail = false) {
    const source = document.createElement('canvas');
    source.width = value.descriptor.width;
    source.height = value.descriptor.height;
    source
      .getContext('2d')
      ?.putImageData(new ImageData(pixels(value), source.width, source.height), 0, 0);
    if (!thumbnail) {
      return source;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, THUMBNAIL_AXIS / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    source.width = source.height = 0;
    return canvas;
  }
  function previewControls() {
    for (const id of ['art-agent-close', 'art-agent-cancel', 'art-agent-json']) {
      button(id).disabled = adopting || reading;
    }
    button('art-agent-png').disabled = adopting || reading || !preview;
    button('art-agent-adopt').disabled = adopting || reading || !preview;
    button('art-agent-retry').hidden = !!preview || reading;
    button('art-agent-retry').disabled = adopting;
    // Read-only previews can always be dismissed, including during a slow export.
    button('art-agent-close').disabled = adopting;
    button('art-agent-cancel').disabled = adopting;
  }
  function close(focusEditor = false) {
    previewRequest++;
    selected = null;
    preview = null;
    image.replaceChildren();
    if (dialog.open) {
      dialog.close();
    }
    if (focusEditor) {
      ports.focusEditor();
    }
  }
  lifetime.cleanup(() => {
    listing++;
    thumbnailGeneration++;
    thumbnailQueue = [];
    observer.disconnect();
    close();
  });
  async function loadPreview(handle: Handle) {
    const request = ++previewRequest;
    reading = true;
    preview = null;
    image.replaceChildren();
    previewStatus.textContent = 'Loading preview…';
    element('art-agent-save-help', HTMLElement).textContent = '';
    previewControls();
    try {
      const value = await api('artwork-candidate-export', decodeCandidate, {
        candidate: identity(handle),
      });
      if (lifetime.disposed || request !== previewRequest || !dialog.open) {
        return;
      }
      preview = value;
      image.append(paint(value));
      element('art-agent-meta', HTMLElement).textContent = `${metadata(value)} · Agent draft`;
      element('art-agent-save-help', HTMLElement).textContent = value.placements
        ? `Open a separate editable copy. Saving updates this artwork and its ${value.placements.length} selected placements together after review.`
        : value.operation === 'edit'
          ? 'Open a separate editable copy. Saving updates the existing shared artwork and its references after review.'
          : 'Open your own editable copy. Save it when you’re ready to add it to the project.';
      previewStatus.textContent = handle.stale_project_base
        ? 'The project has changed since this draft was prepared. You can download it; opening a copy checks its saved bases.'
        : '';
    } catch (error) {
      if (lifetime.disposed || request !== previewRequest) {
        return;
      }
      previewStatus.textContent = `Could not load preview. ${error instanceof Error ? error.message : String(error)} You can retry or download the snapshot JSON.`;
    } finally {
      if (!lifetime.disposed && request === previewRequest) {
        reading = false;
        previewControls();
      }
    }
  }
  function open(handle: Handle, name: string) {
    if (!ports.available()) {
      return;
    }
    selected = handle;
    element('art-agent-title', HTMLElement).textContent = name;
    element('art-agent-meta', HTMLElement).textContent = 'Agent draft';
    element('art-agent-details', HTMLDetailsElement).open = false;
    element('art-agent-identifiers', HTMLElement).textContent = JSON.stringify(handle, null, 2);
    dialog.showModal();
    void loadPreview(handle);
  }
  async function refresh() {
    const request = ++listing;
    const generation = ++thumbnailGeneration;
    observer.disconnect();
    thumbnailQueue = [];
    gallery.replaceChildren();
    status.textContent = 'Loading agent drafts…';
    button('art-handoff-list').dataset.unavailable = 'true';
    button('art-handoff-list').disabled = true;
    try {
      const value = await api('artwork-candidate-list', record, {});
      if (lifetime.disposed || request !== listing) {
        return;
      }
      const all = array(value.candidates, record);
      const handles = all.filter((handle) => !handle.error);
      const count = element('art-agent-count', HTMLElement);
      count.textContent = String(handles.length);
      count.hidden = !handles.length;
      status.textContent = handles.length
        ? ''
        : 'No agent drafts yet. Drafts prepared by your agent will appear here.';
      if (all.length !== handles.length) {
        status.textContent += ' Some retained drafts could not be read.';
      }
      for (const item of handles) {
        const handle = {
          handle: item.handle,
          project_id: item.project_id,
          project_revision: item.project_revision,
          revision: item.revision,
          ...(item.owner ? { owner: item.owner } : {}),
        };
        const row = document.createElement('section');
        row.dataset.revision = string(item.revision);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'art-agent-card';
        const thumb = document.createElement('span');
        thumb.className = 'art-agent-thumb';
        thumb.textContent = 'Loading thumbnail…';
        thumb.setAttribute('aria-hidden', 'true');
        const title = document.createElement('strong');
        title.textContent = string(item.name);
        const meta = document.createElement('span');
        meta.className = 'hint';
        meta.textContent = 'Agent draft';
        const action = document.createElement('span');
        action.className = 'art-agent-card-action';
        action.textContent = 'Preview →';
        card.append(thumb, title, meta, action);
        row.append(card);
        lifetime.assign(card, 'onclick', () =>
          open({ ...handle, stale_project_base: item.stale_project_base }, string(item.name)),
        );
        // Metadata such as stale_project_base is presentation only, never part of a candidate handle.
        thumbnailWork.set(row, async () => {
          if (generation !== thumbnailGeneration || lifetime.disposed) {
            return;
          }
          try {
            const candidate = await api('artwork-candidate-export', decodeCandidate, {
              candidate: handle,
            });
            if (generation !== thumbnailGeneration || lifetime.disposed) {
              return;
            }
            thumb.replaceChildren(paint(candidate, true));
            meta.textContent = metadata(candidate);
          } catch {
            if (generation === thumbnailGeneration && !lifetime.disposed) {
              thumb.textContent = 'Preview unavailable';
            }
          }
        });
        gallery.append(row);
        observer.observe(row);
      }
    } catch (error) {
      if (request === listing && !lifetime.disposed) {
        element('art-agent-count', HTMLElement).hidden = true;
        status.textContent = `Could not load agent drafts. ${error instanceof Error ? error.message : String(error)} Choose Refresh to retry.`;
      }
    } finally {
      if (request === listing && !lifetime.disposed) {
        button('art-handoff-list').dataset.unavailable = 'false';
        button('art-handoff-list').disabled = false;
      }
    }
  }
  lifetime.assign(button('art-handoff-list'), 'onclick', () => void refresh());
  lifetime.assign(button('art-agent-close'), 'onclick', () => close());
  lifetime.assign(button('art-agent-cancel'), 'onclick', () => close());
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      if (!adopting) {
        close();
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.assign(button('art-agent-retry'), 'onclick', () => {
    if (selected) {
      void loadPreview(selected);
    }
  });
  async function readAction(work: () => Promise<void>) {
    const request = previewRequest;
    reading = true;
    previewControls();
    try {
      await work();
    } catch (error) {
      if (request === previewRequest && !lifetime.disposed) {
        previewStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === previewRequest && !lifetime.disposed) {
        reading = false;
        previewControls();
      }
    }
  }
  lifetime.assign(button('art-agent-json'), 'onclick', () => {
    const handle = selected;
    if (!handle) {
      return;
    }
    void readAction(async () => {
      const request = previewRequest;
      const value = await api('artwork-candidate-export', record, { candidate: identity(handle) });
      if (request === previewRequest && !lifetime.disposed) {
        ports.download(value, `${string(value.atlas_id)}-candidate.json`);
      }
    });
  });
  lifetime.assign(button('art-agent-png'), 'onclick', () => {
    const value = preview;
    if (!value) {
      return;
    }
    void readAction(async () => {
      const request = previewRequest;
      const blob = await artworkPng(pixels(value), value.descriptor.width, {
        x: 0,
        y: 0,
        width: value.descriptor.width,
        height: value.descriptor.height,
      });
      if (request !== previewRequest || lifetime.disposed) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${value.atlas_id}-draft.png`;
      link.click();
      lifetime.revokeLater(url);
    });
  });
  lifetime.assign(button('art-agent-adopt'), 'onclick', () => {
    const handle = selected;
    if (!handle || !preview || adopting || reading || !ports.available()) {
      return;
    }
    void ports.run(async () => {
      adopting = true;
      previewControls();
      try {
        await ports.adopt(identity(handle));
        if (!lifetime.disposed) {
          close(true);
        }
      } catch (error) {
        if (!lifetime.disposed) {
          previewStatus.textContent = `${error instanceof Error ? error.message : String(error)} The original draft is retained. Download it before reconciling its saved bases.`;
        }
      } finally {
        adopting = false;
        if (!lifetime.disposed) {
          previewControls();
        }
      }
    });
  });
  function identity(handle: Handle): Handle {
    return {
      handle: handle.handle,
      project_id: handle.project_id,
      project_revision: handle.project_revision,
      revision: handle.revision,
      ...(handle.owner ? { owner: handle.owner } : {}),
    };
  }
  return { refresh };
}
