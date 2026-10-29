/** Explicit preflight and confirmed import of generic, project-owned artwork. */
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import { array, number, record, string } from '../shared/decode.mts';
import type { ProjectApi } from '../project/project-api.mts';
import type { Ports } from './editor-artwork.mts';
import { decodeLoaded } from '../project/project-contracts.mts';
import { relativeParts } from './atlas-import.mts';

export async function encodeFile(file: File): Promise<string> {
  if (file.size > 4 * 1024 * 1024) {
    throw Error('Each PNG must be at most 4 MiB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function createGenericImport({
  lifetime,
  api,
  ports,
  revision,
  sceneId,
  status,
}: {
  lifetime: EditorLifetime;
  api: ProjectApi['json'];
  ports: Ports;
  revision: () => string;
  sceneId: () => string | undefined;
  status: HTMLElement;
}) {
  let prepared: { kind: string; data: Record<string, unknown> } | null = null;
  const apply = button('generic-apply');
  const report = element('generic-report', HTMLElement);
  const canvas = element('sheet-preview', HTMLCanvasElement);
  let generation = 0;
  const invalidate = () => {
    generation++;
    prepared = null;
    apply.dataset.ready = 'false';
    apply.disabled = true;
    report.textContent = '';
    canvas.hidden = true;
  };
  lifetime.cleanup(invalidate);
  const mode = select('import-kind');
  lifetime.assign(mode, 'onchange', () => {
    invalidate();
    element('atlas-import-fields', HTMLElement).hidden = mode.value !== 'atlas';
    element('generic-import-fields', HTMLElement).hidden = mode.value === 'atlas';
    element('png-import-fields', HTMLElement).hidden = mode.value !== 'png';
    element('tiled-import-fields', HTMLElement).hidden = mode.value !== 'tiled';
    button('atlas-apply').hidden = mode.value !== 'atlas';
    select('atlas-manifest').required =
      mode.value === 'atlas' && !element('atlas-manifest-field', HTMLElement).hidden;
  });
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    '#generic-import-fields input, #generic-import-fields select',
  )) {
    lifetime.assign(control, 'oninput', invalidate);
  }
  lifetime.assign(input('tiled-files'), 'onchange', () => {
    invalidate();
    const files = Array.from(input('tiled-files').files ?? []);
    const paths = files.map((file) => file.webkitRelativePath.split('/').slice(1).join('/'));
    select('tiled-map').replaceChildren(
      ...paths.filter((path) => /\.(tmj|json)$/.test(path)).map((path) => new Option(path, path)),
    );
  });
  lifetime.assign(button('generic-preflight'), 'onclick', () => {
    invalidate();
    const request = generation;
    void ports.run(async () => {
      const kind = mode.value;
      const id = input('generic-id').value.trim();
      let data: Record<string, unknown>;
      let image: string | null = null;
      if (kind === 'png') {
        const file = input('sheet-file').files?.[0];
        if (!file) {
          throw Error('Choose a PNG tilesheet.');
        }
        image = await encodeFile(file);
        data = {
          sheet: {
            id,
            png: image,
            grid: Number(select('sheet-grid').value),
            margin: Number(input('sheet-margin').value),
            spacing: Number(input('sheet-spacing').value),
          },
          reimport: input('sheet-reimport').checked,
          project_revision: revision(),
        };
      } else {
        const files: Record<string, string> = {};
        for (const file of Array.from(input('tiled-files').files ?? [])) {
          const path = file.webkitRelativePath.split('/').slice(1).join('/');
          relativeParts(path);
          if (!/\.(png|json|tmj|tsj)$/i.test(path)) {
            continue;
          }
          if (Object.keys(files).length >= 65 || file.size > 4 * 1024 * 1024) {
            throw Error('Select at most 65 PNG/JSON files, each at most 4 MiB.');
          }
          if (!/\.png$/i.test(path) && file.size > 1024 * 1024) {
            throw Error(`JSON exceeds 1 MiB: ${path}`);
          }
          files[path] = /\.png$/i.test(path) ? await encodeFile(file) : await file.text();
          if (
            Object.values(files).reduce((total, value) => total + value.length, 0) >
            7 * 1024 * 1024
          ) {
            throw Error('Selected dependencies exceed 7 MiB encoded.');
          }
        }
        data = {
          bundle: {
            map: select('tiled-map').value,
            files,
            id,
            name: input('tiled-title').value.trim(),
          },
          project_revision: revision(),
        };
      }
      lifetime.signal.throwIfAborted();
      const result = await api(`import-${kind === 'png' ? 'tilesheet' : 'tiled'}`, record, {
        ...data,
        dry_run: true,
      });
      lifetime.signal.throwIfAborted();
      if (request !== generation) {
        return;
      }
      if (kind === 'tiled') {
        report.textContent =
          result.compatible === true
            ? `${number(result.layers)} layers · ${number(result.tiles)} tiles\nDependencies: ${array(result.dependencies, string).join(', ')}\n${array(result.notes, string).join('\n')}`
            : array(result.errors, string).join('\n');
        if (result.compatible !== true) {
          return;
        }
        data.confirmation = string(result.confirmation);
      } else {
        report.textContent = `${array(result.regions, record).length} tiles · ${array(result.added, string).length} added · ${array(result.changed, string).length} changed\n${result.artwork_changed === true ? 'Artwork updated. ' : ''}GBC palette requirements are unverified. Source files stay unchanged.`;
        const img = new Image();
        img.src = `data:image/png;base64,${image}`;
        await img.decode();
        lifetime.signal.throwIfAborted();
        if (request !== generation) {
          return;
        }
        const zoom = Math.max(
          1,
          Math.min(16, Math.floor(512 / Math.max(number(result.width), number(result.height)))),
        );
        canvas.dataset.sourceWidth = String(result.width);
        canvas.width = number(result.width) * zoom;
        canvas.height = number(result.height) * zoom;
        const context = canvas.getContext('2d');
        if (!context) {
          throw Error('Canvas unavailable');
        }
        context.imageSmoothingEnabled = false;
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#ff56e0';
        context.lineWidth = 1;
        for (const region of array(result.regions, record)) {
          context.strokeRect(
            number(region.x) * zoom + 0.5,
            number(region.y) * zoom + 0.5,
            number(region.width) * zoom - 1,
            number(region.height) * zoom - 1,
          );
        }
        canvas.hidden = false;
      }
      if (request !== generation) {
        return;
      }
      prepared = { kind, data };
      apply.dataset.ready = 'true';
      apply.disabled = false;
    });
  });
  lifetime.assign(apply, 'onclick', async () => {
    const candidate = prepared;
    if (!candidate || !(await ports.discard()) || lifetime.disposed) {
      return;
    }
    void ports.run(async () => {
      const result = await api(
        `import-${candidate.kind === 'png' ? 'tilesheet' : 'tiled'}`,
        record,
        { ...candidate.data, dry_run: false },
      );
      await ports.clearDraft();
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      const target = candidate.kind === 'tiled' ? string(result.imported) : sceneId();
      if (target) {
        const loaded = await api(`scene/${target}`, decodeLoaded);
        if (lifetime.disposed) {
          return;
        }
        ports.open(loaded);
      }
      element('import-atlas-dialog', HTMLDialogElement).close();
      status.textContent = 'Import complete. Artwork and scene files belong to this project.';
      invalidate();
    });
  });
}
