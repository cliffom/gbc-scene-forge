import { $, requireValue } from './dom.mts';
import { Editor, clone } from './model.mts';
import { errorDetails } from './errors.mts';
import { download, guarded, status } from './ui.mts';
import * as decode from './decode.mts';
import type { ApiClient } from './api.mts';
import type { Assets } from './assets.mts';
import type { Renderer } from './render.mts';
import type { Interactions } from './interactions.mts';
import type { EditorSession } from './session.mts';
import type { Draft, LoadedDocument, Scene } from './types.ts';
export function createDocuments(
  state: EditorSession,
  client: ApiClient,
  assets: Assets,
  renderer: Renderer,
  interactions: Interactions,
  updateApplyAvailability: () => void,
) {
  const api = client.request.bind(client),
    json = client.json.bind(client);
  const { entries, chooseBrush } = assets;
  const { setTool, renderReferences } = interactions;
  const { draw, refreshPreview } = renderer;
  let revision: string | null = null,
    saved = '',
    savedId: string | null = null;
  let originals = new Set<string>(),
    openedOriginal = false;
  let revertScene: Scene | null = null;
  let dirty = false;
  function markChanged() {
    $('scene-id').value = savedId || '';
    dirty = JSON.stringify(state.editor.scene) !== saved;
    $('save').disabled = savingDraft || !savedId || !dirty;
    $('revert').disabled =
      savingDraft || !dirty || JSON.stringify(state.editor.scene) === JSON.stringify(revertScene);
    $('dirty').textContent = dirty
      ? 'UNSAVED'
      : revision
        ? 'SAVED'
        : openedOriginal
          ? 'ORIGINAL'
          : 'CURRENT';
    $('undo').disabled = !state.editor.undoStack.length;
    $('redo').disabled = !state.editor.redoStack.length;
    updateApplyAvailability();
    updateOriginalAvailability();
  }
  function changed() {
    state.comparison = null;
    // Invalidate any in-flight preview immediately; a stale response must not paint over an edit.
    renderer.invalidate();
    markChanged();
    renderReferences();
    $('validation').textContent = 'Layout changed. Check the scene before exporting.';
    renderer.schedulePreview();
    draw();
  }
  async function mayReplace() {
    if (!dirty) {
      return true;
    }
    const dialog = $('discard');
    dialog.showModal();
    return new Promise((resolve) =>
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), {
        once: true,
      }),
    );
  }
  async function activate(data: LoadedDocument) {
    renderer.invalidate();
    const current = await json(`scene/${data.scene.profile}`, decode.sceneData);
    const locked = current.locked;
    const descriptor = {
      ...state.catalog.profiles[data.scene.profile],
      constraints: current.constraints,
    };
    state.cellSize = descriptor.cell_size;
    state.annotations = current.markers || [];
    state.comparison = null;
    state.gameScene = current.scene;
    state.editor = new Editor(data.scene, locked, descriptor);
    revision = data.revision || null;
    openedOriginal = data.original === true;
    revertScene = clone(state.editor.scene);
    savedId = revision ? data.scene.id : null;
    saved = JSON.stringify(state.editor.scene);
    state.selection = null;
    state.selectedReference = null;
    state.gesture = null;
    $('profile').value = state.editor.scene.profile;
    updateOriginalAvailability();
    $('name').value = state.editor.scene.name;
    const profile = state.catalog.profiles[state.editor.scene.profile];
    renderer.reset();
    $('lighting').replaceChildren(
      ...profile.lighting.map((l) => new Option(l[0].toUpperCase() + l.slice(1), l)),
    );
    $('state').replaceChildren(...profile.states.map((mode) => new Option(mode.label, mode.id)));
    $('state-field').hidden = profile.states.length < 2;
    requireValue($('animate').parentElement).hidden = !profile.animation_frames;
    $('animation-label').textContent = profile.animation_label || 'Animate';
    requireValue($('guides').parentElement).hidden = !profile.guide;
    $('source-label').textContent =
      `${state.catalog.project.source_label} · ${state.cellSize} × ${state.cellSize} TILES`;
    $('dimensions').textContent =
      `${state.editor.scene.width} × ${state.editor.scene.height} TILES`;
    $('scene-type').textContent =
      `${profile.type.toUpperCase()} · ${state.editor.scene.width * state.cellSize} × ${state.editor.scene.height * state.cellSize} px`;
    $('validation').textContent = 'Check the layout before exporting.';
    const initial = entries().find((e) => e.id === state.editor.floor);
    chooseBrush(initial);
    setTool('select');
    markChanged();
    renderReferences();
    await refreshPreview();
    status('Scene loaded. Production sources are unchanged.');
  }
  async function refreshDrafts() {
    const [drafts, available] = await Promise.all([
      json('drafts', decode.drafts),
      json('originals', decode.originals),
    ]);
    originals = new Set(available);
    updateOriginalAvailability();
    $('drafts').replaceChildren(
      new Option('Saved drafts…', ''),
      ...drafts.map((d) => new Option(d.name, d.id)),
    );
    $('delete-drafts').disabled = !drafts.length;
  }
  let deletableDrafts: Draft[] = [];
  $('delete-drafts').onclick = guarded(async () => {
    deletableDrafts = await json('drafts', decode.drafts);
    const list = $('delete-drafts-list');
    list.replaceChildren();
    $('delete-drafts-error').textContent = '';
    $('delete-drafts-confirm').disabled = true;
    for (const draft of deletableDrafts) {
      const row = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = draft.id;
      check.onchange = () => {
        $('delete-drafts-confirm').disabled = !list.querySelector('input:checked');
      };
      row.append(check, document.createTextNode(`${draft.name} (${draft.id})`));
      list.append(row);
    }
    if (!deletableDrafts.length) {
      list.textContent = 'No saved drafts.';
    }
    $('delete-drafts-dialog').showModal();
  });
  $('delete-drafts-cancel').onclick = () => $('delete-drafts-dialog').close();
  $('delete-drafts-confirm').onclick = async () => {
    const button = $('delete-drafts-confirm');
    button.disabled = true;
    const selected = new Set(
      [...$('delete-drafts-list').querySelectorAll<HTMLInputElement>('input:checked')].map(
        (input) => input.value,
      ),
    );
    try {
      const result = await json('delete-drafts', decode.deletedDrafts, {
        drafts: deletableDrafts
          .filter((d) => selected.has(d.id))
          .map(({ id, revision }) => ({ id, revision })),
      });
      if (savedId && result.deleted.includes(savedId)) {
        savedId = null;
        revision = null;
        saved = '';
        markChanged();
      }
      $('delete-drafts-dialog').close();
      await refreshDrafts();
      status(
        `Deleted ${result.deleted.length} saved draft(s). Current canvas and game files are unchanged.`,
      );
    } catch (cause) {
      const error = errorDetails(cause);
      $('delete-drafts-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  async function validate() {
    const result = await json('validate', decode.validation, { scene: state.editor.scene });
    const div = $('validation');
    div.replaceChildren();
    const line = document.createElement('p');
    line.className = result.valid ? 'success' : 'error';
    line.textContent = result.valid
      ? '✓ Layout passes game-source checks.'
      : 'Layout needs attention.';
    div.append(line);
    for (const error of result.errors) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = error;
      div.append(p);
    }
    status(
      result.valid
        ? 'Layout validated. Visual review and ROM checks remain part of the handoff.'
        : 'Export blocked. Review the scene errors.',
    );
    return result;
  }
  $('undo').onclick = () => {
    state.editor.undo();
    state.selection = null;
    changed();
  };
  $('redo').onclick = () => {
    state.editor.redo();
    state.selection = null;
    changed();
  };
  $('open').onclick = guarded(async () => {
    if (await mayReplace()) {
      await activate(await json(`scene/${$('profile').value}`, decode.sceneData));
    }
  });
  function updateOriginalAvailability() {
    const target = $('profile').value;
    $('original').hidden = !originals.has(target);
    $('original').disabled =
      !!state.editor &&
      target === state.editor.scene.profile &&
      openedOriginal &&
      !savedId &&
      !dirty;
  }
  $('profile').onchange = updateOriginalAvailability;
  $('original').onclick = guarded(async () => {
    if (await mayReplace()) {
      await activate(await json(`original/${$('profile').value}`, decode.loadedDocument));
      status(
        'Original layout loaded. Review and Apply to game to restore it; game files are unchanged.',
      );
    }
  });
  $('new').onclick = guarded(async () => {
    if (await mayReplace()) {
      await activate(await json('new', decode.sceneData, { profile: $('profile').value }));
      saved = '';
      markChanged();
      status('Template loaded. Choose Create draft to name and save it.');
    }
  });
  $('drafts').onchange = guarded(async () => {
    const id = $('drafts').value;
    if (id && (await mayReplace())) {
      await activate(await json(`draft/${id}`, decode.loadedDocument));
    }
    $('drafts').value = '';
  });
  $('import').onclick = () => $('file').click();
  $('file').onchange = guarded(async () => {
    const file = $('file').files?.[0];
    $('file').value = '';
    if (!file || !(await mayReplace())) {
      return;
    }
    if (file.size > 1024 * 1024) {
      throw Error('Scene JSON must be smaller than 1 MiB.');
    }
    const scene: unknown = JSON.parse(await file.text());
    // Preview uses the same authoritative structural validation as saving/export.
    await activate(await json('import', decode.sceneData, { scene }));
    saved = '';
    markChanged();
    status('JSON imported. Choose Create draft to name and save a separate copy.');
  });
  let savingDraft = false;
  async function saveDraft(name?: string) {
    if (savingDraft) {
      return;
    }
    savingDraft = true;
    $('save').disabled = true;
    $('create-draft').disabled = true;
    const documentEditor = state.editor,
      snapshot = clone(state.editor.scene);
    if (name !== undefined) {
      snapshot.name = name;
    }
    try {
      const result = await json('save', decode.savedDraft, {
        scene: snapshot,
        saved_id: name !== undefined ? null : savedId,
        revision: name !== undefined ? null : revision,
      });
      if (state.editor === documentEditor) {
        if (name !== undefined) {
          state.editor.scene.name = name;
          $('name').value = name;
        }
        // History belongs to the newly saved draft, including edits made before creation.
        for (const scene of [...state.editor.undoStack, ...state.editor.redoStack]) {
          scene.id = result.id;
          scene.name = snapshot.name;
        }
        state.editor.scene.id = result.id;
        snapshot.id = result.id;
        revision = result.revision;
        savedId = result.id;
        saved = JSON.stringify(snapshot);
        revertScene = clone(snapshot);
        markChanged();
      }
      await refreshDrafts();
      status(`Saved ${result.path}`);
    } finally {
      savingDraft = false;
      $('create-draft').disabled = false;
      markChanged();
    }
  }
  $('save').onclick = guarded(() => saveDraft());
  $('create-draft').onclick = () => {
    $('create-draft-name').value = state.editor.scene.name;
    $('create-draft-name').setCustomValidity('');
    $('create-draft-error').textContent = '';
    $('create-draft-dialog').showModal();
    $('create-draft-name').select();
  };
  $('create-draft-name').oninput = () => $('create-draft-name').setCustomValidity('');
  $('create-draft-cancel').onclick = () => $('create-draft-dialog').close();
  $('create-draft-dialog').oncancel = (event) => {
    if (savingDraft) {
      event.preventDefault();
    }
  };
  $('create-draft-form').onsubmit = async (event) => {
    event.preventDefault();
    if (savingDraft) {
      return;
    }
    const name = $('create-draft-name').value.trim();
    if (!name) {
      $('create-draft-name').setCustomValidity('Enter a draft name.');
      $('create-draft-name').reportValidity();
      return;
    }
    $('create-draft-error').textContent = '';
    $('create-draft-confirm').disabled = true;
    $('create-draft-cancel').disabled = true;
    $('create-draft-name').disabled = true;
    try {
      await saveDraft(name);
      $('create-draft-dialog').close();
    } catch (cause) {
      $('create-draft-error').textContent = errorDetails(cause).message;
    } finally {
      $('create-draft-confirm').disabled = false;
      $('create-draft-cancel').disabled = false;
      $('create-draft-name').disabled = false;
    }
  };
  $('revert').onclick = guarded(async () => {
    if ($('revert').disabled) {
      return;
    }
    const dialog = $('revert-dialog');
    dialog.returnValue = '';
    dialog.showModal();
    const confirmed = await new Promise((resolve) =>
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'revert'), {
        once: true,
      }),
    );
    if (!confirmed) {
      return;
    }
    renderer.invalidate();
    const restored = requireValue(revertScene);
    restored.source_digest = requireValue(state.gameScene).source_digest;
    state.editor = new Editor(
      restored,
      [...state.editor.locked].map((point) => {
        const [x, y] = point.split(',').map(Number);
        return [x, y];
      }),
      state.editor.descriptor,
    );
    state.selection = null;
    state.selectedReference = null;
    state.gesture = null;
    $('name').value = state.editor.scene.name;
    $('validation').textContent = 'Check the layout before exporting.';
    markChanged();
    renderReferences();
    await refreshPreview();
    status('Reverted to the last saved or opened scene. Game files are unchanged.');
  });
  $('download').onclick = guarded(async () =>
    download(
      await api('document', { scene: state.editor.scene }),
      state.editor.scene.id + '.scene.json',
    ),
  );
  $('validate').onclick = guarded(validate);
  $('export').onclick = guarded(async () => {
    if (!(await validate()).valid) {
      return;
    }
    const response = await api('export', { scene: state.editor.scene });
    download(response, state.editor.scene.id + '.zip');
    status('Handoff exported. Start with HANDOFF.md and the review previews.');
  });
  return { activate, refreshDrafts, markChanged, changed, isDirty: () => dirty };
}
export type Documents = ReturnType<typeof createDocuments>;
