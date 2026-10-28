/** Object editing is committed as one undoable change; Cancel leaves the scene intact. */
import { describeFinding, resolveDefinition } from './object-definitions.mts';
import type { ObjectDefinition } from './object-definitions.mts';
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
  definitions: () => ObjectDefinition[] = () => [],
) {
  const dialog = element('object-dialog', HTMLDialogElement);
  const form = element('object-form', HTMLFormElement);
  const properties = element('object-properties', HTMLElement);
  const error = element('object-error', HTMLElement);
  let draft: SceneObject | null = null;
  let owner: LayerEditor | null = null;
  const definitionSelect = element('object-definition', HTMLSelectElement);
  const definitionFields = element('object-definition-fields', HTMLElement);
  let schemaValues: (() => ObjectProperty | null)[] = [];
  function readProperties() {
    return [...properties.children]
      .map((row) => {
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
      })
      .concat(
        schemaValues.flatMap((read) => {
          const value = read();
          return value ? [value] : [];
        }),
      );
  }
  function validateDraft() {
    if (!draft) {
      return;
    }
    const item = draft;
    try {
      const findings = resolveDefinition(
        { ...draft, properties: readProperties() },
        definitions(),
      ).findings;
      element('object-definition-validation', HTMLElement).textContent = findings
        .map((f) => `${f.field || 'Definition'}: ${describeFinding(item, f, definitions())}`)
        .join('; ');
    } catch (cause) {
      element('object-definition-validation', HTMLElement).textContent = String(cause);
    }
  }
  function renderDefinition() {
    if (!draft) {
      return;
    }
    const definition = definitions().find((d) => d.id === draft?.definition);
    definitionFields.replaceChildren();
    schemaValues = [];
    const names = new Set(definition?.fields.map((f) => f.name));
    properties.replaceChildren();
    draft.properties.filter((p) => !names.has(p.name)).forEach(propertyRow);
    element('object-definition-hint', HTMLElement).textContent = draft.definition
      ? 'Unchecked fields inherit the shared default. Check Override to set an instance value; uncheck to reset. Invalid values remain editable and appear in Object validation.'
      : 'Choose a definition to use typed fields. Detaching keeps the current effective values as custom properties.';
    for (const field of definition?.fields ?? []) {
      const override = draft.properties.find((p) => p.name === field.name);
      const row = document.createElement('div');
      row.className = 'definition-instance-field';
      row.dataset.field = field.name;
      const heading = document.createElement('strong');
      heading.textContent = `${field.name} (${field.type}${field.required ? ', required' : ''})`;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(override);
      const label = document.createElement('label');
      label.append(toggle, ' Override shared value');
      const control = field.choices
        ? document.createElement('select')
        : document.createElement('input');
      control.setAttribute('aria-label', field.name);
      if (control instanceof HTMLSelectElement) {
        control.replaceChildren(
          new Option('Choose…', ''),
          ...(field.choices ?? []).map((v) => new Option(v, v)),
        );
        if (override && !(field.choices ?? []).includes(String(override.value))) {
          control.add(new Option(String(override.value), String(override.value)));
        }
      } else {
        control.type =
          field.type === 'bool' ? 'checkbox' : field.type === 'string' ? 'text' : 'number';
        control.step = field.type === 'int' ? '1' : 'any';
        control.maxLength = 4096;
      }
      function setValue(value: ObjectProperty['value'] | undefined) {
        if (control instanceof HTMLInputElement && field.type === 'bool') {
          control.checked = value === true;
        } else {
          control.value = value === undefined ? '' : String(value);
        }
      }
      setValue(override?.value ?? field.default);
      control.disabled = !toggle.checked;
      const hint = document.createElement('small');
      hint.textContent = `Shared default: ${field.default === undefined ? '(unset)' : JSON.stringify(field.default)}${field.min === undefined ? '' : ` · Minimum ${field.min}`}${field.max === undefined ? '' : ` · Maximum ${field.max}`}`;
      // A mismatched override is retained until the author explicitly edits or resets it.
      let retained = override && override.type !== field.type ? structuredClone(override) : null;
      function updateStep() {
        if (control instanceof HTMLInputElement) {
          control.step = retained || field.type !== 'int' ? 'any' : '1';
        }
      }
      updateStep();
      toggle.onchange = () => {
        retained = null;
        updateStep();
        control.disabled = !toggle.checked;
        if (!toggle.checked) {
          setValue(field.default);
        }
        validateDraft();
      };
      control.oninput = control.onchange = () => {
        retained = null;
        updateStep();
        validateDraft();
      };
      schemaValues.push(() =>
        !toggle.checked
          ? null
          : (retained ??
            decodeProperty({
              name: field.name,
              type: field.type,
              value: propertyValue(
                field.type,
                control instanceof HTMLInputElement && field.type === 'bool'
                  ? control.checked
                  : control.value,
              ),
            })),
      );
      row.append(heading, label, control, hint);
      definitionFields.append(row);
    }
    validateDraft();
  }
  definitionSelect.onchange = () => {
    if (!draft) {
      return;
    }
    try {
      draft.properties = readProperties();
      if (!definitionSelect.value) {
        draft.properties = resolveDefinition(draft, definitions()).properties;
        delete draft.definition;
      } else {
        draft.definition = definitionSelect.value;
      }
      renderDefinition();
    } catch (cause) {
      error.textContent = String(cause);
      definitionSelect.value = draft.definition ?? '';
    }
  };
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
    const limit = draft?.definition ? 128 : 256;
    if (
      properties.children.length +
        definitionFields.querySelectorAll('label input:checked').length >=
      limit
    ) {
      error.textContent = `Use at most ${limit} properties.`;
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
      result.properties = readProperties();
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
    definitionSelect.replaceChildren(
      new Option('No definition', ''),
      ...definitions()
        .filter((d) => d.kind === draft?.kind)
        .map((d) => new Option(d.name, d.id)),
    );
    if (
      draft.definition &&
      ![...definitionSelect.options].some((o) => o.value === draft?.definition)
    ) {
      definitionSelect.add(
        new Option(`Missing or incompatible definition (${draft.definition})`, draft.definition),
      );
    }
    definitionSelect.value = draft.definition ?? '';
    renderDefinition();
    error.textContent = '';
    dialog.showModal();
    input('object-name').focus();
  }
  return { open };
}
