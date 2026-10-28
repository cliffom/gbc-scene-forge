/** Object editing is committed as one undoable change; Cancel leaves the scene intact. */
import { decodeProperty, propertyValue } from './objects.mts';
import type { ObjectProperty, SceneObject } from './objects.mts';
import type { LayerEditor } from './layers.mts';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw Error(`Missing element ${id}`);
  }
  return found;
}
const input = (id: string) => element(id, HTMLInputElement);
export function createObjectInspector(
  current: () => { editor: LayerEditor; item: SceneObject } | null,
  changed: () => void,
) {
  const dialog = element('object-dialog', HTMLDialogElement);
  const form = element('object-form', HTMLFormElement);
  const properties = element('object-properties', HTMLElement);
  const error = element('object-error', HTMLElement);
  let draft: SceneObject | null = null;
  let owner: LayerEditor | null = null;
  function propertyRow(prop: ObjectProperty) {
    const row = document.createElement('div');
    row.className = 'object-property';
    const name = document.createElement('input');
    name.value = prop.name;
    name.required = true;
    name.maxLength = 100;
    name.setAttribute('aria-label', 'Property name');
    name.placeholder = 'Property name';
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'Property type');
    type.replaceChildren(
      ...['string', 'int', 'float', 'bool'].map((kind) => new Option(kind, kind)),
    );
    type.value = prop.type;
    const value = document.createElement('input');
    value.setAttribute('aria-label', 'Property value');
    function valueType() {
      value.type = type.value === 'bool' ? 'checkbox' : type.value === 'string' ? 'text' : 'number';
      value.required = type.value === 'int' || type.value === 'float';
      value.step = type.value === 'int' ? '1' : 'any';
      value.maxLength = 4096;
    }
    valueType();
    if (prop.type === 'bool') {
      value.checked = prop.value;
    } else {
      value.value = String(prop.value);
    }
    type.onchange = () => {
      error.textContent = '';
      valueType();
      value.value = type.value === 'string' ? '' : '0';
      value.checked = false;
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove property ${prop.name || 'row'}`);
    name.oninput = value.oninput = () => {
      error.textContent = '';
    };
    remove.onclick = () => {
      row.remove();
      error.textContent = '';
    };
    row.append(name, type, value, remove);
    properties.append(row);
  }
  element('object-add-property', HTMLButtonElement).onclick = () => {
    if (properties.children.length >= 128) {
      error.textContent = 'Use at most 128 properties.';
      return;
    }
    propertyRow({ name: '', type: 'string', value: '' });
  };
  input('object-default-origin').onchange = () => {
    for (const id of ['object-origin-x', 'object-origin-y']) {
      input(id).disabled = input('object-default-origin').checked;
    }
  };
  element('object-cancel', HTMLButtonElement).onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      const selected = current();
      if (!draft || !owner || selected?.editor !== owner || selected.item.id !== draft.id) {
        throw Error('Select this object again before editing.');
      }
      const result = structuredClone(draft);
      result.name = input('object-name').value;
      result.class = input('object-class').value;
      result.x = Number(input('object-x').value);
      result.y = Number(input('object-y').value);
      if (result.kind === 'rectangle') {
        result.width = Number(input('object-width').value);
        result.height = Number(input('object-height').value);
      }
      if (result.kind === 'sprite') {
        if (input('object-default-origin').checked) {
          delete result.origin;
        } else {
          result.origin = [
            Number(input('object-origin-x').value),
            Number(input('object-origin-y').value),
          ];
        }
      }
      result.properties = [...properties.children].map((row) => {
        const fields = row.querySelectorAll('input');
        const type = row.querySelector('select');
        if (!type || fields.length !== 2) {
          throw Error('Invalid property row.');
        }
        return decodeProperty({
          name: fields[0].value,
          type: type.value,
          value: propertyValue(
            type.value,
            type.value === 'bool' ? fields[1].checked : fields[1].value,
          ),
        });
      });
      owner.replaceObject(result);
      dialog.close();
      changed();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  };
  function open() {
    const selected = current();
    if (!selected) {
      return;
    }
    owner = selected.editor;
    draft = structuredClone(selected.item);
    input('object-id').value = draft.id;
    input('object-kind').value = draft.kind;
    input('object-name').value = draft.name;
    input('object-class').value = draft.class;
    input('object-x').value = String(draft.x);
    input('object-y').value = String(draft.y);
    input('object-x').max = String(owner.scene.width * Number(owner.scene.grid) - 1);
    input('object-y').max = String(owner.scene.height * Number(owner.scene.grid) - 1);
    element('object-dimensions', HTMLElement).hidden = draft.kind !== 'rectangle';
    input('object-width').disabled = input('object-height').disabled = draft.kind !== 'rectangle';
    input('object-width').value = String(draft.kind === 'rectangle' ? draft.width : 1);
    input('object-height').value = String(draft.kind === 'rectangle' ? draft.height : 1);
    element('object-origin', HTMLElement).hidden = draft.kind !== 'sprite';
    if (draft.kind === 'sprite') {
      const region = owner.spriteRegion(draft.asset);
      const origin = draft.origin || region?.origin || [0, 0];
      input('object-origin-x').value = String(origin[0]);
      input('object-origin-y').value = String(origin[1]);
      input('object-origin-x').max = String(region?.width || 0);
      input('object-origin-y').max = String(region?.height || 0);
    }
    input('object-default-origin').checked = draft.kind !== 'sprite' || !draft.origin;
    input('object-default-origin').dispatchEvent(new Event('change'));
    properties.replaceChildren();
    draft.properties.forEach(propertyRow);
    error.textContent = '';
    dialog.showModal();
    input('object-name').focus();
  }
  return { open };
}
