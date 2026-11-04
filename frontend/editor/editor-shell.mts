/** Shared presentation slots. Document controllers retain models, commands and history. */
import { element } from './editor-dom.mts';
import type { EditorLifetime } from './editor-lifetime.mts';

export type DocumentKind = 'scene' | 'artwork';
export interface DocumentContribution {
  surface: HTMLElement;
  inspector: readonly HTMLElement[];
  focus: () => void;
}

export function createEditorShell(
  lifetime: EditorLifetime,
  changed: (kind: DocumentKind) => void,
  revealInspector: () => void,
) {
  const workbench = element('editor-workbench', HTMLElement);
  const inspector = element('inspector-pane', HTMLElement);
  const layout = element('editor-layout', HTMLElement);
  const contributions = new Map<DocumentKind, DocumentContribution>();
  let active: DocumentKind = 'scene';

  function reflect() {
    changed(active);
    layout.dataset.document = active;
    document.body.classList.toggle('editing-artwork', active === 'artwork');
    inspector.setAttribute(
      'aria-label',
      active === 'artwork' ? 'Artwork inspector' : 'Scene inspector',
    );
    for (const [kind, contribution] of contributions) {
      contribution.surface.hidden = kind !== active;
    }
  }

  lifetime.cleanup(() => {
    active = 'scene';
    reflect();
    delete layout.dataset.document;
    contributions.clear();
  });

  return {
    contribute(kind: DocumentKind, contribution: DocumentContribution) {
      if (contributions.has(kind)) {
        throw Error(`Document presentation already registered: ${kind}`);
      }
      contributions.set(kind, contribution);
      // Return contributed nodes to their original locations on disposal so a
      // fresh mount receives the same markup, with no duplicated panels/handlers.
      for (const [node, host] of [
        [contribution.surface, workbench],
        ...contribution.inspector.map((panel) => [panel, inspector]),
      ] as const) {
        const hidden = node.hidden;
        const marker = document.createComment(`${kind} presentation`);
        node.before(marker);
        host.append(node);
        node.dataset.documentOwner = kind;
        lifetime.cleanup(() => {
          marker.replaceWith(node);
          node.hidden = hidden;
          delete node.dataset.documentOwner;
        });
      }
      reflect();
      return {
        get active() {
          return active === kind;
        },
        activate(focus = false) {
          active = kind;
          reflect();
          if (focus) {
            contribution.focus();
          }
        },
      };
    },
    revealInspector,
  };
}
