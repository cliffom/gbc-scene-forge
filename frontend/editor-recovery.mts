import type { EditorLifetime } from './editor-lifetime.mts';
import { array, record, string } from './decode.mts';
import { DraftWriter } from './drafts.mts';
import { button, element, select } from './editor-dom.mts';
import type {
  EditorActivity,
  GestureState,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import type { ProjectApi } from './project-api.mts';
import type { Loaded } from './project-contracts.mts';
import { decodeLoaded } from './project-contracts.mts';

export interface Ports {
  run: (work: () => Promise<void> | void) => Promise<void>;
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
  open: (data: Loaded, chooseInitialBrush?: boolean) => void;
  draw: (refreshUI?: boolean) => void;
}
export function createRecoveryController({
  lifetime,
  api,
  activity,
  gestures,
  workspaceState,
  sceneSession,
  status,
  ports,
}: {
  lifetime: EditorLifetime;
  api: ProjectApi['json'];
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor'>;
  workspaceState: Pick<WorkspaceState, 'project' | 'revision'>;
  sceneSession: Pick<
    SceneSession,
    'baseline' | 'committed' | 'dirty' | 'editor' | 'loaded' | 'serialize'
  >;
  status: HTMLElement;
  ports: Ports;
}) {
  let draftWriter: DraftWriter | null = null;

  let recoveredDraft: { id: string; revision: string } | null = null;

  let recoveryItems: Record<string, unknown>[] = [];

  lifetime.cleanup(() => draftWriter?.stop());
  function newDraftWriter() {
    draftWriter?.stop();
    draftWriter = new DraftWriter(
      (route, payload) => api(route, record, payload),
      (message) => {
        if (!lifetime.disposed) {
          element('draft-status', HTMLElement).textContent = message;
        }
      },
    );
  }

  function checkpoint() {
    if (
      activity.busy ||
      gestures.anchor ||
      !workspaceState.project ||
      !sceneSession.loaded ||
      !sceneSession.editor ||
      !draftWriter
    ) {
      return;
    }
    draftWriter.observe(
      sceneSession.dirty()
        ? {
            project_id: workspaceState.project.id,
            scene_id: sceneSession.loaded.id,
            name: sceneSession.loaded.name,
            scene_revision: sceneSession.loaded.revision,
            project_revision: workspaceState.revision,
            scene: sceneSession.serialize(),
          }
        : null,
    );
  }

  async function clearDraft() {
    lifetime.signal.throwIfAborted();
    const writer = draftWriter;
    draftWriter = null;
    try {
      await writer?.clear();
      lifetime.signal.throwIfAborted();
      if (recoveredDraft) {
        await api('delete-draft', record, recoveredDraft);
      }
      lifetime.signal.throwIfAborted();
      recoveredDraft = null;
      element('draft-status', HTMLElement).textContent = '';
    } catch (error) {
      if (lifetime.disposed) {
        throw error;
      }
      element('draft-status', HTMLElement).textContent =
        `Draft cleanup failed; the checkpoint was retained. ${String(error)}`;
    }
  }

  // Checkpoint only authored scene snapshots; playback positions and selections are transient.
  lifetime.interval(() => {
    checkpoint();
    if (!activity.busy && !gestures.anchor) {
      void draftWriter?.flush();
    }
  }, 5000);

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        checkpoint();
        void draftWriter?.flush();
      }
    },
    { signal: lifetime.signal },
  );

  function recoverySelection() {
    return recoveryItems.find((item) => item.id === select('recovery-drafts').value);
  }

  function recoveryLabel(item: Record<string, unknown>) {
    return `${string(item.name)} · ${new Date(string(item.updated)).toLocaleString()}`;
  }

  function recoveryDetails() {
    const item = recoverySelection();
    element('recovery-details', HTMLElement).textContent = item
      ? `${recoveryLabel(item)}. Restoration checks the original project, scene and asset revisions. If they changed, download the draft to retain its contents.`
      : 'No recoverable drafts. Checkpoints are created automatically while editing.';
    for (const id of ['recovery-restore', 'recovery-download', 'recovery-discard']) {
      button(id).disabled = !item;
    }
  }

  async function showRecovery(sceneId?: string) {
    const result = await api('list-drafts', record, {});
    const all = array(result.drafts, record);
    recoveryItems = all.filter(
      (item) =>
        !item.error && item.id !== draftWriter?.id && (!sceneId || item.scene_id === sceneId),
    );
    select('recovery-drafts').replaceChildren(
      ...recoveryItems.map((item) => new Option(recoveryLabel(item), string(item.id))),
    );
    recoveryDetails();
    if (all.some((item) => item.error)) {
      element('draft-status', HTMLElement).textContent =
        'Some draft files are damaged. They remain in .forge/drafts for manual recovery.';
    }
    if (recoveryItems.length) {
      element('recovery-dialog', HTMLDialogElement).showModal();
    }
  }

  lifetime.assign(select('recovery-drafts'), 'onchange', recoveryDetails);

  lifetime.assign(
    button('show-recovery'),
    'onclick',
    () =>
      void ports.run(async () => {
        await showRecovery();
        if (!recoveryItems.length) {
          status.textContent = 'No recoverable drafts.';
        }
      }),
  );

  lifetime.assign(button('recovery-later'), 'onclick', () => {
    if (!activity.busy) {
      element('recovery-dialog', HTMLDialogElement).close();
    }
  });

  lifetime.assign(element('recovery-dialog', HTMLDialogElement), 'oncancel', (event) => {
    if (activity.busy) {
      event.preventDefault();
    }
  });

  lifetime.assign(
    button('recovery-restore'),
    'onclick',
    () =>
      void ports.run(async () => {
        const item = recoverySelection();
        if (!item || sceneSession.dirty()) {
          return;
        }
        const guard = { id: string(item.id), revision: string(item.revision) };
        // Fetch baseline first; restore validates again after it, fencing concurrent saves.
        const saved = await api(`scene/${string(item.scene_id)}`, decodeLoaded);
        const restored = await api('restore-draft', decodeLoaded, guard);
        if (saved.revision !== restored.revision) {
          throw Error(
            'Scene changed during recovery. Reopen recovery and try again; the draft was retained.',
          );
        }
        await clearDraft();
        if (!(await ports.refresh()) || lifetime.disposed) {
          return;
        }
        ports.open(restored);
        sceneSession.baseline = JSON.stringify({
          width: saved.width,
          height: saved.height,
          layers: saved.layers,
          nextLayer: saved.nextLayerId,
          next: saved.nextObjectId,
        });
        sceneSession.committed = saved;
        recoveredDraft = guard;
        element('recovery-dialog', HTMLDialogElement).close();
        ports.draw();
        status.textContent =
          'Draft restored as unsaved edits. Save scene to commit them; Revert discards them.';
      }),
  );

  lifetime.assign(
    button('recovery-download'),
    'onclick',
    () =>
      void ports.run(async () => {
        const item = recoverySelection();
        if (!item) {
          return;
        }
        const value = await api('download-draft', record, { id: item.id, revision: item.revision });
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `forge-draft-${string(item.id)}.json`;
        link.click();
        lifetime.revokeLater(url);
        status.textContent = 'Draft downloaded. The checkpoint is still available.';
      }),
  );

  lifetime.assign(
    button('recovery-discard'),
    'onclick',
    () =>
      void ports.run(async () => {
        const item = recoverySelection();
        if (
          !item ||
          !window.confirm(
            `Permanently discard the draft for “${string(item.name)}”? Download it first to keep a copy.`,
          )
        ) {
          return;
        }
        await api('delete-draft', record, { id: item.id, revision: item.revision });
        element('recovery-dialog', HTMLDialogElement).close();
        await showRecovery();
        status.textContent = 'Draft discarded. Saved scenes are unchanged.';
      }),
  );
  return { clearDraft, showRecovery, newDraftWriter, checkpoint };
}
