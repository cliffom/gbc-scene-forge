import { button, element, select } from './editor-dom.mts';
import type { EditorLifetime } from './editor-lifetime.mts';
import type { EditorActivity, GestureState, SceneSession } from './editor-state.mts';

/** Transient viewing mode. The editing tool, brushes and selection keep their owners. */
export function createReviewController({
  lifetime,
  activity,
  sceneSession,
  gestures,
  canvas,
  draw,
  finishPan,
}: {
  lifetime: EditorLifetime;
  activity: EditorActivity;
  sceneSession: Pick<SceneSession, 'editor'>;
  gestures: Pick<GestureState, 'anchor' | 'spacePan'>;
  canvas: HTMLCanvasElement;
  draw: () => void;
  finishPan: () => void;
}) {
  const toggle = button('review-mode');
  const viewport = element('viewport', HTMLElement);

  function reflect(reviewing: boolean) {
    activity.reviewing = reviewing;
    document.body.classList.toggle('reviewing', reviewing);
    toggle.textContent = reviewing ? 'Return to editing' : 'Review scene';
    toggle.setAttribute('aria-pressed', String(reviewing));
    canvas.setAttribute('aria-label', reviewing ? 'Scene review' : 'Editable scene on a tile grid');
  }

  function setReviewing(reviewing: boolean) {
    if (activity.busy || gestures.anchor || sceneSession.editor?.stroke || !sceneSession.editor) {
      return;
    }
    finishPan();
    gestures.spacePan = false;
    // Retain the scene point at the viewport center, unless Fit controls the camera.
    const before = canvas.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const x = (view.left + viewport.clientWidth / 2 - before.left) / before.width;
    const y = (view.top + viewport.clientHeight / 2 - before.top) / before.height;
    reflect(reviewing);
    draw();
    if (select('zoom').value === 'fit') {
      viewport.scrollTo(0, 0);
    } else {
      const after = canvas.getBoundingClientRect();
      const nextView = viewport.getBoundingClientRect();
      viewport.scrollLeft +=
        after.left + x * after.width - nextView.left - viewport.clientWidth / 2;
      viewport.scrollTop += after.top + y * after.height - nextView.top - viewport.clientHeight / 2;
    }
    // The same visible toggle retains focus, including after keyboard activation.
    toggle.focus({ preventScroll: true });
  }

  lifetime.assign(toggle, 'onclick', () => setReviewing(!activity.reviewing));
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        activity.reviewing &&
        event.key === 'Escape' &&
        !document.querySelector('dialog[open], [popover]:popover-open') &&
        (event.target === canvas || event.target === viewport || event.target === toggle)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setReviewing(false);
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => reflect(false));
  return {
    sync() {
      if (activity.reviewing && !sceneSession.editor) {
        reflect(false);
        select('scenes').focus({ preventScroll: true });
      }
    },
  };
}
