/** Managed browser restart retains the origin and offers the browser's real checkpoint. */
import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { record, string } from '../../../frontend/shared/decode.mts';
import { scenePoint } from '../support/browser-fixtures.ts';

const driver = `
import json, sys
from pathlib import Path
from gbc_scene_forge.adapters.plugin.selection import Selection
from gbc_scene_forge.adapters.plugin.session import PluginSession
from gbc_scene_forge.project.application import Project
base, action = Path(sys.argv[1]).resolve(), sys.argv[2]
selection = Selection(base / 'bundle', settings=base / 'settings', cache=base / 'cache')
if action == 'create':
    (base / 'bundle').mkdir()
    project = Project.from_sample(base / 'projects/design', title='Managed draft recovery')
    selection.save(selection.prepare(base / 'projects', 'root'))
session = PluginSession(selection)
arguments = {'project': 'design', 'action': 'stop' if action == 'stop' else 'open'}
if action == 'stop':
    arguments['instance'] = sys.argv[3]
result = session.call('plugin_browser', arguments)
if action == 'create':
    result['scene_id'] = project.catalog()['project']['scenes'][0]['id']
print(json.dumps(result))
`;

test('managed handoff recovers an unsaved scene after tab and server restart', async ({
  page,
  context,
}, testInfo) => {
  const scratch = await mkdtemp(join(tmpdir(), 'forge-managed-browser-'));
  const python = process.env.FORGE_TEST_PYTHON || '.venv/bin/python';
  const call = async (action: string, instance = '') => {
    const { stdout } = await promisify(execFile)(python, ['-c', driver, scratch, action, instance]);
    return record(JSON.parse(stdout));
  };
  let instance = '';
  try {
    const opened = await call('create');
    instance = string(opened.instance);
    const origin = string(opened.url);
    const sceneId = string(opened.scene_id);
    const sceneFile = join(scratch, 'projects/design/scenes', `${sceneId}.tmj`);
    const saved = await readFile(sceneFile, 'utf8');
    await page.goto(`${origin}scenes/${sceneId}`);
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('#artwork-tab').click();
    await page.locator('#palette button.asset').first().click();
    const point = await scenePoint(page, 4, 4);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#draft-status')).toHaveText('Draft checkpoint saved');
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    await page.close();
    await call('stop', instance);
    instance = '';
    const reopened = await call('open');
    instance = string(reopened.instance);
    expect(reopened.url).toBe(origin);
    page = await context.newPage();
    await page.goto(`${origin}scenes/${sceneId}`);
    await expect(page.locator('#recovery-dialog')).toBeVisible();
    await page.locator('#recovery-restore').click();
    await expect(page.locator('#dirty')).toHaveText('UNSAVED');
    expect(await readFile(sceneFile, 'utf8')).toBe(saved);
    await page.screenshot({ path: testInfo.outputPath('managed-draft-recovery.png') });
  } finally {
    if (instance) {
      await call('stop', instance);
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
