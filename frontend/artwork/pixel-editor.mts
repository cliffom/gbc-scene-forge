/** Artwork composition: document transitions, review/save and recovery with typed ports. */
import { MAX_PLACEMENTS } from './placement-limits.mts';
import { createArtworkLayerControls } from './artwork-layer-controls.mts';
import { paletteColors } from './artwork-palette.mts';
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
  let loading: { label: string; failed: boolean } | null = null;
  let libraryOpen: { controller: AbortController; done: Promise<void> } | null = null;
  let retryOpen: (() => void) | null = null;
  let libraryRequest = 0;
  let sources: Source[] = [];
  let unavailableSource: Source | null = null;
  let inventoryRevision = workspaceState.revision;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paletteSignature = '';
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
    () => ports.presentation.commandsChanged(),
  );
  const { setup } = presentation;
  function reviewPanel(open: boolean) {
    presentation.reviewPanel(open);
    if (open) {
      ports.presentation.revealInspector();
    }
  }
  for (const id of ['art-properties-toggle', 'art-layers-toggle']) {
    button(id).addEventListener('click', () => ports.presentation.revealInspector(), {
      signal: lifetime.signal,
    });
  }
  function focusFrame(region: string) {
    const d = session?.model.descriptor;
    if (session && d?.version === 2 && d.frames.some((f) => f.id === region)) {
      if (select('art-frame').value !== region) {
        session.model.selection = null;
      }
      select('art-frame').value = region;
      // Keep the collection visible while highlighting the requested pose.
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
  function restore(current: ArtworkSession) {
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
    workspace(true);
    presentation.resetPanels();
    describe(current.candidate);
    element('artwork-heading', HTMLElement).textContent = current.model.descriptor.name;
    paletteSignature = '';
    draw();
    swatches();
    artworkViewport.restore(saved.view);
    tabs();
    canvas.focus({ preventScroll: true });
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
      feedback.show(text);
    }
  }
  function blocked(error: unknown) {
    const text = feedbackText(error);
    feedback.warning(text === 'Layer is locked.' ? 'Layer is locked. Unlock it to edit.' : text);
  }
  function controls() {
    feedback.sync();
    if (busy) {
      element('art-palette', HTMLElement).hidePopover();
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
    button('art-properties-toggle').hidden = !active;
    button('art-palette-toggle').hidden = !active;
    element('art-document-geometry', HTMLElement).textContent = session
      ? `${session.model.descriptor.width} × ${session.model.descriptor.height} pixels · ${session.model.descriptor.name}`
      : '';
    element('art-frame-properties', HTMLElement).hidden = session?.model.descriptor.version !== 2;
    button('art-layers-toggle').hidden = !active;
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
    const label = modified ? 'Discard draft…' : 'Close artwork';
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
    button('art-palette-toggle').style.setProperty(
      '--swatch',
      `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`,
    );
    for (const swatch of element('art-swatches', HTMLElement).querySelectorAll('button')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.rgba === c.join(',')));
    }
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
    if (gestureOnly) {
      dirtyControls();
    } else {
      controls();
    }
    artworkViewport.layout();
  }
  function swatches() {
    const pixels = session?.model.pixels;
    if (!pixels) {
      return;
    }
    const { colors, limited } = paletteColors(pixels);
    const signature = JSON.stringify({ colors, limited });
    if (signature === paletteSignature) {
      return;
    }
    paletteSignature = signature;
    element('art-palette-count', HTMLElement).textContent = limited
      ? `${colors.length} colors shown · use the eyedropper for additional colors.`
      : `${colors.length} colors · sorted by hue`;
    element('art-swatches', HTMLElement).replaceChildren(
      ...colors.map((c) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.title = `RGBA ${c.join(', ')}`;
        swatch.setAttribute('aria-label', swatch.title);
        swatch.style.setProperty('--swatch', `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`);
        swatch.dataset.rgba = c.join(',');
        swatch.onclick = () => {
          if (busy) {
            return;
          }
          chooseColor(c);
          element('art-palette', HTMLElement).hidePopover();
          button('art-palette-toggle').focus();
        };
        return swatch;
      }),
    );
  }
  const palettePanel = element('art-palette', HTMLElement);
  palettePanel.addEventListener(
    'keydown',
    (event) => {
      const buttons = [...palettePanel.querySelectorAll('button')];
      const index = buttons.findIndex((button) => button === document.activeElement);
      const step: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: 12,
        ArrowUp: -12,
      };
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        palettePanel.hidePopover();
        button('art-palette-toggle').focus();
      } else if (event.key in step || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(0, Math.min(buttons.length - 1, index + step[event.key]));
        buttons[next]?.focus();
      }
    },
    { signal: lifetime.signal },
  );
  function positionPalette(height = palettePanel.offsetHeight) {
    const trigger = button('art-palette-toggle').getBoundingClientRect();
    palettePanel.style.left = `${Math.max(8, Math.min(trigger.left, window.innerWidth - 350))}px`;
    palettePanel.style.top = `${Math.max(8, Math.min(trigger.bottom + 5, window.innerHeight - Math.min(380, height) - 8))}px`;
  }
  palettePanel.addEventListener(
    'beforetoggle',
    (event) => {
      if (event.newState === 'open') {
        // Native toggle fires after visibility changes. Bound the first visible
        // frame too, including after a viewport resize while the popover was closed.
        positionPalette(380);
      }
    },
    { signal: lifetime.signal },
  );
  palettePanel.addEventListener(
    'toggle',
    () => {
      if (palettePanel.matches(':popover-open')) {
        positionPalette();
        palettePanel.querySelector('button')?.focus();
      }
    },
    { signal: lifetime.signal },
  );
  window.addEventListener(
    'resize',
    () => {
      if (palettePanel.matches(':popover-open')) {
        positionPalette();
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => {
    palettePanel.hidePopover();
    element('art-swatches', HTMLElement).replaceChildren();
  });
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
    feedback.clear('message');
    invalidate();
    swatches();
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
    paletteSignature = '';
    describe(candidate);
    presentation.resetPanels();
    element('art-timeline', HTMLDetailsElement).open = false;
    input('art-review-detail').checked = false;
    input('art-review-x').value = '0';
    input('art-review-y').value = '0';
    input('art-review-width').value = String(Math.min(256, candidate.descriptor.width));
    input('art-review-height').value = String(Math.min(256, candidate.descriptor.height));
    documentState();
    input('art-edit-frame').checked = false;
    invalidate();
    swatches();
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
    element('art-layer-panel', HTMLElement).hidden = true;
    button('art-layers-toggle').setAttribute('aria-expanded', 'false');
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
            focusFrame(string(detail.region));
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
  lifetime.assign(button('scene-document'), 'onclick', () => {
    void execute(close);
  });
  lifetime.assign(button('art-discard'), 'onclick', () => {
    void execute(async () => {
      cancelGesture();
      lifetime.cancelTimeout(timer);
      timer = undefined;
      await session?.removeCheckpoint();
      if (session) {
        feedback.clear();
        documents.remove(session);
      }
      session = null;
      raster.dispose();
      rendering.clear();
      workspace(false);
      tabs();
      message('Artwork document closed.');
    });
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
    opening: () => {
      reviewPanel(false);
    },
    current: () => session?.model ?? null,
    busy: () => busy,
    cancelGesture,
    draw,
    refreshPalette: swatches,
    operation,
  });
  button('art-handoff-list').addEventListener(
    'click',
    () =>
      void execute(async () => {
        const listing = await api('artwork-candidate-list', record, {});
        const container = element('art-handoff-candidates', HTMLElement);
        container.replaceChildren();
        for (const handle of array(listing.candidates, record)) {
          if (handle.error) {
            continue;
          }
          const row = document.createElement('section');
          const title = document.createElement('p');
          title.textContent = `${string(handle.name)} · ${string(handle.handle)}`;
          const inspect = document.createElement('button');
          inspect.type = 'button';
          inspect.textContent = 'Inspect snapshot';
          const adopt = document.createElement('button');
          adopt.type = 'button';
          adopt.textContent = 'Adopt a copy';
          const candidateHandle = {
            handle: handle.handle,
            project_id: handle.project_id,
            project_revision: handle.project_revision,
            revision: handle.revision,
            ...(handle.owner ? { owner: handle.owner } : {}),
          };
          inspect.onclick = () =>
            void execute(async () => {
              const value = await api('artwork-candidate-export', decodeCandidate, {
                candidate: candidateHandle,
              });
              const preview = document.createElement('canvas');
              preview.width = value.descriptor.width;
              preview.height = value.descriptor.height;
              preview.style.maxWidth = '256px';
              preview.style.maxHeight = '256px';
              preview.style.imageRendering = 'pixelated';
              const raw = Uint8ClampedArray.from(atob(value.rgba), (c) => c.charCodeAt(0));
              preview
                .getContext('2d')
                ?.putImageData(new ImageData(raw, preview.width, preview.height), 0, 0);
              row.querySelector('canvas')?.remove();
              row.append(preview);
              download(value, `${value.atlas_id}-candidate.json`);
            });
          adopt.onclick = () =>
            void execute(async () => {
              if (documents.size >= MAX_OPEN_ARTWORK_DOCUMENTS) {
                throw Error('Close an artwork document first (limit 16).');
              }
              await suspend();
              const adopted = await api('artwork-candidate-adopt', record, {
                candidate: candidateHandle,
                owner: crypto.randomUUID(),
              });
              const value = await api('artwork-candidate-export', decodeCandidate, {
                candidate: adopted,
              });
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
                'Adopted a separate unpublished copy with a new Undo history. Original candidate retained.',
              );
            });
          row.append(title, inspect, adopt);
          container.append(row);
        }
      }),
    { signal: lifetime.signal },
  );
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
      if (element('art-palette', HTMLElement).matches(':popover-open')) {
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
        await reviewCurrent();
        button('save').focus();
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
        session = current;
        documents.add(current, retained);
        reviewPanel(false);
        invalidate();
        describe(saved);
        draw();
        tabs();
        message('Artwork saved. Continue editing or return to the scene.');
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
  for (const event of ['pointerdown', 'keydown', 'input']) {
    window.addEventListener(
      event,
      () => {
        interaction++;
      },
      { signal: lifetime.signal, capture: true },
    );
  }
  async function discover(manual = false) {
    const generation = interaction;
    const current = session;
    const eligible = () =>
      interaction === generation &&
      session === current &&
      !lifetime.disposed &&
      presentationSlot.active &&
      !busy &&
      !gestures.active &&
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
      if (!eligible() || data.revision === (discoveredRevision || workspaceState.revision)) {
        return;
      }
      await ports.discovered(data, eligible);
      if (!eligible()) {
        return;
      }
      await inventory(true, eligible);
      if (!eligible()) {
        return;
      }
      if (!session) {
        controls();
      }
      discoveredRevision = string(data.revision);
    } catch (error) {
      if (!lifetime.disposed) {
        message(`Library refresh unavailable. Local work kept. ${String(error)}`, true);
      }
    } finally {
      discovering = false;
    }
  }
  lifetime.interval(() => void discover(), ARTWORK_DISCOVERY_INTERVAL_MS);
  window.addEventListener('focus', () => void discover(), { signal: lifetime.signal });
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
    commands(): CommandCapabilities {
      const model = session?.model;
      const ready =
        presentationSlot.active &&
        !!model &&
        !busy &&
        !ports.presentation.unavailable() &&
        !gestures.active;
      const writable =
        ready &&
        !model?.descriptor.layers?.items.find((layer) => layer.id === model.activeLayer)?.locked;
      return {
        save: {
          enabled: ready,
          run: save,
          label:
            session?.receipt && surface.classList.contains('show-art-review')
              ? 'Confirm save'
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
