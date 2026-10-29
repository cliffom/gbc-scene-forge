import { EditorLifetime } from './editor-lifetime.mts';
/** Debounced authoritative reports for the current canvas; stale replies never render. */
import { array, number, record, string } from './decode.mts';

export interface PaletteProfile {
  version: 1;
  bg_reserved: number | null;
  obj_reserved: number | null;
}
export function decodePaletteProfile(value: unknown): PaletteProfile | null {
  if (value === undefined || value === null) {
    return null;
  }
  const data = record(value);
  const reserved = (value: unknown) => {
    if (value === null) {
      return null;
    }
    const result = number(value);
    if (!Number.isInteger(result) || result < 0 || result > 8) {
      throw Error('Reserve 0..8 palette slots, or leave unknown.');
    }
    return result;
  };
  if (data.version !== 1) {
    throw Error('Unsupported GBC palette profile.');
  }
  return {
    version: 1,
    bg_reserved: reserved(data.bg_reserved),
    obj_reserved: reserved(data.obj_reserved),
  };
}

export function createPalettePanel(
  options: {
    context: () => { payload: unknown; key: string } | null;
    report: (preflight: boolean, payload: unknown) => Promise<unknown>;
    save: (profile: PaletteProfile | null) => void;
    navigate: (source: Record<string, unknown>) => void;
  },
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  function element<T extends HTMLElement>(id: string, type: new () => T): T {
    const value = document.getElementById(id);
    if (!(value instanceof type)) {
      throw Error(`Missing ${id}`);
    }
    return value;
  }
  const enabled = element('palette-enabled', HTMLInputElement);
  const bg = element('palette-bg-reserved', HTMLInputElement);
  const obj = element('palette-obj-reserved', HTMLInputElement);
  const save = element('palette-save-profile', HTMLButtonElement);
  const preflight = element('palette-preflight', HTMLButtonElement);
  const summary = element('palette-summary', HTMLElement);
  const findings = element('palette-findings', HTMLElement);
  const indicator = element('show-palettes', HTMLButtonElement);
  let profileKey = '';
  let key = '';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let profile: PaletteProfile | null = null;
  let draftChanged = false;
  let activeRequests = 0;
  let renderedKey = '';
  let renderedSignature = '';
  function draft(): PaletteProfile | null {
    return enabled.checked
      ? decodePaletteProfile({
          version: 1,
          bg_reserved: bg.value === '' ? null : Number(bg.value),
          obj_reserved: obj.value === '' ? null : Number(obj.value),
        })
      : null;
  }
  function invalidate(message: string) {
    renderedKey = renderedSignature = '';
    generation++;
    lifetime.cancelTimeout(timer);
    summary.textContent = message;
    summary.dataset.state = 'pending';
    findings.replaceChildren();
    indicator.textContent = profile ? 'GBC palettes · pending' : 'GBC palettes…';
    indicator.dataset.state = 'pending';
  }
  function render(value: unknown, explicit: boolean) {
    const report = record(value);
    const state = string(report.status);
    indicator.dataset.state = state;
    indicator.textContent = `GBC palettes · ${state === 'pass' ? 'fit' : state === 'fail' ? 'over budget' : 'unverified'}`;
    summary.dataset.state = state;
    summary.textContent = explicit
      ? state === 'pass'
        ? 'GBC palette preflight passed.'
        : `GBC palette preflight ${state === 'fail' ? 'failed' : 'unverified'}.`
      : state === 'pass'
        ? 'Scene palettes fit the declared budget.'
        : state === 'fail'
          ? 'Scene exceeds the palette budget.'
          : 'Palette budget is unverified.';
    findings.replaceChildren();
    for (const [pool, value] of Object.entries(record(report.pools))) {
      const data = record(value);
      const heading = document.createElement('p');
      heading.className = 'palette-count';
      heading.textContent = `${pool === 'BG' ? 'Background' : 'Sprite'} palettes: ${number(data.required)} required, ${data.available === null ? 'unknown' : number(data.available)} available (${data.reserved === null ? 'unknown' : number(data.reserved)} reserved)`;
      findings.append(heading);
      array(data.palettes, record).forEach((palette, index) => {
        const details = document.createElement('details');
        const title = document.createElement('summary');
        title.textContent = `${pool} palette ${index + 1} · contributors`;
        details.append(title);
        const swatches = document.createElement('span');
        swatches.className = 'palette-swatches';
        for (const color of array(palette.entries, (value) => array(value, number))) {
          const swatch = document.createElement('span');
          swatch.style.backgroundColor = `rgb(${color.map((v) => Math.floor((v * 255 + 15) / 31)).join(' ')})`;
          swatch.title = `RGB5 ${color.join(', ')}`;
          swatches.append(swatch);
        }
        details.append(swatches);
        // Populate on demand so large scenes do not create thousands of controls per edit.
        details.addEventListener(
          'toggle',
          () => {
            if (!details.open || details.dataset.populated) {
              return;
            }
            details.dataset.populated = 'true';
            for (const source of array(palette.contributors, record)) {
              const link = document.createElement('button');
              link.type = 'button';
              link.className = 'palette-contributor small';
              link.textContent = `${string(source.layer_name)} · ${source.object_id === null ? `cell ${number(source.x)}, ${number(source.y)}` : `object ${number(source.object_id)}`} · ${string(source.atlas)}/${string(source.region)} · local ${number(source.local_palette)}${source.animation === null ? '' : ` · ${string(source.animation)}`}`;
              lifetime.assign(link, 'onclick', () => options.navigate(source));
              details.append(link);
            }
          },
          { signal: lifetime.signal },
        );
        findings.append(details);
      });
    }
    for (const message of [...array(report.errors, string), ...array(report.warnings, string)]) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = message;
      findings.append(p);
    }
    for (const source of array(report.unverified_contributors ?? [], record)) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'palette-contributor small';
      link.textContent = `${string(source.layer_name)} · ${string(source.asset)}: ${string(source.reason)}`;
      lifetime.assign(link, 'onclick', () => options.navigate(source));
      findings.append(link);
    }
  }
  async function check(explicit = false) {
    if (lifetime.disposed || !profile || busy || draftChanged) {
      return;
    }
    const context = options.context();
    if (!context) {
      return;
    }
    const serial = ++generation;
    const expected = context.key;
    if (explicit || renderedKey !== expected) {
      summary.textContent = explicit
        ? 'Running GBC palette preflight…'
        : 'Checking current canvas…';
      summary.dataset.state = 'pending';
      findings.replaceChildren();
      indicator.textContent = 'GBC palettes · checking';
      indicator.dataset.state = 'pending';
    }
    activeRequests++;
    try {
      const report = await options.report(explicit, context.payload);
      if (!lifetime.disposed && serial === generation && options.context()?.key === expected) {
        const signature = JSON.stringify(report);
        if (explicit || signature !== renderedSignature) {
          render(report, explicit);
        }
        renderedSignature = signature;
        renderedKey = expected;
      }
    } catch (error) {
      if (!lifetime.disposed && serial === generation && options.context()?.key === expected) {
        invalidate(
          `Palette check unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        summary.dataset.state = 'unverified';
        indicator.textContent = 'GBC palettes · unverified';
        indicator.dataset.state = 'unverified';
      }
    } finally {
      activeRequests--;
    }
  }
  function sync(value: PaletteProfile | null, blocked: boolean) {
    busy = blocked;
    profile = value;
    const nextProfileKey = JSON.stringify(value);
    if (nextProfileKey !== profileKey) {
      profileKey = nextProfileKey;
      enabled.checked = value !== null;
      bg.value = value?.bg_reserved === null || value === null ? '' : String(value.bg_reserved);
      obj.value = value?.obj_reserved === null || value === null ? '' : String(value.obj_reserved);
      draftChanged = false;
    }
    enabled.disabled = save.disabled = blocked;
    bg.disabled = obj.disabled = blocked || !enabled.checked;
    const context = value ? options.context() : null;
    preflight.disabled = blocked || !value || draftChanged || !context;
    const next = JSON.stringify([context?.key, nextProfileKey, blocked, draftChanged]);
    if (next !== key) {
      key = next;
      invalidate(
        draftChanged
          ? 'Save profile changes before validating.'
          : !value
            ? 'GBC palette checks are off.'
            : !context
              ? 'Open a scene to check its palettes.'
              : blocked
                ? 'Waiting for the current edit…'
                : 'Palette report needs refresh…',
      );
      if (!blocked && value && !draftChanged && context) {
        timer = lifetime.timeout(() => {
          void check();
        }, 300);
      }
    }
  }
  for (const field of [enabled, bg, obj]) {
    lifetime.assign(field, 'oninput', () => {
      draftChanged = true;
      sync(profile, busy);
    });
  }
  lifetime.assign(save, 'onclick', () => {
    try {
      options.save(draft());
    } catch (error) {
      invalidate(error instanceof Error ? error.message : String(error));
    }
  });
  lifetime.assign(preflight, 'onclick', () => {
    void check(true);
  });
  // Recheck revision guards so an idle tab cannot indefinitely show an old passing report.
  lifetime.interval(() => {
    if (activeRequests === 0) {
      void check();
    }
  }, 5000);
  return {
    sync,
    saved() {
      profileKey = '';
      draftChanged = false;
    },
  };
}
