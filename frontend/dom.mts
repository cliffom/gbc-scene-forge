/** Resolve and check the editor's fixed DOM once at startup. */
export function requireValue<T>(value: T | null | undefined, message = 'Missing editor value'): T {
  if (value == null) {
    throw Error(message);
  }
  return value;
}
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) {
    throw Error(`Missing or invalid editor element: ${id}`);
  }
  return value;
}
const elements = {
  'project-name': element('project-name', HTMLElement),
  profile: element('profile', HTMLSelectElement),
  open: element('open', HTMLButtonElement),
  original: element('original', HTMLButtonElement),
  new: element('new', HTMLButtonElement),
  drafts: element('drafts', HTMLSelectElement),
  'delete-drafts': element('delete-drafts', HTMLButtonElement),
  import: element('import', HTMLButtonElement),
  file: element('file', HTMLInputElement),
  download: element('download', HTMLButtonElement),
  export: element('export', HTMLButtonElement),
  'create-draft': element('create-draft', HTMLButtonElement),
  'create-draft-dialog': element('create-draft-dialog', HTMLDialogElement),
  'create-draft-form': element('create-draft-form', HTMLFormElement),
  'create-draft-name': element('create-draft-name', HTMLInputElement),
  'create-draft-error': element('create-draft-error', HTMLElement),
  'create-draft-cancel': element('create-draft-cancel', HTMLButtonElement),
  'create-draft-confirm': element('create-draft-confirm', HTMLButtonElement),
  save: element('save', HTMLButtonElement),
  apply: element('apply', HTMLButtonElement),
  'asset-count': element('asset-count', HTMLElement),
  search: element('search', HTMLInputElement),
  family: element('family', HTMLSelectElement),
  kind: element('kind', HTMLSelectElement),
  assets: element('assets', HTMLElement),
  deselect: element('deselect', HTMLButtonElement),
  undo: element('undo', HTMLButtonElement),
  redo: element('redo', HTMLButtonElement),
  revert: element('revert', HTMLButtonElement),
  zoom: element('zoom', HTMLSelectElement),
  viewport: element('viewport', HTMLElement),
  scene: element('scene', HTMLCanvasElement),
  coordinates: element('coordinates', HTMLElement),
  dimensions: element('dimensions', HTMLElement),
  'selected-brush': element('selected-brush', HTMLElement),
  grid: element('grid', HTMLInputElement),
  markers: element('markers', HTMLInputElement),
  collision: element('collision', HTMLInputElement),
  protected: element('protected', HTMLInputElement),
  guides: element('guides', HTMLInputElement),
  animate: element('animate', HTMLInputElement),
  'animation-label': element('animation-label', HTMLElement),
  dirty: element('dirty', HTMLElement),
  name: element('name', HTMLInputElement),
  'scene-id': element('scene-id', HTMLInputElement),
  'draft-id-help': element('draft-id-help', HTMLElement),
  'scene-type': element('scene-type', HTMLElement),
  lighting: element('lighting', HTMLSelectElement),
  'state-field': element('state-field', HTMLElement),
  state: element('state', HTMLSelectElement),
  'reference-panel': element('reference-panel', HTMLElement),
  'reference-count': element('reference-count', HTMLElement),
  references: element('references', HTMLElement),
  'remove-reference': element('remove-reference', HTMLButtonElement),
  validate: element('validate', HTMLButtonElement),
  validation: element('validation', HTMLElement),
  'undo-apply': element('undo-apply', HTMLButtonElement),
  status: element('status', HTMLElement),
  'source-label': element('source-label', HTMLElement),
  discard: element('discard', HTMLDialogElement),
  'revert-dialog': element('revert-dialog', HTMLDialogElement),
  'revert-heading': element('revert-heading', HTMLElement),
  'delete-drafts-dialog': element('delete-drafts-dialog', HTMLDialogElement),
  'delete-drafts-heading': element('delete-drafts-heading', HTMLElement),
  'delete-drafts-list': element('delete-drafts-list', HTMLElement),
  'delete-drafts-error': element('delete-drafts-error', HTMLElement),
  'delete-drafts-cancel': element('delete-drafts-cancel', HTMLButtonElement),
  'delete-drafts-confirm': element('delete-drafts-confirm', HTMLButtonElement),
  'apply-review': element('apply-review', HTMLDialogElement),
  'apply-heading': element('apply-heading', HTMLElement),
  'apply-summary': element('apply-summary', HTMLElement),
  'review-content': element('review-content', HTMLElement),
  'apply-views': element('apply-views', HTMLElement),
  'apply-files': element('apply-files', HTMLElement),
  'apply-progress': element('apply-progress', HTMLElement),
  'apply-health': element('apply-health', HTMLElement),
  'apply-indicator': element('apply-indicator', HTMLElement),
  'apply-step': element('apply-step', HTMLElement),
  'apply-activity': element('apply-activity', HTMLElement),
  'apply-timing': element('apply-timing', HTMLElement),
  'apply-result': element('apply-result', HTMLElement),
  'apply-reconnect': element('apply-reconnect', HTMLButtonElement),
  'apply-details': element('apply-details', HTMLDetailsElement),
  'apply-log': element('apply-log', HTMLElement),
  'apply-download-log': element('apply-download-log', HTMLButtonElement),
  'approve-label': element('approve-label', HTMLElement),
  'approve-layout': element('approve-layout', HTMLInputElement),
  'apply-close': element('apply-close', HTMLButtonElement),
  'apply-confirm': element('apply-confirm', HTMLButtonElement),
};
export function $<K extends keyof typeof elements>(id: K): (typeof elements)[K] {
  return elements[id];
}
export function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return requireValue(canvas.getContext('2d'), 'Canvas rendering is unavailable');
}
