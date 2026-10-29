/** Supported browser entry point. */
import { mountProjectEditor } from './project-editor.mts';
export const editor = mountProjectEditor();
export { mountProjectEditor };
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    editor.dispose();
  }
});
