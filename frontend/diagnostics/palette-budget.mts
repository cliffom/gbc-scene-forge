import { EditorLifetime } from '../editor/editor-lifetime.mts';
/** Debounced authoritative reports for the current canvas; stale replies never render. */
import * as v from 'valibot';
import { array, number, record, string } from '../shared/decode.mts';
import { finite, jsonObject, parse } from '../shared/schema.mts';

// Keep version/layout preflight ahead of reservations, as in the wire decoder.
function reservedSchema(limit = 8) {
  return v.nullable(
    v.pipe(
      finite,
      v.check(
        (value) => Number.isInteger(value) && value >= 0 && value <= limit,
        `Reserve 0..${limit} slots, or leave unknown.`,
      ),
    ),
  );
}
const layoutError = 'Unsupported hardware layout or sprite height.';
const hardwareLayoutSchema = jsonObject({
  id: v.literal('gbc-static-split-v1', layoutError),
  sprite_height: v.pipe(finite, v.picklist([8, 16], layoutError)),
  bg_tiles_reserved: v.unknown(),
  obj_tiles_reserved: v.unknown(),
  oam_reserved: v.unknown(),
});
const hardwareReservationsSchema = jsonObject({
  bg_tiles_reserved: reservedSchema(256),
  obj_tiles_reserved: reservedSchema(256),
  oam_reserved: reservedSchema(40),
});
const profileSchema = v.pipe(
  jsonObject({
    version: v.picklist([1, 2], 'Unsupported GBC palette profile.'),
    hardware: v.unknown(),
    bg_reserved: v.unknown(),
    obj_reserved: v.unknown(),
  }),
  v.transform(({ version, hardware, bg_reserved, obj_reserved }) => {
    const layout = version === 2 ? parse(hardwareLayoutSchema, hardware) : null;
    const reservations = parse(
      jsonObject({ bg_reserved: reservedSchema(), obj_reserved: reservedSchema() }),
      { bg_reserved, obj_reserved },
    );
    return {
      version,
      ...reservations,
      ...(layout
        ? {
            hardware: {
              id: layout.id,
              sprite_height: layout.sprite_height,
              ...parse(hardwareReservationsSchema, layout),
            },
          }
        : {}),
    };
  }),
);
export const paletteProfileSchema = v.nullish(profileSchema, null);
export type PaletteProfile = NonNullable<v.InferOutput<typeof paletteProfileSchema>>;
export function decodePaletteProfile(value: unknown): PaletteProfile | null {
  return parse(paletteProfileSchema, value);
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
  const hardwareEnabled = element('hardware-enabled', HTMLInputElement);
  const spriteHeight = element('hardware-sprite-height', HTMLSelectElement);
  const hardwareFields = ['bg_tiles', 'obj_tiles', 'oam'].map((key) =>
    element(`hardware-${key}-reserved`, HTMLInputElement),
  );
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
          version: hardwareEnabled.checked ? 2 : 1,
          ...(hardwareEnabled.checked
            ? {
                hardware: {
                  id: 'gbc-static-split-v1',
                  sprite_height: Number(spriteHeight.value),
                  bg_tiles_reserved:
                    hardwareFields[0].value === '' ? null : Number(hardwareFields[0].value),
                  obj_tiles_reserved:
                    hardwareFields[1].value === '' ? null : Number(hardwareFields[1].value),
                  oam_reserved:
                    hardwareFields[2].value === '' ? null : Number(hardwareFields[2].value),
                },
              }
            : {}),
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
    indicator.textContent = profile ? 'GBC budgets · pending' : 'GBC budgets…';
    indicator.dataset.state = 'pending';
  }
  function render(value: unknown, explicit: boolean) {
    const report = record(value);
    const state = string(report.status);
    indicator.dataset.state = state;
    indicator.textContent = `GBC budgets · ${state === 'pass' ? 'fit' : state === 'fail' ? 'over budget' : 'unverified'}`;
    summary.dataset.state = state;
    summary.textContent =
      explicit && report.hardware !== undefined
        ? `GBC budget preflight ${state === 'fail' ? 'failed' : 'unverified'}.`
        : explicit
          ? state === 'pass'
            ? 'GBC palette preflight passed.'
            : `GBC palette preflight ${state === 'fail' ? 'failed' : 'unverified'}.`
          : state === 'pass'
            ? 'Scene palettes fit the declared budget.'
            : state === 'fail'
              ? 'Scene exceeds the palette budget.'
              : report.hardware !== undefined
                ? 'Hardware estimates available; runtime compatibility is unverified.'
                : 'Palette budget is unverified.';
    findings.replaceChildren();
    if (report.hardware !== undefined) {
      const hardware = record(report.hardware);
      const title = document.createElement('h3');
      title.textContent = 'Static hardware estimates · runtime unverified';
      findings.append(title);
      for (const [key, value] of Object.entries(record(hardware.metrics))) {
        const metric = record(value);
        const details = document.createElement('details');
        const heading = document.createElement('summary');
        heading.textContent = `${key === 'bg_tiles' ? 'BG 8×8 source tiles' : key === 'obj_tiles' ? 'OBJ 8×8 source tiles' : 'OAM entries'}: ${number(metric.required)} estimated / ${metric.available === null ? 'unknown' : number(metric.available)} available · ${string(metric.status)}`;
        details.append(heading);
        details.addEventListener(
          'toggle',
          () => {
            if (!details.open || details.dataset.populated) {
              return;
            }
            details.dataset.populated = 'true';
            for (const source of array(metric.contributors, record)) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'palette-contributor small';
              button.textContent = `${string(source.layer_name)} · ${string(source.asset)} · ${source.object_id === null ? `cell ${number(source.x)}, ${number(source.y)}` : `object ${number(source.object_id)}`}`;
              lifetime.assign(button, 'onclick', () => options.navigate(source));
              details.append(button);
            }
          },
          { signal: lifetime.signal },
        );
        findings.append(details);
      }
      for (const source of array(hardware.unverified_contributors, record)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${string(source.asset)}: ${string(source.reason)}`;
        lifetime.assign(button, 'onclick', () => options.navigate(source));
        findings.append(button);
      }
    }
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
      summary.textContent = explicit ? 'Running GBC budget preflight…' : 'Checking current canvas…';
      summary.dataset.state = 'pending';
      findings.replaceChildren();
      indicator.textContent = 'GBC budgets · checking';
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
        indicator.textContent = 'GBC budgets · unverified';
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
      hardwareEnabled.checked = value?.version === 2;
      spriteHeight.value = String(value?.hardware?.sprite_height ?? 16);
      hardwareFields.forEach((field, i) => {
        const reservation =
          value?.hardware?.[
            (['bg_tiles_reserved', 'obj_tiles_reserved', 'oam_reserved'] as const)[i]
          ];
        field.value = reservation === null || reservation === undefined ? '' : String(reservation);
      });
      draftChanged = false;
    }
    enabled.disabled = save.disabled = blocked;
    hardwareEnabled.disabled = blocked || !enabled.checked;
    for (const field of [spriteHeight, ...hardwareFields]) {
      field.disabled = blocked || !enabled.checked || !hardwareEnabled.checked;
    }
    bg.disabled = obj.disabled = blocked || !enabled.checked;
    const context = value ? options.context() : null;
    preflight.textContent =
      value?.version === 2 ? 'Run GBC budget preflight' : 'Run GBC palette preflight';
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
  for (const field of [enabled, bg, obj, hardwareEnabled, spriteHeight, ...hardwareFields]) {
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
