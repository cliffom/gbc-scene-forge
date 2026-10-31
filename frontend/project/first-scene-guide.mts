import { projectPath } from '../scene/scene-navigation.mts';
import { EditorLifetime } from '../editor/editor-lifetime.mts';
/** Optional, offline instructions. Progress belongs to this browser and project URL. */
const steps = [
  {
    title: 'Create your own project',
    text: 'Enter a project name. Choose “Sample artwork and scenes” to start without preparing artwork, or “Empty project” to use your own. The sample is copied into your projects folder; all edits belong to you. Enable “Continue first-scene guide” before creating it.',
    target: 'project-title',
  },
  {
    title: 'Bring in artwork',
    text: 'A sample project already has tiles and sprites, so you can continue to the next step. For your own artwork, choose Import atlas → Browse folder, select a gbc-atlas manifest and PNG folder, then confirm Import atlas. Forge copies the files and leaves the source unchanged. Ordinary PNG tilesheet import is not available yet.',
    target: 'library-import',
  },
  {
    title: 'Create a scene',
    text: 'Choose Scene actions → Create scene. Name it “First scene”, keep 20 × 18 cells and an 8 px grid, then create it. Sample scenes stay available in the Scene dropdown. You can also open one of those to explore.',
    target: 'show-create',
  },
  {
    title: 'Paint and undo',
    text: 'Choose a tile from the asset library, keep a tile layer active, and click or drag on the canvas to paint. Try Undo and Redo. Sprites and markers use object layers instead. Your work is unsaved until you choose Save scene.',
    target: 'palette',
  },
  {
    title: 'Save and reopen',
    text: 'Choose Save scene (Ctrl/⌘ S) and wait for “Saved”. Reload the browser, then select “First scene” in the Scene dropdown to confirm your painted tiles survived. Resume this guide from the header. If a save fails, keep the page open and resolve the reported error before reloading.',
    target: 'save',
  },
  {
    title: 'Preview a sprite',
    text: 'Choose a sprite in the asset library, then click the canvas to place it on an object layer. The placed sprite is selected and its animation controls appear in the inspector: choose an animation and press Play. Save scene to keep the placement. You can enable Movement preview and focus the canvas to use directional keys. Preview does not save or change scene placements; this is an authoring preview rather than game physics.',
    target: 'palette',
  },
  {
    title: 'Export your project',
    text: 'Choose Export → Whole project → Download ZIP. Extract it to find portable Tiled scenes and copied artwork. Keep your project folder to continue editing. You have finished when a painted scene survives reopening, a sprite previews, and a ZIP downloads. Close this guide whenever you want; Restart returns to the beginning.',
    target: 'show-export',
  },
];

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const result = document.getElementById(id);
  if (!(result instanceof type)) {
    throw Error(`Missing guide element ${id}`);
  }
  return result;
}
const button = (id: string) => element(id, HTMLButtonElement);

export function createFirstSceneGuide(
  canAct: () => boolean,
  reveal?: (target: HTMLElement) => void,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const dialog = element('first-scene-guide', HTMLDialogElement);
  const title = element('guide-title', HTMLElement);
  const text = element('guide-text', HTMLElement);
  const progress = element('guide-progress', HTMLElement);
  const previous = button('guide-previous');
  const next = button('guide-next');
  const action = button('guide-action');
  const key = `forge-first-scene-guide:v1:${projectPath(location.pathname)}`;
  let index = 0;
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isInteger(saved) && saved >= 0 && saved < steps.length) {
      index = saved;
    }
  } catch {
    // Instructions remain usable when browser storage is unavailable.
  }
  function render() {
    const step = steps[index];
    title.textContent = step.title;
    text.textContent = step.text;
    progress.textContent = `Step ${index + 1} of ${steps.length} · Follow at your own pace`;
    previous.disabled = index === 0;
    next.disabled = index === steps.length - 1;
    const target = document.getElementById(step.target);
    const hidden = target?.closest('[hidden]');
    action.disabled =
      !target ||
      Boolean(hidden && !(reveal && hidden.matches('[role=tabpanel]'))) ||
      (target instanceof HTMLButtonElement && target.disabled);
    action.textContent = index === 0 ? 'Go to project creation' : 'Try this step';
    try {
      localStorage.setItem(key, String(index));
    } catch {
      // Saving guide position is optional; project saving uses the server.
    }
  }
  function show() {
    if (document.querySelector('dialog[open]')) {
      return;
    }
    render();
    dialog.showModal();
  }
  lifetime.assign(previous, 'onclick', () => {
    index--;
    render();
  });
  lifetime.assign(next, 'onclick', () => {
    index++;
    render();
  });
  lifetime.assign(button('guide-restart'), 'onclick', () => {
    index = 0;
    render();
  });
  lifetime.assign(button('guide-close'), 'onclick', () => dialog.close());
  lifetime.assign(button('show-first-scene-guide'), 'onclick', show);
  lifetime.assign(action, 'onclick', () => {
    if (!canAct()) {
      return;
    }
    const target = document.getElementById(steps[index].target);
    dialog.close();
    if (target) {
      reveal?.(target);
    }
    if (index === 0) {
      element('continue-guide', HTMLInputElement).checked = true;
    }
    if (target instanceof HTMLButtonElement) {
      target.click();
    } else {
      target?.focus();
    }
    target?.scrollIntoView({ block: 'nearest' });
  });
  return {
    show,
    continueInProject() {
      index = 1;
      show();
    },
  };
}
