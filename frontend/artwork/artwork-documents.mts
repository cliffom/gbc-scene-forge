/** Retained sessions and per-document controls/view; no save or history ownership. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ArtworkSession } from './artwork-session.mts';
import type { ArtworkViewState } from './artwork-viewport.mts';

type RetainedDocument = {
  session: ArtworkSession;
  values: Map<string, { value: string; checked: boolean; open?: boolean }>;
  view: ArtworkViewState;
};

export function createArtworkDocuments(lifetime: EditorLifetime, dialog: HTMLDialogElement) {
  const documents = new Map<string, RetainedDocument>();
  lifetime.cleanup(() => documents.clear());
  return {
    get size() {
      return documents.size;
    },
    sessions() {
      return Array.from(documents.values(), ({ session }) => session);
    },
    get(session: ArtworkSession) {
      return documents.get(session.id);
    },
    add(session: ArtworkSession, retained?: RetainedDocument) {
      documents.set(
        session.id,
        retained ?? {
          session,
          values: new Map(),
          view: { center: { x: 0.5, y: 0.5 }, panTool: false },
        },
      );
    },
    remove(session: ArtworkSession) {
      documents.delete(session.id);
    },
    remember(session: ArtworkSession, view: ArtworkViewState | null) {
      // A hidden viewport has no usable center. Preserve the last visible snapshot.
      if (!view) {
        return;
      }
      const values: RetainedDocument['values'] = new Map();
      for (const control of dialog.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLDetailsElement
      >('input[id],input[name="art-tool"],select[id],details[id]')) {
        const key =
          control.id ||
          `input[name="art-tool"][value="${control instanceof HTMLInputElement ? control.value : ''}"]`;
        values.set(key, {
          value: control instanceof HTMLDetailsElement ? '' : control.value,
          checked: control instanceof HTMLInputElement && control.checked,
          open: control instanceof HTMLDetailsElement ? control.open : undefined,
        });
      }
      documents.set(session.id, { session, values, view });
    },
    /** The caller creates options first, then rebinds sheet callbacks after restoration. */
    restoreControls(session: ArtworkSession) {
      const saved = documents.get(session.id);
      if (!saved) {
        return;
      }
      for (const [id, value] of saved.values) {
        const control = document.getElementById(id) ?? dialog.querySelector(id);
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
          control.value = value.value;
        }
        if (control instanceof HTMLInputElement) {
          control.checked = value.checked;
        }
        if (control instanceof HTMLDetailsElement) {
          control.open = value.open ?? false;
        }
      }
    },
  };
}
