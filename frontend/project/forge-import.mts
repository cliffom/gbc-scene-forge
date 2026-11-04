import type { Feedback } from '../editor/editor-notifications.mts';
/** Selected scene transfer with explicit, invalidated preflight confirmation. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { button, element, input } from '../editor/editor-dom.mts';
import type { Ports } from '../artwork/editor-artwork.mts';
import type { ProjectApi } from './project-api.mts';
import { decodeLoaded } from './project-contracts.mts';
import { array, record, string } from '../shared/decode.mts';

export function createForgeImport({
  lifetime,
  api,
  ports,
  revision,
  status,
}: {
  lifetime: EditorLifetime;
  api: ProjectApi['json'];
  ports: Ports;
  revision: () => string;
  status: Feedback;
}) {
  const file = input('forge-zip');
  const rows = element('forge-scenes', HTMLElement);
  const report = element('forge-report', HTMLElement);
  const apply = button('forge-apply');
  let generation = 0;
  let prepared: Record<string, unknown> | null = null;
  const invalidate = () => {
    generation++;
    prepared = null;
    apply.dataset.ready = 'false';
    apply.disabled = true;
    report.textContent = 'Run Check selection after choosing scenes or changing names.';
  };
  lifetime.cleanup(invalidate);
  lifetime.assign(file, 'onchange', () => {
    invalidate();
    rows.replaceChildren();
  });
  lifetime.assign(rows, 'oninput', invalidate);
  lifetime.assign(button('forge-check'), 'onclick', () => {
    invalidate();
    const request = generation;
    void ports.run(async () => {
      const chosen = file.files?.[0];
      if (!chosen || chosen.size > 40 * 1024 * 1024) {
        throw Error('Choose a Forge export ZIP of at most 40 MiB compressed.');
      }
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const selection: Record<string, string> = {};
      for (const row of rows.querySelectorAll<HTMLElement>('[data-scene]')) {
        const id = row.dataset.scene;
        const name = row.querySelector<HTMLInputElement>('input[type=text]');
        if (row.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked && id && name) {
          selection[id] = name.value;
        }
      }
      const data = {
        zip: btoa(binary),
        project_revision: revision(),
        ...(rows.childElementCount ? { selection } : {}),
      };
      const result = await api('import-forge', record, { ...data, dry_run: true });
      if (lifetime.disposed || request !== generation) {
        return;
      }
      rows.replaceChildren(
        ...array(result.scenes, record).map((scene) => {
          const row = document.createElement('fieldset');
          row.dataset.scene = string(scene.id);
          const legend = document.createElement('legend');
          legend.textContent = `Source: ${string(scene.source_name)}`;
          const pickLabel = document.createElement('label');
          const pick = document.createElement('input');
          pick.type = 'checkbox';
          pick.checked = scene.selected === true;
          pickLabel.append(pick, ' Import this scene');
          const nameLabel = document.createElement('label');
          nameLabel.className = 'field';
          nameLabel.append('Destination name');
          const name = document.createElement('input');
          name.type = 'text';
          name.maxLength = 100;
          name.value = string(scene.name);
          nameLabel.append(name);
          const summary = document.createElement('p');
          summary.textContent = `Source ID: ${string(scene.id)}\n${scene.selected === true ? 'Selected' : 'Skipped'} · ${string(scene.status)}\nArtwork: ${array(scene.assets, string).join(', ') || 'none'}\nDefinitions: ${array(scene.definitions, string).join(', ') || 'none'}\n${[...array(scene.errors, string), ...array(scene.conflicts, string)].join('\n')}`;
          row.append(legend, pickLabel, nameLabel, summary);
          return row;
        }),
      );
      report.textContent = [
        ...array(result.errors, string),
        ...array(result.notes, string),
        ...array(result.assets, record).map(
          (asset) => `Copy artwork: ${string(asset.source)} → ${string(asset.destination)}`,
        ),
        ...array(result.definitions, record).map(
          (definition) =>
            `Copy definition: ${string(definition.source)} → ${string(definition.destination)}`,
        ),
      ].join('\n');
      if (result.compatible !== true) {
        return;
      }
      prepared = { ...data, confirmation: string(result.confirmation) };
      apply.dataset.ready = 'true';
      apply.disabled = false;
    });
  });
  lifetime.assign(apply, 'onclick', async () => {
    const candidate = prepared;
    if (!candidate || !(await ports.discard()) || lifetime.disposed) {
      return;
    }
    // Capture before entering the shared busy/update path, which disables controls.
    invalidate();
    void ports.run(async () => {
      const result = await api('import-forge', record, { ...candidate, dry_run: false });
      await ports.clearDraft();
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      const target = array(result.imported, string)[0];
      if (target) {
        const loaded = await api(`scene/${target}`, decodeLoaded);
        if (lifetime.disposed) {
          return;
        }
        ports.open(loaded);
      }
      element('import-atlas-dialog', HTMLDialogElement).close();
      status.show('Imported selected Forge scenes as new copies.');
    });
  });
  return { invalidate };
}
