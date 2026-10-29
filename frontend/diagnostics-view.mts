import { EditorLifetime } from './editor-lifetime.mts';
/** Read-only diagnostic options and findings; the server owns all validation rules. */
import { array, record, string } from './decode.mts';
export interface DiagnosticLocation {
  scene?: string;
  object?: number;
  layer?: number;
  x?: number;
  y?: number;
  asset?: string;
  connection?: string;
}
export function createDiagnosticsView(
  catalog: () => {
    definitions: { id: string; name: string }[];
    scenes: { id: string; name: string }[];
  },
  load: (options: Record<string, unknown>) => Promise<Record<string, unknown>>,
  navigate: (location: DiagnosticLocation) => void,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const dialog = document.createElement('dialog');
  dialog.id = 'diagnostics-dialog';
  dialog.setAttribute('aria-labelledby', 'diagnostics-heading');
  dialog.innerHTML = `
    <h2 id="diagnostics-heading">Project diagnostics</h2>
    <p>Checks include the open scene’s unsaved edits. Reports never modify project content.</p>
    <form id="diagnostics-form">
      <label>Movement model <select name="movement"><option value="none">Unspecified — no reachability claims</option><option value="grid-four-way">Four-direction grid walking</option></select></label>
      <details><summary>Movement assumptions and limits</summary><p>Grid walking uses scene-grid cell centers, swept axis-aligned footprints, scene bounds, and artwork collision shapes (or solid flags when no shapes exist). No jumping, climbing, one-way surfaces, dynamic actors, or inter-scene path simulation. A missing grid route may still work in your runtime. Checks above 65,536 cells or 4,096 start/goal pairs are unverified.</p></details>
      <fieldset><legend>Footprint in pixels, relative to each marker</legend>
      <label>X offset <input name="x" type="number" min="-4096" max="4096" step="any" value="-4" required></label>
      <label>Y offset <input name="y" type="number" min="-4096" max="4096" step="any" value="-4" required></label>
      <label>Width <input name="width" type="number" min="0.01" max="4096" step="any" value="8" required></label>
      <label>Height <input name="height" type="number" min="0.01" max="4096" step="any" value="8" required></label></fieldset>
      <p>Select object definitions for each role. Connection endpoints also count as entrances. Reachability checks each spawn/entrance against each goal within its scene.</p>
      <div class="diagnostics-roles"></div>
      <label><input name="include_hidden" type="checkbox"> Include hidden layers in object and collision checks</label>
      <label>Exclude scenes <select name="excluded_scenes" multiple aria-label="Exclude scenes"></select></label>
      <label>Exclude finding codes <input name="excluded_codes" placeholder="e.g. unused-asset, unknown-field"></label>
      <p>Exclusions apply only to this report. Excluded scenes still count as asset consumers.</p>
      <button id="diagnostics-run" type="submit">Run diagnostics</button>
    </form>
    <p id="diagnostics-state" role="status">Choose assumptions, then run diagnostics.</p>
    <p id="diagnostics-error" role="alert"></p>
    <ol id="diagnostics-findings"></ol>
    <div class="diagnostics-footer"><button id="diagnostics-close" type="button">Close</button></div>`;
  document.body.append(dialog);
  lifetime.cleanup(() => {
    generation++;
    dialog.remove();
  });
  const form = dialog.querySelector('form');
  const state = dialog.querySelector('#diagnostics-state');
  const error = dialog.querySelector('#diagnostics-error');
  const list = dialog.querySelector('#diagnostics-findings');
  if (!form || !state || !error || !list) {
    throw Error('Missing diagnostic controls');
  }
  let working = false;
  let generation = 0;
  lifetime.assign(dialog, 'onclose', () => {
    if (!dialog.open) {
      generation++;
    }
  });
  const close = dialog.querySelector<HTMLButtonElement>('#diagnostics-close');
  if (close) {
    lifetime.assign(close, 'onclick', () => dialog.close());
  }
  function select(name: string) {
    const node = form?.elements.namedItem(name);
    if (!(node instanceof HTMLSelectElement)) {
      throw Error(`Missing ${name}`);
    }
    return node;
  }
  function choices(node: HTMLSelectElement, values: { id: string; name: string }[]) {
    const selected = new Set(Array.from(node.selectedOptions, (o) => o.value));
    node.replaceChildren(...values.map((v) => new Option(v.name, v.id, false, selected.has(v.id))));
  }
  const roles = dialog.querySelector('.diagnostics-roles');
  for (const role of ['spawn', 'entrance', 'goal']) {
    const label = document.createElement('label');
    label.textContent = `${role[0].toUpperCase()}${role.slice(1)} definitions `;
    const node = document.createElement('select');
    node.multiple = true;
    node.name = `${role}_definitions`;
    label.append(node);
    roles?.append(label);
  }
  function options() {
    const data = new FormData(form ?? undefined);
    return {
      movement: data.get('movement'),
      footprint: Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((k) => [k, Number(data.get(k))]),
      ),
      include_hidden: data.has('include_hidden'),
      ...Object.fromEntries(
        ['spawn_definitions', 'entrance_definitions', 'goal_definitions', 'excluded_scenes'].map(
          (k) => [k, data.getAll(k)],
        ),
      ),
      excluded_codes: string(data.get('excluded_codes'))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  function signature(report: Record<string, unknown>) {
    return JSON.stringify([report.project_revision, report.scene_revisions, report.findings]);
  }
  function controls(disabled: boolean) {
    if (lifetime.disposed) {
      return;
    }
    working = disabled;
    for (const node of form?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >('input,select,button') ?? []) {
      node.disabled = disabled;
    }
    for (const node of list?.querySelectorAll('button') ?? []) {
      node.disabled = disabled;
    }
  }
  lifetime.assign(form, 'onchange', () => {
    generation++;
    list.replaceChildren();
    state.textContent = 'Options changed. Run diagnostics again.';
  });
  lifetime.assign(form, 'onsubmit', (event) => {
    event.preventDefault();
    if (working) {
      return;
    }
    const current = ++generation;
    const config = options();
    error.textContent = '';
    list.replaceChildren();
    state.textContent = 'Checking project…';
    controls(true);
    void load(config)
      .then((report) => {
        if (lifetime.disposed || current !== generation) {
          return;
        }
        const findings = array(report.findings, record);
        state.textContent = `${string(report.status)} · ${findings.length} findings · ${String(report.suppressed)} excluded by code. ${select('excluded_scenes').selectedOptions.length} scenes excluded.`;
        for (const finding of findings) {
          const row = document.createElement('li');
          row.dataset.code = string(finding.code);
          const scene = catalog().scenes.find((s) => s.id === finding.scene);
          const text = document.createElement('span');
          text.textContent = `${string(finding.severity).toUpperCase()} · ${scene?.name ?? (typeof finding.scene === 'string' ? finding.scene : 'Project')} · ${string(finding.message)} `;
          row.append(text);
          if (finding.scene || finding.asset || finding.connection) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Inspect';
            lifetime.assign(button, 'onclick', () => {
              controls(true);
              error.textContent = '';
              void load(config)
                .then((fresh) => {
                  if (lifetime.disposed || current !== generation || !dialog.open) {
                    return;
                  }
                  if (signature(fresh) !== signature(report)) {
                    list.replaceChildren();
                    state.textContent = 'Results are stale. Run diagnostics again.';
                    return;
                  }
                  const location: DiagnosticLocation = {};
                  for (const key of ['scene', 'asset', 'connection'] as const) {
                    if (typeof finding[key] === 'string') {
                      location[key] = finding[key];
                    }
                  }
                  for (const key of ['object', 'layer', 'x', 'y'] as const) {
                    if (typeof finding[key] === 'number') {
                      location[key] = finding[key];
                    }
                  }
                  dialog.close();
                  navigate(location);
                })
                .catch((e: unknown) => {
                  if (lifetime.disposed || current !== generation) {
                    return;
                  }
                  error.textContent = `Results may be stale: ${e instanceof Error ? e.message : String(e)}`;
                  list.replaceChildren();
                })
                .finally(() => controls(false));
            });
            row.append(button);
          }
          list.append(row);
        }
      })
      .catch((e: unknown) => {
        if (lifetime.disposed || current !== generation) {
          return;
        }
        error.textContent = e instanceof Error ? e.message : String(e);
        state.textContent = 'Report unavailable. Refresh the project after external changes.';
      })
      .finally(() => controls(false));
  });
  return {
    open() {
      const values = catalog();
      for (const role of ['spawn', 'entrance', 'goal']) {
        choices(select(`${role}_definitions`), values.definitions);
      }
      choices(select('excluded_scenes'), values.scenes);
      generation++;
      list.replaceChildren();
      error.textContent = '';
      state.textContent = 'Choose assumptions, then run diagnostics.';
      dialog.showModal();
    },
  };
}
