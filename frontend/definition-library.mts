import { EditorLifetime } from './editor-lifetime.mts';
/** Definition library editing commits project metadata independently of scene history. */
import type { DefinitionField, ObjectDefinition } from './object-definitions.mts';
import { fieldType, objectKind } from './object-definitions.mts';
import { propertyValue } from './objects.mts';
const get = (id: string) => {
  const node = document.getElementById(id);
  if (!node) {
    throw Error(`Missing ${id}`);
  }
  return node;
};
function typed<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = get(id);
  if (!(node instanceof type)) {
    throw Error(`Invalid element ${id}`);
  }
  return node;
}
const input = (id: string) => typed(id, HTMLInputElement);
const select = (id: string) => typed(id, HTMLSelectElement);
export function createDefinitionLibrary(
  definitions: () => ObjectDefinition[],
  sprites: () => string[],
  save: (definition: Omit<ObjectDefinition, 'id'> & { id?: string }) => Promise<void>,
  remove: (id: string) => Promise<void>,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const dialog = typed('definitions-dialog', HTMLDialogElement);
  const form = typed('definition-form', HTMLFormElement);
  const rows = get('definition-fields');
  const error = get('definition-error');
  let id: string | undefined;
  let working = false;
  let restoreControls: (() => void) | undefined;
  lifetime.cleanup(() => restoreControls?.());
  const label = (text: string, control: HTMLElement) => {
    const l = document.createElement('label');
    l.className =
      control instanceof HTMLInputElement && control.type === 'checkbox'
        ? 'definition-toggle'
        : 'field';
    l.append(text, control);
    return l;
  };
  function row(field?: DefinitionField) {
    if (rows.children.length >= 128) {
      error.textContent = 'Use at most 128 fields.';
      return;
    }
    const box = document.createElement('fieldset');
    box.className = 'definition-field';
    const name = document.createElement('input');
    name.className = 'field-name';
    name.required = true;
    name.maxLength = 100;
    name.value = field?.name ?? '';
    const type = document.createElement('select');
    type.className = 'field-type';
    type.replaceChildren(...['string', 'int', 'float', 'bool'].map((t) => new Option(t, t)));
    type.value = field?.type ?? 'string';
    const required = document.createElement('input');
    required.type = 'checkbox';
    required.className = 'field-required';
    required.checked = field?.required ?? false;
    const hasDefault = document.createElement('input');
    hasDefault.type = 'checkbox';
    hasDefault.className = 'field-has-default';
    hasDefault.checked = field?.default !== undefined;
    const value = document.createElement('input');
    value.className = 'field-default';
    const min = document.createElement('input');
    min.className = 'field-min';
    min.type = 'number';
    min.step = 'any';
    min.value = field?.min === undefined ? '' : String(field.min);
    const max = document.createElement('input');
    max.type = 'number';
    max.step = 'any';
    max.className = 'field-max';
    max.value = field?.max === undefined ? '' : String(field.max);
    const choices = document.createElement('textarea');
    choices.className = 'field-choices';
    choices.rows = 2;
    choices.value = field?.choices?.join('\n') ?? '';
    function controls() {
      value.type = type.value === 'bool' ? 'checkbox' : type.value === 'string' ? 'text' : 'number';
      value.step = type.value === 'int' ? '1' : 'any';
      value.disabled = !hasDefault.checked;
      value.required = hasDefault.checked && ['int', 'float'].includes(type.value);
      value.maxLength = 4096;
      min.disabled = max.disabled = !['int', 'float'].includes(type.value);
      choices.disabled = type.value !== 'string';
      for (const control of [min, max, choices]) {
        if (control.parentElement) {
          control.parentElement.hidden = control.disabled;
        }
      }
    }
    controls();
    if (typeof field?.default === 'boolean') {
      value.checked = field.default;
    } else {
      value.value = field?.default === undefined ? '' : String(field.default);
    }
    lifetime.assign(type, 'onchange', () => {
      value.value = '';
      value.checked = false;
      controls();
    });
    lifetime.assign(hasDefault, 'onchange', controls);
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Remove field';
    lifetime.assign(deleteButton, 'onclick', () => box.remove());
    box.append(
      label('Field name', name),
      label('Type', type),
      label('Required', required),
      label('Shared default', hasDefault),
      label('Default value', value),
      label('Minimum', min),
      label('Maximum', max),
      label('Choices (one per line)', choices),
      deleteButton,
    );
    rows.append(box);
    controls();
  }
  function geometry() {
    const kind = select('definition-kind').value;
    select('definition-asset').disabled = kind !== 'sprite';
    const assetLabel = select('definition-asset').parentElement;
    if (assetLabel) {
      assetLabel.hidden = kind !== 'sprite';
    }
    const dimensions = input('definition-width').closest<HTMLElement>('.property-grid');
    if (dimensions) {
      dimensions.hidden = kind !== 'rectangle';
    }
    input('definition-width').disabled = input('definition-height').disabled = kind !== 'rectangle';
  }
  function load(definition?: ObjectDefinition) {
    id = definition?.id;
    input('definition-name').value = definition?.name ?? '';
    select('definition-kind').value = definition?.kind ?? 'point';
    select('definition-asset').replaceChildren(...sprites().map((a) => new Option(a, a)));
    select('definition-asset').value = definition?.asset ?? sprites()[0] ?? '';
    input('definition-width').value = String(definition?.width ?? 8);
    input('definition-height').value = String(definition?.height ?? 8);
    rows.replaceChildren();
    definition?.fields.forEach((f) => row(f));
    typed('definition-delete', HTMLButtonElement).disabled = !id;
    error.textContent = '';
    geometry();
  }
  lifetime.assign(select('definition-kind'), 'onchange', geometry);
  lifetime.assign(get('definition-add-field'), 'onclick', () => row());
  lifetime.assign(get('definition-new'), 'onclick', () => {
    select('definition-list').value = '';
    load();
  });
  lifetime.assign(select('definition-list'), 'onchange', () =>
    load(definitions().find((d) => d.id === select('definition-list').value)),
  );
  lifetime.assign(get('definition-close'), 'onclick', () => {
    if (!working) {
      dialog.close();
    }
  });
  lifetime.assign(dialog, 'oncancel', (e) => {
    if (working) {
      e.preventDefault();
    }
  });
  async function commit(work: () => Promise<void>) {
    if (working || lifetime.disposed) {
      return;
    }
    working = true;
    const controls = [
      ...form.querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
      >('input,button,select,textarea'),
    ];
    const disabled = controls.map((c) => c.disabled);
    restoreControls = () => {
      controls.forEach((c, i) => {
        c.disabled = disabled[i];
      });
      restoreControls = undefined;
    };
    controls.forEach((c) => {
      c.disabled = true;
    });
    try {
      await work();
      if (!lifetime.disposed) {
        dialog.close();
      }
    } catch (cause) {
      if (lifetime.disposed) {
        return;
      }
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!lifetime.disposed) {
        restoreControls?.();
      }
      working = false;
    }
  }
  lifetime.assign(get('definition-delete'), 'onclick', () => {
    if (
      !id ||
      !window.confirm(
        'Delete this definition? Linked objects keep their overrides and identity, but will report a missing definition. Inherited defaults will no longer apply. This project change is outside scene undo.',
      )
    ) {
      return;
    }
    const chosen = id;
    void commit(() => remove(chosen));
  });
  lifetime.assign(form, 'onsubmit', (e) => {
    e.preventDefault();
    try {
      const fields = [...rows.children].map((box) => {
        const find = <T extends Element>(selector: string): T => {
          const node = box.querySelector<T>(selector);
          if (!node) {
            throw Error('Missing field control.');
          }
          return node;
        };
        const name = find<HTMLInputElement>('.field-name').value;
        const type = fieldType(find<HTMLSelectElement>('.field-type').value);
        const value = find<HTMLInputElement>('.field-default');
        const field: DefinitionField = {
          name,
          type,
          required: find<HTMLInputElement>('.field-required').checked,
        };
        if (find<HTMLInputElement>('.field-has-default').checked) {
          field.default = propertyValue(type, type === 'bool' ? value.checked : value.value);
        }
        for (const key of ['min', 'max'] as const) {
          const bound = find<HTMLInputElement>(`.field-${key}`);
          if (!bound.disabled && bound.value !== '') {
            field[key] = Number(bound.value);
          }
        }
        const choices = find<HTMLTextAreaElement>('.field-choices');
        if (!choices.disabled && choices.value !== '') {
          field.choices = choices.value.split('\n');
        }
        return field;
      });
      const kind = objectKind(select('definition-kind').value);
      const definition = {
        ...(id ? { id } : {}),
        name: input('definition-name').value.trim(),
        kind,
        fields,
        ...(kind === 'sprite' ? { asset: select('definition-asset').value } : {}),
        ...(kind === 'rectangle'
          ? {
              width: Number(input('definition-width').value),
              height: Number(input('definition-height').value),
            }
          : {}),
      };
      void commit(() => save(definition));
    } catch (cause) {
      if (lifetime.disposed) {
        return;
      }
      error.textContent = String(cause);
    }
  });
  return {
    open() {
      select('definition-list').replaceChildren(
        new Option('New definition…', ''),
        ...definitions().map((d) => new Option(d.name, d.id)),
      );
      load();
      dialog.showModal();
      input('definition-name').focus();
    },
  };
}
