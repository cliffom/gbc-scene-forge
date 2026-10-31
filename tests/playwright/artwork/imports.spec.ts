import { expect } from '@playwright/test';
/** Generic PNG slicing and bounded external Tiled intake through the real browser UI. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { record, string } from '../../../frontend/shared/decode.mts';

import { clickControl, setControl, test, waitForUI } from '../support/browser-fixtures.ts';
test('imports: Generic PNG slicing and bounded external Tiled intake through the real browser UI.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const url = await workspace.start(folder, true, true);
  const evaluate = (expression: string) => page.evaluate(expression);
  const wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  const set = async (id: string, value: string) => setControl(page, id, value);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await wait("document.getElementById('project-form')?.hidden === false");
  await set('project-title', 'Generic imports');
  await page.locator('#project-form button.primary').first().click();
  await wait(
    "document.getElementById('status')?.textContent.includes('Choose a scene') && !document.getElementById('library-import').disabled",
  );
  const png = execFileSync(
    '.venv/bin/python',
    [
      '-c',
      "import sys,base64;sys.path.insert(0,'tests');from support.atlas_fixture import image;print(base64.b64encode(image(19,10,(12,45,67))).decode())",
    ],
    { encoding: 'utf8' },
  ).trim();
  async function files(id: string, values: { path: string; data: string; binary?: boolean }[]) {
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      for (const value of ${JSON.stringify(values)}) {
        const bytes = value.binary ? Uint8Array.from(atob(value.data), c => c.charCodeAt(0)) : value.data;
        const file = new File([bytes], value.path.split('/').at(-1));
        Object.defineProperty(file, 'webkitRelativePath', {value: value.path});
        transfer.items.add(file);
      }
      const input = document.getElementById(${JSON.stringify(id)});
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  }
  const before = record(await (await fetch(new URL('api/project', url))).json());
  await click('library-import');
  await set('import-kind', 'png');
  await set('generic-id', 'plain');
  await set('sheet-margin', '1');
  await set('sheet-spacing', '1');
  await files('sheet-file', [{ path: 'sheet.png', data: png, binary: true }]);
  await click('generic-preflight');
  await wait("document.getElementById('generic-apply').disabled === false");
  assert.equal(
    await evaluate("document.getElementById('sheet-preview').dataset.sourceWidth"),
    '19',
  );
  await expect(page.locator('#sheet-preview')).toHaveJSProperty('hidden', false);
  assert.ok(
    string(await evaluate("document.getElementById('generic-report').textContent")).includes(
      '2 tiles',
    ),
  );
  assert.equal(
    record(await (await fetch(new URL('api/project', url))).json()).revision,
    before.revision,
  );
  await page.screenshot({ path: testInfo.outputPath('import-png-preview' + '.png') });
  // A changed setting invalidates confirmation, including across editor updates.
  await set('sheet-margin', '2');
  await expect(page.locator('#generic-apply')).toBeDisabled();
  await click('generic-preflight');
  await wait("document.querySelector('#import-form .form-error').textContent.includes('slice')");
  await expect(page.locator('#generic-apply')).toBeDisabled();
  await set('sheet-margin', '1');
  await click('generic-preflight');
  await wait("document.getElementById('generic-apply').disabled === false");
  await click('generic-apply');
  await wait(
    "!document.getElementById('import-atlas-dialog').open && document.getElementById('status').textContent.includes('Import complete')",
  );
  const imported = record(record(await (await fetch(new URL('api/project', url))).json()).project);
  assert.ok(record(imported.atlases).plain);
  // External JSON map + external TSJ + PNG, rejected then accepted without loss.
  const tileset = {
    type: 'tileset',
    name: 'Sheet',
    tilewidth: 8,
    tileheight: 8,
    image: 'sheet.png',
    imagewidth: 19,
    imageheight: 10,
    columns: 2,
    tilecount: 2,
    margin: 1,
    spacing: 1,
  };
  const map = {
    type: 'map',
    orientation: 'orthogonal',
    width: 2,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{ firstgid: 1, source: 'art/tiles.tsj' }],
    layers: [
      { id: 1, name: 'Imported floor', type: 'tilelayer', width: 2, height: 1, data: [1, 2] },
    ],
  };
  async function bundle(unsupported: boolean) {
    await files('tiled-files', [
      {
        path: 'source/map.tmj',
        data: JSON.stringify({ ...map, ...(unsupported ? { backgroundcolor: '#ffffff' } : {}) }),
      },
      { path: 'source/art/tiles.tsj', data: JSON.stringify(tileset) },
      { path: 'source/art/sheet.png', data: png, binary: true },
    ]);
    await set('tiled-map', 'map.tmj');
  }
  await click('library-import');
  await set('import-kind', 'tiled');
  await set('generic-id', 'external');
  await set('tiled-title', 'External map');
  await bundle(true);
  await click('generic-preflight');
  await wait("document.getElementById('generic-report').textContent.includes('backgroundcolor')");
  await expect(page.locator('#generic-apply')).toBeDisabled();
  await bundle(false);
  await click('generic-preflight');
  await wait("document.getElementById('generic-apply').disabled === false");
  assert.ok(
    string(await evaluate("document.getElementById('generic-report').textContent")).includes(
      'art/sheet.png',
    ),
  );
  await page.screenshot({ path: testInfo.outputPath('import-tiled-preflight' + '.png') });
  await click('generic-apply');
  await wait(
    "!document.getElementById('import-atlas-dialog').open && document.getElementById('status').textContent.includes('Import complete')",
  );
  const id = string(await evaluate("document.getElementById('scenes').value"));
  const saved = record(await (await fetch(new URL(`api/scene/${id}`, url))).json());
  assert.ok(JSON.stringify(saved).includes('external_1/tile_1_0/0/0'));
  assert.equal(saved.name, 'External map');
  await page.reload();
  await wait(
    "document.getElementById('status')?.textContent === 'Scene opened.' && !document.getElementById('scenes').disabled",
  );
  await set('scenes', id);
  await wait("document.getElementById('status').textContent === 'Scene opened.'");

  console.log(
    'Generic import acceptance passed: PNG slicing, invalidation, Tiled preflight/import/reopen.',
  );
});
