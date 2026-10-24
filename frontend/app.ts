/** Compose controllers; behavior and transient state live with their owning feature. */
import { $, requireValue } from './dom.mts';
import { ApiClient } from './api.mts';
import { guarded, status } from './ui.mts';
import { EditorSession } from './session.mts';
import { createAssets } from './assets.mts';
import { createRenderer } from './render.mts';
import { createInteractions } from './interactions.mts';
import type { Interactions } from './interactions.mts';
import { createDocuments } from './documents.mts';
import type { Documents } from './documents.mts';
import { createApply } from './apply.mts';
import type { Apply } from './apply.mts';
import * as decode from './decode.mts';
const state = new EditorSession(),
  client = new ApiClient();
const json = client.json.bind(client);
// Factories register handlers synchronously; callbacks run after all controllers are wired.
const assets = createAssets(state, (tool) => interactions.setTool(tool));
const renderer = createRenderer(state, assets, client, () => apply.updateAvailability());
const interactions: Interactions = createInteractions(state, assets, renderer, {
  changed: () => documents.changed(),
  markChanged: () => documents.markChanged(),
});
const documents: Documents = createDocuments(state, client, assets, renderer, interactions, () =>
  apply.updateAvailability(),
);
const apply: Apply = createApply(state, client, documents, renderer);
window.addEventListener('beforeunload', (event) => {
  if (documents.isDirty() || apply.isRunning()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
void guarded(async () => {
  state.catalog = await json('catalog', decode.catalog);
  client.token = state.catalog.token;
  await assets.load();
  $('family').append(
    ...state.catalog.families.map((f) => new Option(f.id.replaceAll('-', ' '), f.id)),
  );
  $('profile').replaceChildren(
    new Option('Choose a scene…', ''),
    ...Object.entries(state.catalog.profiles).map(([id, p]) => new Option(p.label, id)),
  );
  $('project-name').textContent = state.catalog.project.name;
  document.title = state.catalog.project.label;
  $('apply').hidden = !state.catalog.capabilities.apply;
  $('export').hidden = !state.catalog.capabilities.export;
  $('new').hidden = !state.catalog.capabilities.templates;
  $('reference-panel').hidden = !state.catalog.capabilities.references;
  requireValue(document.querySelector<HTMLOptionElement>('#kind option[value="sprite"]')).hidden =
    !state.catalog.capabilities.references;
  await documents.refreshDrafts();
  await apply.refreshLastApply();
  status('Choose a scene to open its current version, or open a saved draft.');
  await apply.resume();
})();
