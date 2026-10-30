import { expect } from '@playwright/test';
/** Real keyboard/pointer object definitions, inheritance and instance validation. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { record, string } from '../../../frontend/shared/decode.mts';
import { clickControl, scenePoint, test, waitForUI } from '../support/browser-fixtures.ts';
test('definitions: Real keyboard/pointer object definitions, inheritance and instance validation.', async ({
  page,
  workspace,
}, testInfo) => {
  const { folder } = workspace;
  const root = join(folder, 'world');
  const { stdout } = await promisify(execFile)('.venv/bin/python', [
    '-c',
    `
import json, sys
from pathlib import Path
sys.path.insert(0, 'tests')
from atlas_fixture import bundle, sprite_bundle
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import png
p = Project.create(Path(sys.argv[1]), 'Reusable rooms')
source, _ = bundle(p.root.parent / 'art')
pixels = b''.join(bytes([((0, 82), (165, 255))[y // 4][(x % 8) // 4]] * 3 + [255]) for y in range(8) for x in range(16))
(source.parent / 'atlas.png').write_bytes(png.encode(16, 8, pixels))
p.artwork.import_atlas(source, p.catalog()['revision'])
actors, _ = sprite_bundle(p.root.parent / 'actors')
p.artwork.import_atlas(actors, p.catalog()['revision'])
ids = []
for name in ('Room', 'Other room', 'Missing layers'):
    loaded = p.scenes.create(name, 12, 10, 8, p.catalog()['revision'])
    scene = loaded['scene']
    if name != 'Missing layers':
        scene['cells'][0][:2] = ['terrain/earth/0/0', 'terrain/stone/0/0']
        scene = dict(width=12, height=10, grid=8, next_layer_id=3, next_object_id=3, layers=[
            dict(id=1, name='Ground', type='tilelayer', visible=True, cells=scene['cells']),
            dict(id=2, name='Markers', type='objectgroup', visible=True, objects=[
                dict(id=1, kind='point', x=1, y=1, name='spawn', properties=[dict(name='door', type='string', value='north')]),
                dict(id=2, kind='rectangle', x=9, y=1, width=3, height=4, name='trigger')])])
        p.scenes.save(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
    ids.append(loaded['id'])
definition = p.objects.save_definition(dict(name='Regression fields', kind='point', fields=[
    dict(name=f'field-{n}', type='int', required=False, default=n) for n in range(128)
]), p.catalog()['revision'])
definition_id = definition['definition_id']
loaded = p.scenes.create('Regression', 12, 10, 8, p.catalog()['revision'])
scene = dict(width=12, height=10, grid=8, next_layer_id=2, next_object_id=3, layers=[
    dict(id=1, name='Instances', type='objectgroup', visible=True, objects=[
        dict(id=1, kind='point', x=8, y=8, definition=definition_id,
             properties=[dict(name='field-0', type='float', value=1.5)]),
        dict(id=2, kind='point', x=16, y=16, definition=definition_id,
             properties=[dict(name=f'extra-{n}', type='string', value=f'keep-{n}') for n in range(128)])])])
p.scenes.save(loaded['id'], scene, loaded['revision'], p.catalog()['revision'])
ids.append(loaded['id'])
print(json.dumps(ids))
`,
    root,
  ]);
  const ids: unknown = JSON.parse(stdout);
  assert(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
  const [first, second, , regression] = ids.map(string);
  const url = await workspace.start(root, false, true);
  const evaluate = (expression: string) => page.evaluate(expression),
    wait = (expression: string) => waitForUI(page, expression);
  const click = (id: string) => clickControl(page, id);
  const choose = async (id: string) => {
    await wait(
      "document.getElementById('scenes')?.disabled === false && !document.getElementById('show-create').disabled",
    );
    await page.locator('#scenes').selectOption(id);
    await wait(
      `document.getElementById('scene-name').textContent.startsWith(${JSON.stringify(id === first ? 'Room ·' : id === regression ? 'Regression ·' : 'Other room ·')}) && !document.getElementById('show-create').disabled`,
    );
  };
  const saved = async (id: string): Promise<unknown> =>
    JSON.parse(await readFile(join(root, 'scenes', `${id}.tmj`), 'utf8'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await wait("document.getElementById('project-name')?.textContent === 'Reusable rooms'");
  await choose(first);
  const set = async (selector: string, value: string | boolean) => {
    const control = page.locator(selector);
    if (typeof value === 'boolean') {
      await control.setChecked(value);
    } else if (await control.evaluate((element) => element.tagName === 'SELECT')) {
      await control.selectOption(value);
    } else {
      await control.fill(value);
      await control.dispatchEvent('change');
    }
  };
  const chooseValue = (id: string, value: string) => set('#' + id, value);
  const field = (index: number, control: string) =>
    `#definition-fields > :nth-child(${index + 1}) .field-${control}`;
  await click('manage-definitions');
  await chooseValue('definition-name', 'Entrance');
  await click('definition-add-field');
  await set(field(0, 'name'), 'destination');
  await set(field(0, 'required'), true);
  await click('definition-add-field');
  await set(field(1, 'name'), 'facing');
  await set(field(1, 'has-default'), true);
  await set(field(1, 'default'), 'south');
  await set(field(1, 'choices'), 'south\nnorth');
  await click('definition-add-field');
  await set(field(2, 'name'), 'priority');
  await set(field(2, 'type'), 'int');
  await set(field(2, 'min'), '0');
  await set(field(2, 'max'), '10');
  await set(field(2, 'has-default'), true);
  await set(field(2, 'default'), '1');
  await click('definition-add-field');
  await set(field(3, 'name'), 'enabled');
  await set(field(3, 'type'), 'bool');
  await set(field(3, 'has-default'), true);
  await page.screenshot({ path: testInfo.outputPath('object-definition-library' + '.png') });
  await click('definition-save');
  await wait(
    "!document.getElementById('definitions-dialog').open && !document.getElementById('manage-definitions').disabled",
  );
  const manifest = (): Promise<unknown> =>
    readFile(join(root, 'forge.project.json'), 'utf8').then((text): unknown => JSON.parse(text));
  let data = record(await manifest());
  const library = record(data.object_definitions);
  assert(Array.isArray(library.definitions));
  const definitionId = string(
    record(library.definitions.find((d) => record(d).name === 'Entrance')).id,
  );
  await chooseValue('object-definition-brush', definitionId);
  await click('place-definition');
  await (async () => {
    const point = await scenePoint(page, 33, 33);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  })();
  await (async () => {
    const point = await scenePoint(page, 33, 33);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
  })();
  await wait(
    "document.getElementById('object-validation-summary').textContent.includes('1 linked instances · 1 findings')",
  );
  await click('undo');
  await wait(
    "document.getElementById('object-validation-summary').textContent.includes('0 linked instances')",
  );
  await click('redo');
  await page.locator('#object-findings button').first().click();
  await click('edit-object');
  await wait("document.getElementById('object-dialog').open");
  const instanceField = (name: string, control: string) =>
    `.definition-instance-field[data-field="${name}"] ${control}`;
  await set(instanceField('destination', 'input[type=checkbox]'), true);
  await set(instanceField('destination', '[aria-label=destination]'), 'Room B');
  await set(instanceField('priority', 'input[type=checkbox]'), true);
  await set(instanceField('priority', '[aria-label=priority]'), '3');
  await page.screenshot({ path: testInfo.outputPath('object-definition-instance' + '.png') });
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  await wait(
    "document.getElementById('object-validation-summary').textContent.includes('1 linked instances · 0 findings')",
  );
  await click('save');
  await wait(
    "document.getElementById('scene-save-state').textContent === 'Saved' && !document.getElementById('manage-definitions').disabled",
  );
  const map = record(await saved(first));
  const objects = () => {
    assert(Array.isArray(map.layers));
    const items = record(map.layers[1]).objects;
    assert(Array.isArray(items));
    return items.map(record);
  };
  const placed = objects().find(
    (o) =>
      Array.isArray(o.properties) &&
      o.properties.some((p) => record(p).name === 'forge:definition'),
  );
  assert(placed);
  const objectId = String(placed.id);
  const props = placed.properties;
  assert(Array.isArray(props));
  assert.deepEqual(
    JSON.parse(string(record(props.find((p) => record(p).name === 'forge:overrides')).value)),
    ['destination', 'priority'],
  );
  // Dirty canvas and undo history survive a project definition update.
  await click('edit-object');
  await chooseValue('object-name', 'Arrival');
  await click('object-apply');
  await click('manage-definitions');
  await chooseValue('definition-list', definitionId);
  await set(field(1, 'default'), 'north');
  await set(field(2, 'max'), '2');
  await click('definition-save');
  await wait(
    "!document.getElementById('definitions-dialog').open && !document.getElementById('manage-definitions').disabled",
  );
  await wait(
    "document.getElementById('object-validation-summary').textContent.includes('1 findings')",
  );
  await click('edit-object');
  assert.equal(
    await evaluate(
      `document.querySelector('${instanceField('facing', '[aria-label=facing]')}').value`,
    ),
    'north',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('${instanceField('priority', '[aria-label=priority]')}').value`,
    ),
    '3',
  );
  await click('object-cancel');
  await click('undo');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  assert.equal(
    await evaluate(
      "document.getElementById('object-validation-summary').textContent.includes('1 findings')",
    ),
    true,
  );
  await click('redo');
  await click('edit-object');
  await set(instanceField('priority', 'input[type=checkbox]'), false);
  await click('object-apply');
  await wait(
    "document.getElementById('object-validation-summary').textContent.includes('0 findings')",
  );
  // Wait for the checkpoint containing the reset override before reloading.
  await wait(`(async () => {
    const c = await (await fetch('api/project')).json();
    const post = async (route,payload) => (await fetch('api/' + route,{method:'POST',headers:{'Content-Type':'application/json','X-Scene-Token':c.token},body:JSON.stringify(payload)})).json();
    const listing = await post('list-drafts',{});
    for (const entry of listing.drafts) {
      const d = await post('download-draft',entry);
      const object = d.scene.layers.flatMap(l => l.objects || []).find(o => o.name === 'Arrival');
      if (object && object.definition === ${JSON.stringify(definitionId)} && !object.properties.some(p => p.name === 'priority')) return true;
    }
    return false;
  })()`);
  await page.reload();
  await wait(
    "document.getElementById('recovery-dialog')?.open && !document.getElementById('show-create').disabled",
  );
  await click('recovery-restore');
  await wait("document.getElementById('status').textContent.includes('Draft restored')");
  await page.locator('[data-layer-id="2"] .layer-choice').first().click();
  await chooseValue('object-list', objectId);
  await click('edit-object');
  assert.equal(
    await evaluate(
      `document.querySelector('${instanceField('priority', '[aria-label=priority]')}').value`,
    ),
    '1',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('${instanceField('priority', 'input[type=checkbox]')}').checked`,
    ),
    false,
  );
  await click('object-cancel');
  await click('save');
  await wait(
    "document.getElementById('scene-save-state').textContent === 'Saved' && !document.getElementById('manage-definitions').disabled",
  );
  await choose(second);
  await choose(first);
  await page.locator('[data-layer-id="2"] .layer-choice').first().click();
  await chooseValue('object-list', objectId);
  await click('edit-object');
  // Detaching materializes current values, and Cancel leaves the link intact.
  await chooseValue('object-definition', '');
  await click('object-cancel');
  await click('edit-object');
  await expect(page.locator('#object-definition')).toHaveValue(definitionId);
  await chooseValue('object-definition', '');
  await click('object-apply');
  await click('undo');
  await click('edit-object');
  await expect(page.locator('#object-definition')).toHaveValue(definitionId);
  await click('object-cancel');
  // Rectangle and sprite definitions place native objects, with scene-only undo.
  for (const kind of ['rectangle', 'sprite']) {
    await click('manage-definitions');
    await chooseValue('definition-name', kind === 'sprite' ? 'Guard' : 'Area');
    await chooseValue('definition-kind', kind);
    await click('definition-save');
    await wait(
      "!document.getElementById('definitions-dialog').open && !document.getElementById('manage-definitions').disabled",
    );
    const library = record(record(await manifest()).object_definitions).definitions;
    assert(Array.isArray(library));
    const shape = library.map(record).find((d) => d.kind === kind);
    assert(shape);
    const shapeId = string(shape.id);
    await chooseValue('object-definition-brush', shapeId);
    await click('place-definition');
    await (async () => {
      const point = await scenePoint(page, 49, 49);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    })();
    await (async () => {
      const point = await scenePoint(page, 49, 49);
      await page.mouse.move(point.x, point.y);
      await page.mouse.up();
    })();
    await wait(
      "document.getElementById('object-validation-summary').textContent.includes('2 linked instances')",
    );
    if (kind === 'sprite') {
      await click('manage-definitions');
      await chooseValue('definition-list', shapeId);
      await evaluate('window.confirm = () => false');
      await click('definition-delete');
      await expect(page.locator('#definitions-dialog')).toHaveJSProperty('open', true);
      await evaluate('window.confirm = () => true');
      await click('definition-delete');
      await wait(
        "!document.getElementById('definitions-dialog').open && !document.getElementById('manage-definitions').disabled",
      );
      await wait(
        "document.getElementById('object-findings').textContent.includes('Missing definition')",
      );
      await click('undo');
      await click('redo');
      await wait(
        "document.getElementById('object-findings').textContent.includes('Missing definition')",
      );
    }
    await click('undo');
    await wait(
      "document.getElementById('object-validation-summary').textContent.includes('1 linked instances · 0 findings')",
    );
  }
  // Retained fractional float overrides must not block unrelated edits after an int schema change.
  await choose(regression);
  await chooseValue('object-list', '1');
  await click('edit-object');
  assert.equal(await evaluate("document.getElementById('object-form').checkValidity()"), true);
  await chooseValue('object-name', 'Retained fractional override');
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  await click('edit-object');
  assert.equal(
    await evaluate(
      `document.querySelector('${instanceField('field-0', '[aria-label="field-0"]')}').value`,
    ),
    '1.5',
  );
  // Explicit editing restores integer constraints; resetting returns to the shared default.
  await set(instanceField('field-0', '[aria-label="field-0"]'), '2.5');
  assert.equal(await evaluate("document.getElementById('object-form').checkValidity()"), false);
  await set(instanceField('field-0', 'input[type=checkbox]'), false);
  assert.equal(await evaluate("document.getElementById('object-form').checkValidity()"), true);
  await click('object-cancel');
  await chooseValue('object-list', '2');
  await click('edit-object');
  await chooseValue('object-definition', '');
  assert.equal(await evaluate("document.querySelectorAll('#object-properties > div').length"), 256);
  await click('object-apply');
  await wait("!document.getElementById('object-dialog').open");
  await click('undo');
  await click('edit-object');
  assert.notEqual(await evaluate("document.getElementById('object-definition').value"), '');
  await click('object-cancel');
  await click('redo');
  await click('save');
  await wait("document.getElementById('scene-save-state').textContent === 'Saved'");
  const regressionMap = record(await saved(regression));
  assert(Array.isArray(regressionMap.layers));
  const regressionObjects = record(regressionMap.layers[0]).objects;
  assert(Array.isArray(regressionObjects));
  const retainedProperties = record(regressionObjects[0]).properties;
  assert(Array.isArray(retainedProperties));
  assert.deepEqual(
    retainedProperties.find((p) => record(p).name === 'field-0'),
    { name: 'field-0', type: 'float', value: 1.5 },
  );
  const detachedProperties = record(regressionObjects[1]).properties;
  assert(Array.isArray(detachedProperties));
  assert.equal(detachedProperties.length, 256);
  for (let n = 0; n < 128; n++) {
    assert.deepEqual(
      detachedProperties.find((p) => record(p).name === `field-${n}`),
      { name: `field-${n}`, type: 'int', value: n },
    );
    assert.deepEqual(
      detachedProperties.find((p) => record(p).name === `extra-${n}`),
      { name: `extra-${n}`, type: 'string', value: `keep-${n}` },
    );
  }
  await choose(second);
  await choose(regression);
  await chooseValue('object-list', '2');
  await click('edit-object');
  await expect(page.locator('#object-definition')).toHaveValue('');
  assert.equal(await evaluate("document.querySelectorAll('#object-properties > div').length"), 256);
  await click('object-cancel');
  await choose(first);
  // Library version guards preserve unsaved form edits on conflict.
  await click('manage-definitions');
  await chooseValue('definition-list', definitionId);
  await chooseValue('definition-name', 'Stale rename');
  const external = (await readFile(join(root, 'forge.project.json'), 'utf8')) + '\n';
  await writeFile(join(root, 'forge.project.json'), external);
  await click('definition-save');
  await wait("document.getElementById('definition-error').textContent.includes('changed on disk')");
  await expect(page.locator('#definition-name')).toHaveValue('Stale rename');
  assert.equal(await readFile(join(root, 'forge.project.json'), 'utf8'), external);
  await page.setViewportSize({ width: 980, height: 760 });
  await wait('document.documentElement.scrollWidth <= innerWidth');
  await page.screenshot({ path: testInfo.outputPath('object-definitions-compact' + '.png') });
  await click('definition-close');
  // Native shape and artwork defaults are selectable without raw JSON.
  await click('manage-definitions');
  await chooseValue('definition-name', 'Guard');
  await chooseValue('definition-kind', 'sprite');
  await expect(page.locator('#definition-asset')).toBeEnabled();
  assert.equal(
    await evaluate("document.getElementById('definition-asset').options.length > 0"),
    true,
  );
  await chooseValue('definition-kind', 'rectangle');
  await expect(page.locator('#definition-width')).toBeEnabled();
  await click('definition-close');
  data = record(await manifest());
  const finalDefinitions = record(data.object_definitions).definitions;
  assert(Array.isArray(finalDefinitions));
  assert.equal(
    record(finalDefinitions.find((d) => record(d).id === definitionId)).name,
    'Entrance',
  );

  console.log('Object definitions browser acceptance passed');
});
