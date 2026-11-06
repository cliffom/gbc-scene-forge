/** Artwork composition: document transitions, review/save and recovery with typed ports. */
import { createAgentDrafts } from './agent-drafts.mts';
import { artworkPng } from './artwork-png.mts';
import { MAX_PLACEMENTS } from './placement-limits.mts';
import { createArtworkLayerControls } from './artwork-layer-controls.mts';
import { createArtworkPaletteControls } from './artwork-palette-controls.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { feedbackText, type createNotifications } from '../editor/editor-notifications.mts';
import type {
  BrushState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from '../editor/editor-state.mts';
import type { ProjectApi } from '../project/project-api.mts';
import { array, record, string, number } from '../shared/decode.mts';
import { tileParts } from './tile-transform.mts';
import { ArtworkSession } from './artwork-session.mts';
import { decodeCandidate, type Candidate, type Placement } from './artwork-contracts.mts';
import type { Color } from './pixel-model.mts';
import { createArtworkGestures } from './artwork-gestures.mts';
import { ArtworkRaster } from './artwork-raster.mts';
import { createArtworkRendering } from './artwork-rendering.mts';
import { createSheetEditor } from './sheet-editor.mts';
import { createArtworkWorkspace } from './artwork-workspace.mts';
import { conversionViews } from './conversion-views.mts';
import { createArtworkViewport } from './artwork-viewport.mts';
import { createArtworkDocuments, MAX_OPEN_ARTWORK_DOCUMENTS } from './artwork-documents.mts';
import {
  createDocumentBar,
  documentCaption,
  documentStateLabel,
  type DocumentSummary,
} from '../editor/document-bar.mts';
import { createDocumentChooser } from './document-chooser.mts';
import type { CloseChoice } from '../editor/document-close.mts';
import type { CommandCapabilities } from '../editor/document-commands.mts';
import type { DocumentContribution } from '../editor/editor-shell.mts';

type Source = {
  atlas_id: string;
  region: string;
  kind: string;
  artwork_revision: string;
  target: Record<string, unknown> | null;
};
/** Quiet time after a completed artwork edit; each scheduled write owns its captured snapshot. */
export const ARTWORK_CHECKPOINT_DEBOUNCE_MS = 350;
/** Saved artwork inventory discovery; adoption still checks activity and revision fences. */
export const ARTWORK_DISCOVERY_INTERVAL_MS = 2000;
/** Suppress brief writer contention; three failed eligible checks surface inline. */
const ARTWORK_DISCOVERY_FAILURES_BEFORE_NOTICE = 3;

export function createPixelEditor({
  notifications,
  lifetime,
  api,
  workspaceState,
  sceneSession,
  sceneSelection,
  brushes,
  ports,
}: {
  notifications: ReturnType<typeof createNotifications>;
  lifetime: EditorLifetime;
  api: ProjectApi['json'];
  workspaceState: WorkspaceState;
  sceneSession: SceneSession;
  sceneSelection: SceneSelection;
  brushes: BrushState;
  ports: {
    confirmClose: (name: string, artwork: boolean) => Promise<CloseChoice | null>;
    presentation: {
      contribute: (contribution: DocumentContribution) => {
        readonly active: boolean;
        activate: (focus?: boolean) => void;
      };
      scene: () => void;
      revealInspector: () => void;
      prepareSceneDeparture: () => void;
      sceneSummary: (modified?: boolean) => DocumentSummary;
      unavailable: () => boolean;
      commandsChanged: () => void;
    };
    discovered: (data: Record<string, unknown>, eligible: () => boolean) => Promise<void>;
    run: (work: () => Promise<void>) => Promise<void>;
    saved: (ack: Record<string, unknown>, reviewedScenes: Record<string, unknown>) => Promise<void>;
  };
}) {
  const surface = element('artwork-surface', HTMLElement),
    canvas = element('art-canvas', HTMLCanvasElement);
  let session: ArtworkSession | null = null;
  const feedback = notifications.channel(
    'art-message',
    () => session,
    () => presentationSlot.active,
  );
  let busy = false;
  let closingAfterSave: ArtworkSession | null = null;
  let loading: { label: string; failed: boolean } | null = null;
  let libraryOpen: { controller: AbortController; done: Promise<void> } | null = null;
  let retryOpen: (() => void) | null = null;
  let libraryRequest = 0;
  let sources: Source[] = [];
  let unavailableSource: Source | null = null;
  let inventoryRevision = workspaceState.revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let discoveryError = '';
  let discoveryFailures = 0;
  let savedDocumentIds: Set<string> | null = null;
  const inspector = element('art-inspector-content', HTMLElement);
  const presentationSlot = ports.presentation.contribute({
    surface,
    inspector: [inspector],
    focus: () => canvas.focus({ preventScroll: true }),
  });
  inspector.hidden = false;
  const documents = createArtworkDocuments(lifetime, surface, inspector);
  const documentBar = createDocumentBar();
  const chooser = createDocumentChooser(lifetime, () => {
    cancelGesture();
    sheetEditor.stop();
    artworkViewport.suspend();
    ports.presentation.prepareSceneDeparture();
    tabs();
  });
  const presentation = createArtworkWorkspace(
    lifetime,
    surface,
    () => {
      controls();
      tabs();
    },
    () => {
      if (!busy && !surface.classList.contains('show-art-review')) {
        closingAfterSave = null;
        dirtyControls();
      }
      ports.presentation.commandsChanged();
    },
  );
  const { setup } = presentation;
  const agentDrafts = createAgentDrafts(lifetime, api, {
    available: () => presentationSlot.active && !session && !busy && !loading,
    run: execute,
    download,
    focusEditor: () => canvas.focus({ preventScroll: true }),
    adopt: async (candidateHandle) => {
      if (documents.size >= MAX_OPEN_ARTWORK_DOCUMENTS) {
        throw Error('Close an artwork document first (limit 16).');
      }
      await suspend();
      const adopted = await api('artwork-candidate-adopt', record, {
        candidate: candidateHandle,
        owner: crypto.randomUUID(),
      });
      const value = await api('artwork-candidate-export', decodeCandidate, { candidate: adopted });
      const original =
        value.operation === 'edit'
          ? await api('artwork-open', decodeCandidate, {
              target: {
                document_id: value.document_id,
                atlas_id: value.atlas_id,
                region: value.descriptor.region,
              },
              project_revision: value.project_revision,
              artwork_revision: value.artwork_revision,
            })
          : value;
      start(value, original);
      await session?.checkpoint();
      message(
        'Opened a separate editable copy with a new Undo history. Original agent draft retained.',
      );
    },
  });
  function reviewPanel(open: boolean) {
    presentation.reviewPanel(open);
    if (open) {
      ports.presentation.revealInspector();
    }
  }
  for (const id of ['art-properties-toggle', 'art-palette-toggle', 'art-layers-toggle']) {
    element(id, HTMLElement).addEventListener(
      'click',
      () => {
        if (presentationSlot.active) {
          ports.presentation.revealInspector();
        }
      },
      { signal: lifetime.signal },
    );
  }
  function focusFrame(region: string, fresh = false) {
    const d = session?.model.descriptor;
    if (session && d?.version === 2 && d.frames.some((f) => f.id === region)) {
      if (select('art-frame').value !== region) {
        session.model.selection = null;
      }
      select('art-frame').value = region;
      // Fresh named-pose navigation constrains drawing; retained documents keep their scope.
      if (fresh) {
        input('art-edit-frame').checked = true;
      }
      sheetEditor.sync();
      draw();
    }
  }
  function documentState() {
    const state = !session
      ? ''
      : session.original.operation !== 'edit'
        ? 'New'
        : session.changed
          ? 'Modified'
          : 'Saved';
    element('art-document-state', HTMLElement).textContent = state;
    element('art-draft-status', HTMLElement).textContent =
      state === 'Saved'
        ? 'Saved. Changes to this shared artwork update its references.'
        : state === 'New'
          ? 'New artwork · not yet in the Library'
          : 'Modified · local changes';
  }
  function workspace(active: boolean) {
    closingAfterSave = null;
    artworkViewport.suspend();
    if (active) {
      ports.presentation.prepareSceneDeparture();
      presentationSlot.activate();
    } else {
      loading = null;
      ports.presentation.scene();
    }
    reflectOpacity();
    button('scene-document').setAttribute('aria-pressed', String(!active));
    element('art-document-state', HTMLElement).hidden = true;
    element('palette', HTMLElement).dispatchEvent(new Event('artwork-workspace'));
    chooser.close();
    sheetEditor.stop();
  }
  function remember() {
    if (session) {
      documents.remember(session, artworkViewport.remember());
      tabs();
    }
  }
  function artworkSummary(current: ArtworkSession): DocumentSummary {
    return {
      name: current.model.descriptor.name,
      kind: 'Artwork',
      state: current.original.operation !== 'edit' ? 'New' : current.changed ? 'Modified' : 'Saved',
      externalChanged: current.externalChanged,
    };
  }
  function syncNavigation(sceneModified?: boolean) {
    syncArtworkUpdates();
    const summary = presentationSlot.active
      ? session
        ? artworkSummary(session)
        : {
            name: element('artwork-heading', HTMLElement).textContent || 'Open artwork',
            kind: 'Artwork' as const,
            state: '' as const,
            externalChanged: false,
          }
      : ports.presentation.sceneSummary(sceneModified);
    documentBar.render(summary, busy || ports.presentation.unavailable());
    ports.presentation.commandsChanged();
  }
  function tabs() {
    documentState();
    syncNavigation();
    const scene = ports.presentation.sceneSummary();
    button('scene-document').textContent = [documentCaption(scene), documentStateLabel(scene)]
      .filter(Boolean)
      .join(' · ');
    element('artwork-documents', HTMLElement).replaceChildren(
      ...documents.sessions().map((current) => {
        const tab = document.createElement('button');
        const active = presentationSlot.active && session === current;
        tab.textContent = `${active ? 'Current · ' : ''}${documentCaption(artworkSummary(current))} · ${documentStateLabel(artworkSummary(current))}`;
        tab.setAttribute('aria-pressed', String(presentationSlot.active && session === current));
        lifetime.assign(tab, 'onclick', () => {
          void execute(async () => {
            await suspend();
            restore(current);
          });
        });
        return tab;
      }),
    );
  }
  function restore(current: ArtworkSession, { focus = true, preservePanels = false } = {}) {
    if (lifetime.disposed) {
      return;
    }
    const saved = documents.get(current);
    if (!saved) {
      return;
    }
    loading = null;
    session = current;
    sheetEditor.sync();
    documents.restoreControls(current);
    // Options exist now; rebuild callbacks against the restored sequence, not
    // the selection inherited from the previously active document.
    sheetEditor.sync(true);
    invalidate();
    message('');
    if (!preservePanels) {
      workspace(true);
      presentation.resetPanels();
    } else {
      presentation.reviewPanel(false);
    }
    describe(current.candidate);
    element('artwork-heading', HTMLElement).textContent = current.model.descriptor.name;
    palette.invalidate();
    draw();
    artworkViewport.restore(saved.view);
    tabs();
    if (focus) {
      canvas.focus({ preventScroll: true });
    }
  }
  async function suspend() {
    cancelGesture();
    lifetime.cancelTimeout(timer);
    timer = undefined;
    sheetEditor.stop();
    if (session?.changed) {
      await session.checkpoint();
    } else {
      await session?.removeCheckpoint();
    }
    remember();
  }
  const raster = new ArtworkRaster();
  lifetime.cleanup(() => raster.dispose());
  const sheetEditor = createSheetEditor(lifetime, raster, {
    current: () => session,
    mutate: (work) => operation(work),
    draw: () => draw(),
    review: (sequenceId) => {
      void execute(async () => {
        if (!session) {
          return;
        }
        const candidate = await session.synchronizeCurrent();
        const result = await api('artwork-animation-review', record, {
          candidate,
          sequence_id: sequenceId,
          scale: 4,
        });
        element('art-animation-image', HTMLImageElement).src =
          `data:image/apng;base64,${string(result.animation_png)}`;
        element('art-animation-result', HTMLElement).hidden = false;
        session.receipt = record(result.receipt);
        message('Animation review ready. Save commits this exact artwork and timing.');
      });
    },
  });
  const palette = createArtworkPaletteControls(lifetime, raster, {
    current: () => session?.model ?? null,
    view: () => sheetEditor.view(),
    busy: () => busy || gestures.active,
    color: () => (input('art-alpha').validity.valid ? color() : null),
    chooseColor,
  });
  const artworkViewport = createArtworkViewport(lifetime, canvas, {
    zoom: (direction) => {
      const zoom = select('art-zoom');
      const values = [...zoom.options].map((o) => Number(o.value)).sort((a, b) => a - b);
      const index = values.indexOf(Number(zoom.value));
      zoom.value = String(values[Math.max(0, Math.min(values.length - 1, index - direction))]);
      draw();
    },
    available: () => presentationSlot.active && !!session && !busy && !chooser.open,
    drawing: () => gestures.active,
    tool: () => gestures.tool(),
    view: () =>
      session
        ? (sheetEditor.view() ?? {
            x: 0,
            y: 0,
            width: session.model.width,
            height: session.model.height,
          })
        : null,
  });
  const gestures = createArtworkGestures(lifetime, surface, canvas, {
    current: () => session?.model ?? null,
    available: () => !busy,
    point: (client) => artworkViewport.point(client, true),
    color,
    chooseColor,
    authoringTool: () => artworkViewport.authoringTool(),
    hideTarget: () => artworkViewport.hideTarget(),
    paint: (gestureOnly) => draw(gestureOnly),
    mutate: (work) => operation(work),
    changed,
    error: blocked,
  });
  const rendering = createArtworkRendering(lifetime, canvas, raster, {
    current: () => session?.model ?? null,
    view: () => sheetEditor.view(),
    selectedFrame: () => sheetEditor.selectedFrame(),
    zoom: () => Number(select('art-zoom').value),
    onion: () => input('art-onion').checked,
    grid: () => input('art-grid').checked,
  });
  function fitArtwork() {
    const model = session?.model,
      viewport = surface.querySelector('.art-canvas-scroll');
    if (!model || !viewport) {
      return;
    }
    const frame = sheetEditor.view(),
      width = frame?.width ?? model.width,
      height = frame?.height ?? model.height;
    const style = getComputedStyle(viewport);
    const availableWidth =
      viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4;
    const availableHeight =
      viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 4;
    const zoom = select('art-zoom');
    const scales = [...zoom.options].map((option) => Number(option.value)).sort((a, b) => b - a);
    const scale =
      scales.find(
        (value) => width * value <= availableWidth && height * value <= availableHeight,
      ) ?? scales[scales.length - 1];
    zoom.value = String(scale);
    cancelGesture();
    draw();
    artworkViewport.layout(true);
  }
  lifetime.assign(button('art-fit'), 'onclick', fitArtwork);
  let conversionPlan: Record<string, unknown> | null = null;
  const conversionDialog = element('conversion-dialog', HTMLDialogElement);
  function conversionError(error: unknown) {
    element('conversion-message', HTMLElement).textContent =
      error instanceof Error ? error.message : String(error);
  }
  lifetime.assign(button('convert-sprites'), 'onclick', () => {
    void execute(async () => {
      if (!sceneSession.loaded || sceneSession.dirty()) {
        throw Error('Save the scene and select sprite objects first.');
      }
      await inventory();
      select('conversion-target').replaceChildren(
        ...sources
          .filter((s) => s.kind === 'tile')
          .map((s) => new Option(`${s.atlas_id} / ${s.region}`, `${s.atlas_id}/${s.region}`)),
      );
      conversionPlan = null;
      button('conversion-save').disabled = true;
      input('conversion-static').checked = false;
      element('conversion-images', HTMLElement).hidden = true;
      element('conversion-message', HTMLElement).textContent = '';
      conversionDialog.showModal();
    });
  });
  for (const id of ['conversion-target', 'conversion-static']) {
    const control = id === 'conversion-target' ? select(id) : input(id);
    lifetime.assign(control, 'onchange', () => {
      conversionPlan = null;
      button('conversion-save').disabled = true;
    });
  }
  lifetime.assign(button('conversion-close'), 'onclick', () => conversionDialog.close());
  lifetime.assign(button('conversion-review'), 'onclick', () => {
    void execute(async () => {
      conversionPlan = null;
      button('conversion-save').disabled = true;
      element('conversion-images', HTMLElement).hidden = true;
      const controls = [
        select('conversion-target'),
        input('conversion-static'),
        button('conversion-review'),
      ];
      for (const control of controls) {
        control.disabled = true;
      }
      try {
        const loaded = sceneSession.loaded,
          layer = sceneSession.editor?.active;
        if (!loaded || !layer || sceneSession.dirty()) {
          throw Error('Save the selected scene first.');
        }
        const ids = new Set(sceneSelection.selectedObjects);
        if (sceneSelection.selectedObject) {
          ids.add(sceneSelection.selectedObject);
        }
        const request = {
          project_revision: inventoryRevision,
          scene_id: loaded.id,
          scene_revision: loaded.revision,
          layer_id: layer.id,
          object_ids: Array.from(ids, Number),
          tile_asset: select('conversion-target').value,
          acknowledge_static: input('conversion-static').checked,
        };
        const viewports = conversionViews(
          (layer.type === 'objectgroup' ? layer.objects : []).filter((item) => ids.has(item.id)),
          workspaceState.project?.atlases ?? {},
          loaded.width * loaded.grid,
          loaded.height * loaded.grid,
        );
        let plan: Record<string, unknown> | null = null;
        let timing = '';
        const views: HTMLElement[] = [];
        for (const [index, viewport] of viewports.entries()) {
          const result = await api('artwork-conversion-review', record, { request, viewport });
          const currentPlan = record(result.plan);
          if (plan && string(plan.revision) !== string(currentPlan.revision)) {
            throw Error('Conversion changed during review. Review the selection again.');
          }
          plan = currentPlan;
          timing = string(result.timing);
          const view = document.createElement('section');
          view.className = 'conversion-view';
          const heading = document.createElement('h3');
          heading.textContent = `View ${index + 1} of ${viewports.length} · pixels ${viewport.x}, ${viewport.y} · ${viewport.width} × ${viewport.height}`;
          view.append(heading);
          for (const key of ['before', 'after']) {
            const figure = document.createElement('figure');
            const caption = document.createElement('figcaption');
            caption.textContent = key === 'before' ? 'Before' : 'After';
            const image = document.createElement('img');
            image.id = `conversion-${key}${index ? `-${index + 1}` : ''}`;
            image.alt = `Selected scene ${key} conversion, view ${index + 1}`;
            image.src = `data:image/png;base64,${string(result[`${key}_png`])}`;
            await image.decode();
            figure.append(caption, image);
            view.append(figure);
          }
          views.push(view);
        }
        if (!plan) {
          throw Error('Select sprite objects to review.');
        }
        element('conversion-views', HTMLElement).replaceChildren(...views);
        element('conversion-mapping', HTMLElement).replaceChildren(
          ...array(plan.mapping, record).map((value) => {
            const row = document.createElement('li');
            row.textContent = `Sprite #${number(value.object_id)}: ${string(value.source_asset)} → ${string(value.tile_asset)}; ${number(value.columns)} × ${number(value.rows)} tiles at column ${number(value.x)}, row ${number(value.y)}.`;
            return row;
          }),
        );
        element('conversion-images', HTMLElement).hidden = false;
        element('conversion-message', HTMLElement).textContent = timing;
        conversionPlan = plan;
        button('conversion-save').disabled = false;
      } catch (error) {
        conversionPlan = null;
        button('conversion-save').disabled = true;
        conversionError(error);
      } finally {
        for (const control of controls) {
          control.disabled = false;
        }
      }
    });
  });
  lifetime.assign(button('conversion-save'), 'onclick', () => {
    void execute(async () => {
      try {
        const plan = conversionPlan;
        if (!plan || sceneSession.dirty()) {
          throw Error('Review the saved selection before replacing placements.');
        }
        conversionPlan = null;
        button('conversion-save').disabled = true;
        const ack = await api('artwork-conversion-save', record, { plan });
        const request = record(plan.request);
        await ports.saved(ack, { [string(request.scene_id)]: request.scene_revision });
        conversionDialog.close();
      } catch (error) {
        conversionError(error);
      }
    });
  });
  function message(text: string, error = false) {
    if (error) {
      feedback.error(text);
    } else {
      feedback.show(text, { quiet: text.startsWith('Artwork saved.') });
    }
  }
  function blocked(error: unknown) {
    const text = feedbackText(error);
    feedback.warning(text === 'Layer is locked.' ? 'Layer is locked. Unlock it to edit.' : text);
  }
  function controls() {
    feedback.sync();
    syncArtworkUpdates();
    if (busy) {
      artworkViewport.suspend();
    }
    const controls = [surface, inspector].flatMap((root) => [
      ...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
        'button,input,select',
      ),
    ]);
    for (const control of controls) {
      const disabled =
        (busy && control.id !== 'art-loading-cancel') || control.dataset.unavailable === 'true';
      if (control.disabled !== disabled) {
        control.disabled = disabled;
      }
    }
    const active = session !== null && !loading;
    button('art-download-png').disabled =
      busy ||
      !active ||
      gestures.active ||
      (select('art-png-scope').value === 'frame' && !sheetEditor.selectedFrame());
    select('art-png-scope').options[1].disabled = !sheetEditor.selectedFrame();
    inspector.hidden = !active;
    element('art-setup', HTMLElement).hidden = active || loading !== null;
    element('art-editor', HTMLElement).hidden = !active;
    element('art-loading', HTMLElement).hidden = !loading;
    surface.setAttribute('aria-busy', String(!!loading && !loading.failed));
    if (loading) {
      element('art-loading-status', HTMLElement).textContent = loading.failed
        ? `Could not open ${loading.label}.`
        : `Opening ${loading.label}…`;
      button('art-loading-retry').hidden = !loading.failed;
      button('art-loading-cancel').textContent = loading.failed
        ? 'Return to document'
        : 'Cancel opening';
    }
    if (!active) {
      const source = sources[Number(select('art-source').value)];
      select('art-source').disabled = busy || !sources.length;
      select('art-source-grid').disabled = busy || !sources.length;
      for (const id of ['art-cell-x', 'art-cell-y']) {
        input(id).disabled = busy || !sources.length;
      }
      button('art-open').disabled = busy || !sources[Number(select('art-source').value)]?.target;
      button('art-duplicate-sheet').disabled = busy || !source;
      button('art-duplicate').disabled = busy || !source;
      button('art-variation').disabled = busy || !source;
      let variation = 'Choose a source first.';
      if (source) {
        try {
          variation = `${selectedPlacements(source).length} matching placements ready to capture. Review and Save commit the new source and replacements together.`;
        } catch (error) {
          variation = error instanceof Error ? error.message : String(error);
        }
      }
      element('art-variation-help', HTMLElement).textContent = variation;
      button('art-variation').title = variation;
    }
    const descriptor = session?.model.descriptor;
    element('art-document-name', HTMLElement).textContent = descriptor?.name ?? '';
    element('art-document-name', HTMLElement).title = descriptor?.name ?? '';
    element('art-document-name', HTMLElement).setAttribute(
      'aria-label',
      `Artwork name: ${descriptor?.name ?? ''}`,
    );
    element('art-document-width', HTMLElement).textContent = descriptor
      ? `${descriptor.width} px`
      : '—';
    element('art-document-height', HTMLElement).textContent = descriptor
      ? `${descriptor.height} px`
      : '—';
    element('art-document-pixels', HTMLElement).textContent = descriptor
      ? (descriptor.width * descriptor.height).toLocaleString()
      : '—';
    element('art-frame-details', HTMLDetailsElement).hidden = descriptor?.version !== 2;
    element('art-frame-properties', HTMLElement).hidden = session?.model.descriptor.version !== 2;
    if (!active && presentation.mode === 'existing') {
      element('art-source-help', HTMLElement).textContent = sources[
        Number(select('art-source').value)
      ]?.target
        ? 'Edit the shared original, or name an independent copy below.'
        : 'Imported artwork is preserved. Name an editable copy to begin drawing.';
      if (unavailableSource) {
        element('art-source-help', HTMLElement).textContent =
          'This source is no longer available. Entered copy fields are retained; choose another source explicitly.';
      }
      button('art-open').title = button('art-open').disabled
        ? 'Imported artwork requires an editable copy. Name a copy below.'
        : 'Edit the shared original; saving updates its references.';
    }
    dirtyControls();
    input('art-use-scene').disabled = busy || !sceneSession.loaded;
    sheetEditor.controls(busy);
    layerControls.sync();

    syncNavigation();
  }
  function dirtyControls() {
    const modified = session?.changed ?? false;
    const discard = button('art-discard');
    const label = modified ? 'Close artwork…' : 'Close artwork';
    button('art-cancel-close').hidden = !closingAfterSave;
    if (discard.textContent !== label) {
      discard.textContent = label;
    }
    discard.classList.toggle('destructive-command', modified);
  }
  async function execute(work: () => Promise<void>, key?: string) {
    if (busy || ports.presentation.unavailable() || lifetime.disposed) {
      return;
    }
    chooser.close();
    busy = true;
    controls();
    message('');
    const operationKey =
      key ?? (work.name ? work : (document.activeElement?.closest('button') ?? work));
    const previousFeedback = feedback.capture();
    await ports.run(async () => {
      try {
        await work();
        previousFeedback.clear(operationKey);
      } catch (error) {
        if (!lifetime.disposed) {
          feedback.error(
            `${error instanceof Error ? error.message : String(error)} Local pixels are retained; download work or keep a checkpoint before reconciling.`,
            operationKey,
          );
        }
      } finally {
        busy = false;
        if (!lifetime.disposed) {
          controls();
        }
      }
    });
  }
  function color(): Color {
    const hex = input('art-color').value;
    const alpha = Number(input('art-alpha').value);
    if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
      throw Error('Alpha must be an integer within 0..255.');
    }
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      alpha,
    ];
  }
  let drawingAlpha = 255;
  function reflectOpacity() {
    const alpha = Number(input('art-alpha').value);
    if (Number.isInteger(alpha) && alpha > 0 && alpha <= 255) {
      drawingAlpha = alpha;
    }
    palette.reflectColor(input('art-alpha').validity.valid ? color() : null);
    const transparent = alpha === 0;
    button('art-transparent').setAttribute('aria-pressed', String(transparent));
    button('art-transparent').setAttribute(
      'aria-label',
      transparent ? 'Resume color' : 'Transparent',
    );
    element('art-transparency-label', HTMLElement).textContent = transparent
      ? 'Resume color'
      : 'Transparent';
  }
  function chooseColor(c: Color) {
    input('art-color').value =
      '#' +
      c
        .slice(0, 3)
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    input('art-alpha').value = String(c[3]);
    palette.reflectColor(c);
    reflectOpacity();
  }
  function draw(gestureOnly = false) {
    const model = session?.model;
    if (!model || lifetime.disposed) {
      return;
    }
    artworkViewport.hideTarget();
    if (gestureOnly) {
      sheetEditor.paint();
    } else {
      sheetEditor.sync();
    }
    rendering.draw();
    if (!gestureOnly) {
      palette.sync();
    }
    if (gestureOnly) {
      dirtyControls();
    } else {
      controls();
    }
    artworkViewport.layout();
  }
  function invalidate() {
    session?.invalidate();
    element('art-comparison', HTMLElement).hidden = true;
    element('art-animation-result', HTMLElement).hidden = true;
    element('art-references', HTMLElement).textContent = '';
    for (const id of [
      'art-before',
      'art-after',
      'art-scene-before',
      'art-scene-after',
      'art-animation-image',
    ]) {
      element(id, HTMLImageElement).removeAttribute('src');
    }
  }
  function checkpointSoon() {
    lifetime.cancelTimeout(timer);
    element('art-draft-status', HTMLElement).textContent = session?.changed
      ? 'Unsaved artwork; checkpoint pending…'
      : 'Saved artwork; recovery checkpoint pending…';
    const current = session;
    // Capture the completed edit before a later gesture can mutate the model.
    const pixels = current?.model.composite().slice();
    const checkpointDescriptor = current ? structuredClone(current.model.descriptor) : undefined;
    const checkpointLayers = current?.model.descriptor.layers
      ? current.model.layerEncoding()
      : undefined;
    timer = lifetime.timeout(() => {
      timer = undefined;
      if (!current || !pixels) {
        return;
      }
      void current
        .checkpoint(pixels, checkpointDescriptor, checkpointLayers)
        .then(() => {
          if (session === current && !lifetime.disposed) {
            feedback.clear('checkpoint');
            element('art-draft-status', HTMLElement).textContent = current.uncheckpointed
              ? 'New edits await checkpoint.'
              : current.changed
                ? 'Unsaved artwork checkpointed in this project.'
                : 'Saved artwork checkpointed in this project.';
          }
        })
        .catch((error) => {
          if (session === current && !lifetime.disposed) {
            feedback.error(
              `Checkpoint failed: ${error instanceof Error ? error.message : String(error)}. Download work before closing.`,
              'checkpoint',
            );
          }
        });
    }, ARTWORK_CHECKPOINT_DEBOUNCE_MS);
  }
  function changed() {
    closingAfterSave = null;
    feedback.clear('message');
    invalidate();
    palette.invalidate();
    draw();
    checkpointSoon();
    tabs();
  }
  function cancelGesture() {
    gestures.cancel();
  }
  function download(value: unknown, name = 'artwork-draft.json') {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    lifetime.revokeLater(url);
  }
  async function recoveries() {
    const result = await api('artwork-draft-list', record, {});
    const drafts = array(result.drafts, record);
    element('art-recovery', HTMLElement).hidden = drafts.length === 0;
    element('art-recovery', HTMLDetailsElement).open = drafts.length > 0;
    element('art-drafts', HTMLElement).replaceChildren(
      ...drafts.map((d) => {
        const row = document.createElement('div'),
          label = document.createElement('span');
        label.textContent = d.error
          ? `${string(d.id)}: ${string(d.error)}`
          : `${string(d.name)} · ${string(d.updated)}`;
        row.append(label);
        if (d.error) {
          return row;
        }
        for (const action of ['Recover copy', 'Download', 'Delete checkpoint']) {
          const control = document.createElement('button');
          control.textContent = action;
          lifetime.assign(control, 'onclick', () => {
            void execute(async () => {
              const data = { id: d.id, revision: d.revision, owner: d.owner };
              if (action === 'Download') {
                download(await api('artwork-draft-download', record, data));
              } else if (action === 'Delete checkpoint') {
                await api('artwork-draft-delete', record, data);
                await recoveries();
              } else {
                const draft = await api('artwork-draft-restore', record, data);
                start(decodeCandidate(draft.candidate), decodeCandidate(draft.original));
                await session?.checkpoint();
                message('Recovered a new copy. The original checkpoint is retained.');
              }
            });
          });
          row.append(control);
        }
        return row;
      }),
    );
  }
  function selectedAsset() {
    const object = sceneSession.editor?.objects.find((o) => o.id === sceneSelection.selectedObject);
    if (object?.kind === 'sprite') {
      return object.asset;
    }
    const selection = sceneSelection.selection,
      layer = sceneSession.editor?.active;
    if (selection && layer?.type === 'tilelayer') {
      return tileParts(layer.cells[selection.y]?.[selection.x] ?? '')[0];
    }
    return brushes.spriteBrush ?? tileParts(brushes.brush?.[0]?.[0] ?? '')[0];
  }
  async function inventory(preserve = false, eligible = () => true) {
    const previous = sources[Number(select('art-source').value)] ?? unavailableSource;
    const project = await api('project', record);
    if (!eligible()) {
      return;
    }
    const revision = string(project.revision);
    const result = await api('artwork-list', record, { project_revision: revision });
    if (!eligible()) {
      return;
    }
    inventoryRevision = revision;
    const docs = array(result.documents, record);
    savedDocumentIds = new Set(docs.map((d) => string(record(d.target).document_id)));
    sources = array(result.sources, record).flatMap((source) =>
      array(source.regions, record).map((region) => ({
        atlas_id: string(source.atlas_id),
        region: string(region.name),
        kind: string(region.kind),
        artwork_revision: string(source.artwork_revision),
        target: docs.find((d) => string(record(d.target).atlas_id) === source.atlas_id)?.target
          ? record(docs.find((d) => string(record(d.target).atlas_id) === source.atlas_id)?.target)
          : null,
      })),
    );
    for (const retained of documents.sessions()) {
      if (retained.original.operation === 'edit') {
        const source = sources.find(
          (item) => item.atlas_id === retained.original.descriptor.atlas_id,
        );
        retained.externalChanged = source?.artwork_revision !== retained.original.artwork_revision;
      }
    }
    syncNavigation();
    select('art-source').replaceChildren(
      ...sources.map(
        (s, i) =>
          new Option(
            `${s.atlas_id} / ${s.region}${s.target ? ' (editable)' : ' (copy to edit)'}`,
            String(i),
          ),
      ),
    );
    if (!sources.length) {
      select('art-source').add(new Option('No artwork yet — create blank artwork', ''));
    }
    const asset = selectedAsset(),
      parts = asset.split('/');
    const index = sources.findIndex(
      (s) =>
        s.atlas_id === (preserve ? previous?.atlas_id : parts[0]) &&
        s.region === (preserve ? previous?.region : parts[1]),
    );
    if (index >= 0) {
      select('art-source').value = String(index);
      unavailableSource = null;
    } else if (preserve && previous) {
      unavailableSource = previous;
      select('art-source').add(
        new Option(`${previous.atlas_id} / ${previous.region} (no longer available)`, '-1'),
      );
      select('art-source').value = '-1';
    }
    if (!preserve) {
      input('art-cell-x').value = parts[2] ?? '0';
      input('art-cell-y').value = parts[3] ?? '0';
      select('art-source-grid').value = String(sceneSession.loaded?.grid ?? 8);
    }
  }
  function start(candidate: Candidate, original = candidate) {
    if (lifetime.disposed) {
      return;
    }
    loading = null;
    session = new ArtworkSession(candidate, api, original);
    documents.add(session);
    artworkViewport.authoringTool();
    tabs();
    input('art-use-scene').checked = sceneSession.loaded !== null;
    describe(candidate);
    presentation.resetPanels(true);
    input('art-review-detail').checked = false;
    input('art-review-x').value = '0';
    input('art-review-y').value = '0';
    input('art-review-width').value = String(Math.min(256, candidate.descriptor.width));
    input('art-review-height').value = String(Math.min(256, candidate.descriptor.height));
    documentState();
    input('art-edit-frame').checked = false;
    invalidate();
    palette.invalidate();
    controls();
    draw();
    if (candidate.descriptor.width > 256 || candidate.descriptor.height > 256) {
      fitArtwork();
    }
    artworkViewport.layout(true);
    if (candidate.operation !== 'edit' || candidate.rgba !== original.rgba) {
      checkpointSoon();
    }
    tabs();
    canvas.focus();
  }
  function describe(candidate: Candidate) {
    element('art-handoff-result', HTMLElement).hidden = true;
    element('art-recovery', HTMLElement).hidden = true;
    element('artwork-heading', HTMLElement).textContent = candidate.descriptor.name;
    element('art-preview-help', HTMLElement).textContent = candidate.placements
      ? 'A 256 × 256 view of the saved scene. The comparison replaces only captured selections; no extra temporary placement is added.'
      : 'A 256 × 256 view of the open scene, including unsaved scene edits. New artwork is temporarily placed at this position for review only.';
    element('art-selection-details', HTMLElement).hidden = !candidate.placements;
    element('art-selection-list', HTMLElement).replaceChildren(
      ...(candidate.placements ?? []).map((p) => {
        const item = document.createElement('li');
        const sceneName =
          workspaceState.sceneChoices.find((s) => s.id === p.scene_id)?.name ?? p.scene_id;
        item.textContent = `${sceneName} · layer ${p.layer_id} · ${'object_id' in p ? `sprite ${p.object_id}` : `cell ${p.x}, ${p.y}`}`;
        return item;
      }),
    );
    element('art-scope-label', HTMLElement).textContent = candidate.placements
      ? 'Selected variation'
      : candidate.operation === 'edit'
        ? 'Shared artwork'
        : 'New artwork';
    element('art-shared', HTMLElement).textContent = candidate.placements
      ? `Independent variation for ${candidate.placements.length} selected placements. Saving updates artwork and those saved references together; all other placements retain the original.`
      : candidate.operation === 'edit'
        ? 'Shared artwork · edits update every placement. Create a copy for an independent variation.'
        : 'New independent artwork. Original artwork and placements remain intact. Save adds it to the Library; place it separately.';
  }
  async function show(mode: 'new' | 'existing' = 'new') {
    if (!workspaceState.project) {
      return;
    }
    await execute(async () => {
      await suspend();
      if (documents.size >= MAX_OPEN_ARTWORK_DOCUMENTS) {
        throw Error(
          'Up to 16 artwork documents can be open. Save or discard one before opening another.',
        );
      }
      session = null;
      loading = null;
      setup(mode);
      reviewPanel(false);
      element('artwork-heading', HTMLElement).textContent =
        mode === 'new' ? 'New artwork' : 'Open artwork';
      element('art-scope-label', HTMLElement).textContent = '';
      sources = [];
      unavailableSource = null;
      workspace(true);
      tabs();
      await inventory();
      await recoveries();
      await agentDrafts.refresh();
      controls();
      presentation.prepareIdentity();
    });
  }
  lifetime.assign(button('show-artwork'), 'onclick', () => {
    void show('new');
  });
  lifetime.assign(button('artwork-new-document'), 'onclick', () => {
    void show('new');
  });
  for (const id of ['edit-placement-artwork', 'art-browse', 'artwork-browse-document']) {
    lifetime.assign(button(id), 'onclick', () => {
      void show('existing');
    });
  }
  /** Read-only loading can be abandoned; suspension/checkpoint writes always finish. */
  async function openLibrary(detail: Record<string, unknown>) {
    const request = ++libraryRequest;
    if (libraryOpen) {
      const previous = libraryOpen;
      previous.controller.abort();
      await previous.done;
    }
    if (
      request !== libraryRequest ||
      busy ||
      ports.presentation.unavailable() ||
      lifetime.disposed
    ) {
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const owner = { controller, done };
    libraryOpen = owner;
    const outgoing = session;
    const wasArtwork = presentationSlot.active;
    function wait<T>(promise: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new DOMException('Artwork opening cancelled.', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) {
          abort();
        }
      });
    }
    try {
      await execute(async () => {
        remember();
        loading = { label: `${string(detail.atlas)} / ${string(detail.region)}`, failed: false };
        element('artwork-heading', HTMLElement).textContent = loading.label;
        workspace(true);
        controls();
        // Let the named loading state paint before suspension, decoding or raster work.
        try {
          await wait(
            new Promise<void>((resolve) => lifetime.frame(() => lifetime.frame(() => resolve()))),
          );
          await suspend();
          signal.throwIfAborted();
          const existing = documents
            .sessions()
            .find((current) => current.model.descriptor.atlas_id === detail.atlas);
          if (existing && detail.action !== 'source-actions') {
            loading = null;
            restore(existing);
            focusFrame(string(detail.region));
            return;
          }
          if (documents.size >= MAX_OPEN_ARTWORK_DOCUMENTS) {
            throw Error('Save or discard an open artwork document first (limit 16).');
          }
          session = null;
          reviewPanel(false);
          await wait(inventory(false, () => !signal.aborted));
          signal.throwIfAborted();
          const index = sources.findIndex(
            (source) => source.atlas_id === detail.atlas && source.region === detail.region,
          );
          const source = sources[index];
          if (!source) {
            throw Error('This source is no longer available. Choose another Library source.');
          }
          unavailableSource = null;
          select('art-source').value = String(index);
          if (source && detail.action === 'source-actions') {
            loading = null;
            setup('existing');
            presentation.prepareIdentity(`${source.region} copy`);
            message(
              'Choose shared editing or name an independent copy. Variations require matching selections in a saved scene.',
            );
            controls();
            select('art-source').focus();
          } else if (source?.target) {
            const candidate = await wait(
              api(
                'artwork-open',
                (value) => {
                  signal.throwIfAborted();
                  return decodeCandidate(value);
                },
                {
                  target: source.target,
                  project_revision: inventoryRevision,
                  artwork_revision: source.artwork_revision,
                },
              ),
            );
            signal.throwIfAborted();
            loading = null;
            start(candidate);
            focusFrame(string(detail.region), true);
          } else {
            loading = null;
            setup('existing');
            presentation.prepareIdentity(`${string(detail.region)} copy`);
            message('Imported artwork: copy the selected source to native artwork to edit.');
            controls();
            input('art-name').focus();
          }
        } catch (error) {
          if (lifetime.disposed) {
            return;
          }
          if (signal.aborted && error instanceof DOMException && error.name === 'AbortError') {
            loading = null;
            session = outgoing;
            if (outgoing && wasArtwork) {
              restore(outgoing);
            } else {
              workspace(false);
              tabs();
            }
          } else {
            session = outgoing;
            loading = { label: `${string(detail.atlas)} / ${string(detail.region)}`, failed: true };
            retryOpen = () => {
              void openLibrary(detail);
            };
            feedback.error(
              `Could not open artwork: ${feedbackText(error)} Retry opening or choose another Library asset.`,
              'artwork-open',
            );
            controls();
          }
        }
      }, 'artwork-open');
    } finally {
      if (libraryOpen === owner) {
        libraryOpen = null;
      }
      finished();
    }
  }
  lifetime.assign(button('art-loading-cancel'), 'onclick', () => {
    if (libraryOpen) {
      libraryOpen.controller.abort();
    } else {
      loading = null;
      if (session) {
        restore(session);
      } else {
        workspace(false);
        tabs();
        controls();
      }
    }
  });
  lifetime.assign(button('art-loading-retry'), 'onclick', () => retryOpen?.());
  element('palette', HTMLElement).addEventListener(
    'open-artwork',
    (event) => {
      if (event instanceof CustomEvent) {
        void openLibrary(record(event.detail));
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.assign(select('art-source'), 'onchange', () => {
    unavailableSource = null;
    controls();
  });
  function createArtwork() {
    void execute(async () => {
      start(
        await api('artwork-create', decodeCandidate, {
          atlas_id: input('art-id').value,
          name: input('art-name').value,
          kind: select('art-kind').value,
          width: Number(input('art-width').value),
          height: Number(input('art-height').value),
          project_revision: inventoryRevision,
        }),
      );
    });
  }
  function createSheet() {
    void execute(async () => {
      const width = Number(input('art-width').value),
        height = Number(input('art-height').value);
      const fw = Number(input('art-frame-width').value),
        fh = Number(input('art-frame-height').value);
      if (
        !Number.isInteger(fw) ||
        !Number.isInteger(fh) ||
        fw < 8 ||
        fh < 8 ||
        width % fw ||
        height % fh ||
        (width * height) / fw / fh > 128
      ) {
        throw Error('Use aligned frame dimensions dividing the sheet exactly, at most 128 frames.');
      }
      const kind = select('art-kind').value;
      const frames = [];
      for (let y = 0; y < height; y += fh) {
        for (let x = 0; x < width; x += fw) {
          frames.push({
            id: `frame_${frames.length}`,
            name: `Frame ${frames.length + 1}`,
            kind,
            x,
            y,
            width: fw,
            height: fh,
            origin:
              kind === 'tile'
                ? [0, 0]
                : [Number(input('art-origin-x').value), Number(input('art-origin-y').value)],
          });
        }
      }
      start(
        await api('artwork-sheet-create', decodeCandidate, {
          atlas_id: input('art-id').value,
          name: input('art-name').value,
          kind,
          width,
          height,
          frames,
          sequences: [],
          project_revision: inventoryRevision,
        }),
      );
    });
  }
  lifetime.assign(button('art-create'), 'onclick', () => {
    if (input('art-multiple').checked) {
      createSheet();
    } else {
      createArtwork();
    }
  });
  lifetime.assign(button('art-duplicate-sheet'), 'onclick', () => {
    void execute(async () => {
      const source = sources[Number(select('art-source').value)];
      if (!source) {
        throw Error('Choose a source sheet.');
      }
      start(
        await api('artwork-sheet-duplicate', decodeCandidate, {
          source: {
            atlas_id: source.atlas_id,
            region: source.region,
            grid: null,
            cell: null,
            artwork_revision: source.artwork_revision,
          },
          atlas_id: input('art-id').value,
          name: input('art-name').value,
          project_revision: inventoryRevision,
        }),
      );
    });
  });
  lifetime.assign(button('art-open'), 'onclick', () => {
    void execute(async () => {
      const source = sources[Number(select('art-source').value)];
      if (!source?.target) {
        throw Error('Imported artwork must be duplicated before editing.');
      }
      const retained = documents
        .sessions()
        .find((current) => current.model.descriptor.atlas_id === source.atlas_id);
      if (retained) {
        restore(retained);
      } else {
        start(
          await api('artwork-open', decodeCandidate, {
            target: source.target,
            project_revision: inventoryRevision,
            artwork_revision: source.artwork_revision,
          }),
        );
      }
      focusFrame(source.region);
    });
  });
  function selectedPlacements(source: Source): Placement[] {
    if (input('select-all-layers').checked) {
      throw Error(
        'Turn off Across layers and select placements on one active layer for a variation.',
      );
    }
    const loaded = sceneSession.loaded,
      layer = sceneSession.editor?.active;
    if (!loaded || !layer || sceneSession.dirty()) {
      throw Error(
        'Save the scene before creating a placement variation. Local scene edits are retained.',
      );
    }
    const base = { scene_id: loaded.id, scene_revision: loaded.revision, layer_id: layer.id };
    const asset = `${source.atlas_id}/${source.region}`;
    const result: Placement[] = [];
    if (source.kind === 'tile' && layer.type === 'tilelayer' && sceneSelection.selection) {
      const rect = sceneSelection.selection;
      const key = `${asset}/${input('art-cell-x').value}/${input('art-cell-y').value}`;
      if (Number(select('art-source-grid').value) !== loaded.grid) {
        throw Error('Choose the scene grid for selected tile placements.');
      }
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (tileParts(layer.cells[y]?.[x] ?? '')[0] !== key) {
            throw Error('Every selected cell must match the chosen source tile.');
          }
          result.push({ ...base, x, y });
          if (result.length > MAX_PLACEMENTS) {
            throw Error('Select at most 256 placements.');
          }
        }
      }
    } else if (source.kind === 'sprite' && layer.type === 'objectgroup') {
      const ids = new Set(sceneSelection.selectedObjects);
      if (sceneSelection.selectedObject) {
        ids.add(sceneSelection.selectedObject);
      }
      for (const id of ids) {
        const item = layer.objects.find((o) => o.id === id);
        if (item?.kind !== 'sprite' || item.asset !== asset) {
          throw Error('Every selected object must match the chosen source sprite.');
        }
        result.push({ ...base, object_id: Number(id) });
      }
    }
    if (!result.length || result.length > MAX_PLACEMENTS) {
      throw Error('Select 1..256 matching tile cells or sprite objects in the saved scene first.');
    }
    return result;
  }
  for (const id of ['art-duplicate', 'art-variation']) {
    lifetime.assign(button(id), 'onclick', () => {
      void execute(async () => {
        const source = sources[Number(select('art-source').value)];
        if (!source) {
          return;
        }
        const placements = id === 'art-variation' ? selectedPlacements(source) : undefined;
        start(
          await api('artwork-duplicate', decodeCandidate, {
            source: {
              atlas_id: source.atlas_id,
              region: source.region,
              artwork_revision: source.artwork_revision,
              grid: source.kind === 'tile' ? Number(select('art-source-grid').value) : null,
              cell:
                source.kind === 'tile'
                  ? [Number(input('art-cell-x').value), Number(input('art-cell-y').value)]
                  : null,
            },
            atlas_id: input('art-id').value,
            name: input('art-name').value,
            project_revision: inventoryRevision,
            ...(placements ? { placements } : {}),
          }),
        );
      });
    });
  }
  async function close() {
    if (presentationSlot.active) {
      await suspend();
    }
    workspace(false);
    tabs();
  }
  lifetime.assign(button('art-setup-close'), 'onclick', () => void execute(close));
  lifetime.assign(button('scene-document'), 'onclick', () => {
    void execute(close);
  });
  function activateRetained() {
    const next = documents.sessions().at(-1);
    if (!next) {
      return false;
    }
    restore(next);
    return true;
  }
  async function releaseDocument(keep: boolean) {
    cancelGesture();
    lifetime.cancelTimeout(timer);
    timer = undefined;
    sheetEditor.stop();
    const current = session;
    if (keep) {
      await current?.checkpoint();
    } else {
      await current?.removeCheckpoint();
    }
    lifetime.signal.throwIfAborted();
    feedback.clear();
    if (current) {
      documents.remove(current);
    }
    session = null;
    closingAfterSave = null;
    raster.dispose();
    rendering.clear();
    if (!activateRetained()) {
      workspace(false);
      tabs();
    }
    message(
      keep
        ? 'Artwork closed. Draft available in Browse / recover artwork.'
        : 'Artwork document closed.',
    );
  }
  async function requestClose() {
    if (busy || ports.presentation.unavailable() || lifetime.disposed) {
      return;
    }
    cancelGesture();
    sheetEditor.stop();
    const current = session;
    const choice =
      current && (current.changed || current.uncheckpointed)
        ? await ports.confirmClose(current.model.descriptor.name, true)
        : 'discard';
    if (!choice || lifetime.disposed || current !== session || !presentationSlot.active) {
      return;
    }
    if (choice === 'save' && current) {
      closingAfterSave = current;
      if (current.receipt && surface.classList.contains('show-art-review')) {
        controls();
        button('save').focus();
      } else {
        save();
      }
    } else {
      await execute(() => releaseDocument(choice === 'keep'));
    }
  }
  lifetime.assign(button('art-discard'), 'onclick', () => void requestClose());
  lifetime.assign(button('art-cancel-close'), 'onclick', () => {
    closingAfterSave = null;
    controls();
    message('Closing cancelled. Continue editing or save normally.');
  });
  lifetime.assign(select('art-png-scope'), 'onchange', controls);
  lifetime.assign(button('art-download-png'), 'onclick', () => {
    if (!session || busy || gestures.active) {
      return;
    }
    const model = session.model;
    const frame = select('art-png-scope').value === 'frame' ? sheetEditor.selectedFrame() : null;
    if (select('art-png-scope').value === 'frame' && !frame) {
      return;
    }
    const bounds = frame ?? { x: 0, y: 0, width: model.width, height: model.height };
    const safe = (value: string) =>
      value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'artwork';
    const name = `${safe(model.descriptor.atlas_id)}-${frame ? safe(frame.id) : 'sheet'}.png`;
    const acknowledgment = feedback.capture();
    void artworkPng(model.composite(), model.width, bounds)
      .then((blob) => {
        if (lifetime.disposed) {
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        lifetime.revokeLater(url);
      })
      .catch((error: unknown) => acknowledgment.error(error));
  });
  lifetime.assign(button('art-download'), 'onclick', () => {
    if (session) {
      download(session.downloadWork(), 'artwork-work.json');
    }
  });
  function operation(work: () => void) {
    if (!session || busy || gestures.active) {
      return;
    }
    try {
      session.model.apply(work);
      changed();
    } catch (error) {
      blocked(error);
      draw();
    }
  }
  const layerControls = createArtworkLayerControls(lifetime, {
    current: () => session?.model ?? null,
    busy: () => busy,
    cancelGesture,
    draw,
    refreshPalette: () => palette.invalidate(),
    operation,
  });
  button('art-handoff-return').addEventListener(
    'click',
    () =>
      void execute(async () => {
        const current = session;
        if (!current) {
          return;
        }
        await current.checkpoint();
        const value = await current.synchronizeCurrent();
        const handle = await api('artwork-candidate-retain', record, {
          candidate: value,
          owner: current.owner,
        });
        const result = element('art-handoff-result', HTMLElement);
        result.textContent = JSON.stringify(handle, null, 2);
        result.hidden = false;
        download(handle, `${value.atlas_id}-handoff.json`);
        message(
          'Unpublished candidate retained. Agent can list/export this exact revision. Saved artwork is unchanged.',
        );
      }),
    { signal: lifetime.signal },
  );
  lifetime.assign(button('art-transparent'), 'onclick', () => {
    input('art-alpha').value = Number(input('art-alpha').value) === 0 ? String(drawingAlpha) : '0';
    reflectOpacity();
  });
  input('art-alpha').addEventListener('input', reflectOpacity, { signal: lifetime.signal });
  input('art-color').addEventListener(
    'input',
    () => {
      if (Number(input('art-alpha').value) === 0) {
        input('art-alpha').value = String(drawingAlpha);
      }
      reflectOpacity();
    },
    { signal: lifetime.signal },
  );
  reflectOpacity();
  for (const id of ['art-zoom', 'art-grid']) {
    element(id, HTMLElement).addEventListener(
      'change',
      () => {
        cancelGesture();
        draw();
      },
      { signal: lifetime.signal },
    );
  }
  surface.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('dialog[open], [popover]:popover-open:not(.notifications)')
      ) {
        return;
      }
      if (event.key === 'Escape' && gestures.active) {
        event.preventDefault();
        event.stopPropagation();
        cancelGesture();
        return;
      }
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        event.stopPropagation();
        void execute(close);
        return;
      }
      if (
        busy ||
        !session ||
        (event.target instanceof HTMLInputElement && event.target.type !== 'radio') ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !gestures.active &&
        !(
          event.target instanceof Element &&
          event.target.closest('button, a, [contenteditable]:not([contenteditable="false"])')
        )
      ) {
        const tools: Record<string, string> = {
          p: 'pencil',
          e: 'erase',
          f: 'fill',
          s: 'select',
          i: 'pick',
          l: 'line',
          r: 'rectangle',
          m: 'move',
        };
        const key = event.key.toLowerCase();
        if (key === 'h') {
          event.preventDefault();
          if (button('art-pan').getAttribute('aria-pressed') !== 'true') {
            button('art-pan').click();
          }
          return;
        }
        if (tools[key]) {
          const control = surface.querySelector<HTMLInputElement>(
            `input[name="art-tool"][value="${tools[key]}"]`,
          );
          if (control && !control.disabled) {
            event.preventDefault();
            control.checked = true;
            control.dispatchEvent(new Event('change'));
          }
          return;
        }
      }
      if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
        document.activeElement === canvas
      ) {
        event.preventDefault();
        operation(() =>
          session?.model.move(
            event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0,
            event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0,
          ),
        );
      }
    },
    { signal: lifetime.signal },
  );
  async function reviewCurrent() {
    reviewPanel(true);
    if (!session) {
      return;
    }
    cancelGesture();
    lifetime.cancelTimeout(timer);
    timer = undefined;
    await session.checkpoint();
    const candidate = await session.synchronizeCurrent();
    element('art-draft-status', HTMLElement).textContent = session.changed
      ? 'Unsaved artwork checkpointed in this project.'
      : 'Saved artwork checkpointed in this project.';
    let scene: Record<string, unknown> | null = null;
    const loaded = sceneSession.loaded;
    if (loaded && sceneSession.editor && input('art-use-scene').checked) {
      const model = structuredClone(sceneSession.serialize());
      const x = Number(input('art-view-x').value),
        y = Number(input('art-view-y').value);
      if (candidate.placements && sceneSession.dirty()) {
        throw Error('Save or reconcile scene edits before reviewing a placement variation.');
      }
      if (candidate.operation !== 'edit' && !candidate.placements) {
        const frame = sheetEditor.selectedFrame();
        const d = frame
          ? { ...candidate.descriptor, ...frame, region: frame.id }
          : candidate.descriptor;
        if (d.kind === 'tile') {
          if (d.width % model.grid !== 0 || d.height % model.grid !== 0) {
            throw Error(
              'This tile is smaller than the scene grid. Uncheck scene preview to review it in isolation.',
            );
          }
          const layer = model.layers.find((l) => l.type === 'tilelayer');
          if (!layer || !('cells' in layer)) {
            throw Error('Add a tile layer for the temporary preview.');
          }
          const cellX = Math.floor(x / model.grid),
            cellY = Math.floor(y / model.grid);
          const rows = layer.cells;
          if (
            !Array.isArray(rows) ||
            !Array.isArray(rows[cellY]) ||
            cellX >= model.width ||
            cellY >= model.height
          ) {
            throw Error('Preview position must be inside the open scene.');
          }
          const columns = d.width / model.grid,
            rowsCount = d.height / model.grid;
          if (cellX + columns > model.width || cellY + rowsCount > model.height) {
            throw Error('The temporary tile placement must fit inside the scene.');
          }
          for (let dy = 0; dy < rowsCount; dy++) {
            for (let dx = 0; dx < columns; dx++) {
              rows[cellY + dy][cellX + dx] = `${d.atlas_id}/${d.region}/${dx}/${dy}`;
            }
          }
        } else {
          const layer = model.layers.find((l) => l.type === 'objectgroup');
          if (!layer || !('objects' in layer)) {
            throw Error('Add an object layer for the temporary sprite preview.');
          }
          layer.objects.push({
            id: model.next_object_id++,
            name: 'Artwork preview',
            class: '',
            asset: `${d.atlas_id}/${d.region}`,
            x: x + d.origin[0],
            y: y + d.origin[1],
            properties: [],
          });
        }
      }
      scene = {
        scene_id: loaded.id,
        scene_revision: loaded.revision,
        scene: candidate.placements ? null : model,
        viewport: { x, y, width: 256, height: 256 },
      };
    }
    const result = await api('artwork-review', record, {
      candidate,
      scale: 4,
      ...(input('art-review-detail').checked
        ? {
            rectangle: {
              x: Number(input('art-review-x').value),
              y: Number(input('art-review-y').value),
              width: Number(input('art-review-width').value),
              height: Number(input('art-review-height').value),
            },
          }
        : {}),
      scene,
    });
    session.receipt = record(result.receipt);
    const before = result.before === null ? null : record(result.before),
      after = record(result.after);
    element('art-review-view', HTMLElement).textContent =
      number(after.sample_step) > 1
        ? 'Whole artwork overview · use Artwork detail view to inspect individual pixels.'
        : 'Native pixel review · selected view.';
    const previews: [string, unknown][] = [
      ['art-before', before?.enlarged_png],
      ['art-after', after.enlarged_png],
      ['art-scene-before', result.scene === null ? undefined : record(result.scene).before_png],
      ['art-scene-after', result.scene === null ? undefined : record(result.scene).after_png],
    ];
    for (const [id, value] of previews) {
      const image = element(id, HTMLImageElement);
      image.closest('figure')?.toggleAttribute('hidden', value === undefined);
      if (value !== undefined) {
        image.src = `data:image/png;base64,${string(value)}`;
      }
    }
    const references = record(result.references);
    element('art-references', HTMLElement).textContent = candidate.placements
      ? `${candidate.placements.length} selected replacements out of ${number(references.total)} saved source references. Only these selections change; other scenes, stamps and definitions retain the original.`
      : candidate.operation === 'edit'
        ? `${number(references.total)} saved references to this asset. Saving a shared edit updates all of them. Preview placements are temporary.`
        : 'New independent artwork. Confirm save adds it to the Library; place it separately. Existing artwork and placements remain intact.';
    const locations = array(references.locations, record);
    element('art-reference-details', HTMLElement).hidden = number(references.total) === 0;
    element('art-reference-summary', HTMLElement).textContent =
      `Saved source references · ${number(references.total)} total`;
    element('art-reference-scenes', HTMLElement).textContent = array(references.scenes, record)
      .map((scene) => {
        const name = workspaceState.sceneChoices.find((s) => s.id === scene.id)?.name ?? scene.id;
        return `${String(name)} (${number(scene.placements)} placements)`;
      })
      .join('; ');
    element('art-reference-locations', HTMLElement).replaceChildren(
      ...locations.map((location) => {
        const item = document.createElement('li');
        const kind = string(location.kind);
        const id = location[`${kind}_id`];
        const position =
          location.object_id !== undefined
            ? ` · object ${number(location.object_id)}`
            : location.x !== undefined
              ? ` · cell ${number(location.x)}, ${number(location.y)}`
              : '';
        item.textContent = `${kind} ${String(id)}${location.layer_id !== undefined ? ` · layer ${number(location.layer_id)}` : ''}${position} · ${string(location.asset)}`;
        return item;
      }),
    );
    element('art-reference-limit', HTMLElement).textContent = references.locations_complete
      ? 'All saved source locations shown. Selected variations replace only the captured selections listed above.'
      : `Showing ${locations.length} of ${number(references.total)} saved source locations. The affected scene summary includes every scanned scene. Use MCP review reference pagination for additional exact locations. Selected variations replace only captured selections.`;
    element('art-comparison', HTMLElement).hidden = false;
    reviewPanel(true);
    message('Review ready. Saving commits exactly these pixels against the reviewed saved bases.');
  }
  lifetime.assign(button('art-review'), 'onclick', () => {
    void execute(reviewCurrent, 'review');
  });
  function save() {
    const reviewing = !session?.receipt || !surface.classList.contains('show-art-review');
    const work = async () => {
      const current = session;
      if (!current) {
        return;
      }
      if (!current.receipt || !surface.classList.contains('show-art-review')) {
        try {
          await reviewCurrent();
        } catch (error) {
          closingAfterSave = null;
          throw error;
        }
        button('save').focus();
        if (closingAfterSave === current) {
          message(
            'Review artwork, then Confirm save to close. Cancel closing keeps this document open.',
          );
        }
        return;
      }
      cancelGesture();
      if (current.candidate.placements && sceneSession.dirty()) {
        throw Error('Local scene edits are retained. Reconcile them before saving this variation.');
      }
      lifetime.cancelTimeout(timer);
      timer = undefined;
      const reviewedScenes = record(current.receipt.scene_revisions);
      const ack = await api('artwork-save', record, {
        candidate: current.candidate,
        receipt: current.receipt,
      });
      if (ack.candidate_revision !== current.candidate.revision) {
        throw Error('Save acknowledgment did not match submitted artwork.');
      }
      // Retire the submitted base before any fallible post-commit work.
      remember();
      const retained = documents.get(current);
      feedback.clear();
      session = null;
      documents.remove(current);
      try {
        await current.removeCheckpoint();
        await ports.saved(ack, reviewedScenes);
        const saved = await api('artwork-open', decodeCandidate, {
          target: {
            atlas_id: current.model.descriptor.atlas_id,
            document_id: current.model.descriptor.id,
            region: current.model.descriptor.region,
          },
          artwork_revision: ack.artwork_revision,
          project_revision: ack.project_revision,
        });
        current.adoptSaved(saved);
        savedDocumentIds?.add(saved.document_id);
        session = current;
        documents.add(current, retained);
        reviewPanel(false);
        invalidate();
        describe(saved);
        draw();
        tabs();
        if (closingAfterSave === current) {
          await releaseDocument(false);
        } else {
          message('Artwork saved. Continue editing or return to the scene.');
        }
      } catch (error) {
        // The exact save already succeeded. Cleanup/adoption failures must not
        // turn this document back into a stale editable candidate.
        controls();
        tabs();
        message(
          `Artwork saved. ${error instanceof Error ? error.message : String(error)} Close this surface and refresh before continuing.`,
          true,
        );
      }
    };
    void execute(work, reviewing ? 'review' : 'save');
  }
  for (const id of ['art-view-x', 'art-view-y', 'art-use-scene']) {
    input(id).addEventListener(
      'input',
      () => {
        invalidate();
        controls();
      },
      { signal: lifetime.signal },
    );
  }
  window.addEventListener(
    'beforeunload',
    (event) => {
      if (
        session?.uncheckpointed ||
        documents.sessions().some((current) => current.uncheckpointed) ||
        gestures.active
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => {
    lifetime.cancelTimeout(timer);
    cancelGesture();
    session = null;
    document.body.classList.remove('editing-artwork');
  });
  let discovering = false;
  let discoveredRevision = '';
  let interaction = 0;
  const pointers = new Set<number>();
  for (const event of ['pointerdown', 'keydown', 'input', 'change', 'wheel', 'focusin']) {
    window.addEventListener(
      event,
      () => {
        interaction++;
      },
      { signal: lifetime.signal, capture: true },
    );
  }
  window.addEventListener('pointerdown', (event) => pointers.add(event.pointerId), {
    signal: lifetime.signal,
    capture: true,
  });
  for (const event of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(event, (event) => pointers.delete(event.pointerId), {
      signal: lifetime.signal,
      capture: true,
    });
  }
  window.addEventListener(
    'blur',
    () => {
      interaction++;
      pointers.clear();
    },
    {
      signal: lifetime.signal,
    },
  );

  function syncArtworkUpdates() {
    const saved = session?.original.operation === 'edit';
    const missing =
      saved && session && savedDocumentIds && !savedDocumentIds.has(session.original.document_id);
    const stale = saved && session?.externalChanged;
    const text =
      discoveryError ||
      (missing
        ? 'This artwork is no longer available. Your open version is preserved; download work to keep a copy.'
        : stale
          ? session?.changed
            ? 'Live updates paused · unsaved edits. Download work to keep a copy, or load the latest saved version.'
            : input('auto-refresh').checked
              ? ''
              : 'A newer version is available. Load the latest saved version.'
          : '');
    element('art-sync', HTMLElement).hidden = !text;
    element('art-sync-status', HTMLElement).textContent = text;
    button('art-sync-load').hidden = !stale || !!missing;
    button('art-sync-load').disabled = busy;
    button('art-sync-load').textContent = session?.changed ? 'Load latest…' : 'Load latest';
    button('art-sync-download').hidden = !session || (!stale && !discoveryError && !missing);
    button('art-sync-download').disabled = busy;
    button('art-sync-retry').hidden = !discoveryError;
    button('art-sync-retry').disabled = busy;
  }

  async function loadLatest(current: ArtworkSession, eligible: () => boolean, discard = false) {
    if (current.original.operation !== 'edit') {
      return;
    }
    const canApply = () => eligible() && (discard || (!current.changed && !current.uncheckpointed));
    if (!canApply()) {
      return;
    }
    const project = await api('project', record);
    if (!canApply()) {
      return;
    }
    const listing = await api('artwork-list', record, { project_revision: project.revision });
    if (!canApply()) {
      return;
    }
    const entry = array(listing.documents, record).find(
      (d) =>
        record(d.target).document_id === current.original.document_id &&
        record(d.target).atlas_id === current.original.atlas_id,
    );
    if (!entry) {
      savedDocumentIds?.delete(current.original.document_id);
      syncArtworkUpdates();
      return;
    }
    const next = await api('artwork-open', decodeCandidate, {
      target: entry.target,
      project_revision: project.revision,
      artwork_revision: entry.artwork_revision,
    });
    if (!canApply()) {
      return;
    }
    const latest = await api('revisions', record);
    if (!canApply() || latest.revision !== next.project_revision) {
      return;
    }
    // Retire only this session's checkpoint after staging and revalidating all
    // reads. A clean automatic refresh never races uncertain/queued local work.
    const alreadyBusy = busy;
    busy = true;
    controls();
    // Stop the debounce before removeCheckpoint drains already-queued writes;
    // otherwise it can enqueue a new write while checkpoint deletion awaits.
    lifetime.cancelTimeout(timer);
    timer = undefined;
    try {
      await current.removeCheckpoint();
    } finally {
      busy = alreadyBusy;
      if (!lifetime.disposed) {
        controls();
      }
    }
    if (!canApply()) {
      return;
    }
    // There are no awaits between the final fence and replacement. External
    // content gets a fresh model/history; old Undo/Redo cannot replay over it.
    remember();
    const retained = documents.get(current);
    const replacement = new ArtworkSession(next, api);
    if (
      current.model.activeLayer &&
      next.descriptor.layers?.items.some((l) => l.id === current.model.activeLayer)
    ) {
      replacement.model.selectLayer(current.model.activeLayer);
    }
    documents.remove(current);
    documents.add(replacement, retained ? { ...retained, session: replacement } : undefined);
    restore(replacement, { focus: false, preservePanels: true });
    discoveryError = '';
    discoveryFailures = 0;
    syncArtworkUpdates();
  }

  const reloadDialog = element('art-reload-dialog', HTMLDialogElement);
  let reloadSession: ArtworkSession | null = null;
  for (const id of ['art-sync-download', 'art-reload-download']) {
    lifetime.assign(button(id), 'onclick', () => {
      if (session) {
        download(session.downloadWork(), 'artwork-work.json');
      }
    });
  }
  function reloadArtwork() {
    const current = session;
    if (!current) {
      return;
    }
    void execute(async () => {
      await loadLatest(
        current,
        () => !lifetime.disposed && session === current && presentationSlot.active,
        true,
      );
    }, 'reload-artwork');
  }
  lifetime.assign(button('art-sync-load'), 'onclick', () => {
    if (session?.changed || session?.uncheckpointed) {
      reloadSession = session;
      reloadDialog.showModal();
    } else {
      reloadArtwork();
    }
  });
  lifetime.assign(button('art-reload-cancel'), 'onclick', () => reloadDialog.close());
  lifetime.assign(button('art-reload-confirm'), 'onclick', () => {
    reloadDialog.close();
    if (session === reloadSession) {
      reloadArtwork();
    }
    reloadSession = null;
  });
  lifetime.cleanup(() => reloadDialog.close());
  lifetime.assign(button('art-sync-retry'), 'onclick', () => void discover(true));
  async function discover(manual = false) {
    const generation = interaction;
    const current = session;
    const eligible = () =>
      interaction === generation &&
      session === current &&
      !lifetime.disposed &&
      presentationSlot.active &&
      !busy &&
      !ports.presentation.unavailable() &&
      !gestures.active &&
      !pointers.size &&
      (manual || input('auto-refresh').checked) &&
      document.visibilityState === 'visible' &&
      !document.querySelector('dialog:modal, [popover]:popover-open:not(.notifications)') &&
      !document.activeElement?.matches('input, select, textarea, [contenteditable="true"]');
    if (discovering || !eligible()) {
      return;
    }
    discovering = true;
    try {
      const data = await api('project', record);
      // The composition loads its initial catalog after mounting this controller.
      if (!eligible()) {
        return;
      }
      if (
        data.revision !== (discoveredRevision || workspaceState.revision) ||
        data.revision !== inventoryRevision
      ) {
        await ports.discovered(data, eligible);
        if (!eligible()) {
          return;
        }
        await inventory(true, eligible);
        if (!eligible()) {
          return;
        }
        discoveredRevision = string(data.revision);
      }
      if (
        current?.externalChanged &&
        !current.changed &&
        savedDocumentIds?.has(current.original.document_id)
      ) {
        await loadLatest(current, eligible);
        if (session !== current) {
          return;
        }
      }
      if (!eligible()) {
        return;
      }
      discoveryFailures = 0;
      discoveryError = '';
      syncArtworkUpdates();
      if (!session) {
        controls();
      }
    } catch (error) {
      if (eligible()) {
        // A writer may briefly hold the lock. Retry quietly before surfacing a
        // persistent problem inline; background checks never create error toasts.
        discoveryFailures++;
        if (manual || discoveryFailures >= ARTWORK_DISCOVERY_FAILURES_BEFORE_NOTICE) {
          discoveryError = `Couldn’t check for updates. Your work is preserved. ${feedbackText(error)}`;
          syncArtworkUpdates();
        }
      }
    } finally {
      discovering = false;
    }
  }
  lifetime.interval(() => void discover(), ARTWORK_DISCOVERY_INTERVAL_MS);
  window.addEventListener('focus', () => void discover(), { signal: lifetime.signal });
  window.addEventListener('online', () => void discover(), { signal: lifetime.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      interaction++;
      if (document.visibilityState === 'visible') {
        void discover();
      }
    },
    { signal: lifetime.signal },
  );
  input('auto-refresh').addEventListener(
    'change',
    () => {
      syncArtworkUpdates();
      void discover();
    },
    {
      signal: lifetime.signal,
    },
  );
  button('check-external').addEventListener(
    'click',
    () => {
      element('project-command-panel', HTMLElement).hidePopover();
      void discover(true);
    },
    {
      signal: lifetime.signal,
    },
  );
  return {
    activateRetained,
    commands(): CommandCapabilities {
      if (!session || loading) {
        return {
          close: {
            enabled: presentationSlot.active && !busy && !ports.presentation.unavailable(),
            run: () => void requestClose(),
          },
        };
      }
      const model = session.model;
      const ready =
        presentationSlot.active &&
        !!model &&
        !loading &&
        !busy &&
        !ports.presentation.unavailable() &&
        !gestures.active;
      const writable =
        ready &&
        !model?.descriptor.layers?.items.find((layer) => layer.id === model.activeLayer)?.locked;
      return {
        close: {
          enabled:
            presentationSlot.active &&
            !busy &&
            !ports.presentation.unavailable() &&
            !gestures.active,
          run: () => void requestClose(),
        },
        save: {
          enabled: ready,
          run: save,
          label:
            session?.receipt && surface.classList.contains('show-art-review')
              ? closingAfterSave === session
                ? 'Confirm save and close'
                : 'Confirm save'
              : 'Save artwork…',
        },
        undo: {
          enabled: ready && !!model?.undoStack.length,
          run: () => {
            model?.undo();
            changed();
          },
        },
        redo: {
          enabled: ready && !!model?.redoStack.length,
          run: () => {
            model?.redo();
            changed();
          },
        },
        copy: {
          enabled: ready,
          run: () => {
            model?.copy();
            controls();
          },
        },
        cut: { enabled: writable, run: () => operation(() => model?.cut()) },
        paste: {
          enabled: writable && !!model?.clipboard,
          run: () => operation(() => model?.paste()),
        },
        deselect: {
          enabled: ready && !!model?.selection,
          run: () => {
            if (model) {
              model.selection = null;
            }
            draw();
          },
        },
        horizontal: {
          enabled: writable,
          run: () => operation(() => model?.transform('horizontal')),
        },
        vertical: { enabled: writable, run: () => operation(() => model?.transform('vertical')) },
        rotate: { enabled: writable, run: () => operation(() => model?.transform('rotate')) },
      };
    },
    syncNavigation,
    prepareDeparture: suspend,
    async activateScene() {
      let succeeded = false;
      await execute(async () => {
        await close();
        succeeded = true;
      });
      return succeeded;
    },
    get open() {
      return presentationSlot.active;
    },
  };
}
