/** Real ZIP transfer: selected scenes, naming, invalidation, recovery and portability. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeProject } from '../../../frontend/project/project-contracts.mts';
import { record } from '../../../frontend/shared/decode.mts';
import { expect, test, clickControl, chooseSavedScene } from '../support/browser-fixtures.ts';

test('Forge ZIP preflight, rename/skip, dirty protection, reopen and re-export', async ({
  page,
  workspace,
}, testInfo) => {
  const root = join(workspace.folder, 'destination');
  const projectZip = join(workspace.folder, 'project.zip');
  const sceneZip = join(workspace.folder, 'scene.zip');
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
sys.path.insert(0, 'tests')
from backend.project.test_exporting import ExportTests
from gbc_scene_forge.project.application import Project
f = ExportTests(); f.setUp()
try:
    document, revision = f.project.read()
    document['scenes'][1]['name'] = 'Room'
    f.project.store.commit(document, revision, {}, {}, 'Duplicate name fixture')
    Path(sys.argv[2]).write_bytes(f.export('project')[0])
    Path(sys.argv[3]).write_bytes(f.export('scene')[0])
    p = Project.create(Path(sys.argv[1]), 'Transfer destination')
    p.scenes.create('Room', 2, 2, 8, p.catalog()['revision'])
finally:
    f.doCleanups()
`,
    root,
    projectZip,
    sceneZip,
  ]);
  const url = await workspace.start(root);
  await page.goto(url);
  await expect(page.locator('#status')).toContainText('Choose a scene');
  const project = async () =>
    decodeProject(
      record(await (await page.request.get(new URL('api/project', url).href)).json()).project,
    );
  const original = await project();
  const originalId = original.scenes[0].id;
  await chooseSavedScene(page, originalId);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  const originalScene: unknown = await (
    await page.request.get(new URL(`api/scene/${originalId}`, url).href)
  ).json();
  await clickControl(page, 'library-import');
  await page.locator('#import-kind').selectOption('forge');
  await page.locator('#forge-zip').setInputFiles({
    name: 'invalid.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('invalid ZIP'),
  });
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-report')).toContainText('Invalid Forge ZIP');
  await expect(page.locator('#forge-apply')).toBeDisabled();
  await page.locator('#forge-zip').setInputFiles(projectZip);
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-scenes fieldset')).toHaveCount(2);
  await expect(page.locator('#forge-apply')).toBeDisabled();
  await expect(page.locator('#forge-report')).toContainText('Existing scene: Room');
  await expect(page.locator('#forge-report')).toContainText('Duplicate incoming name');
  const fields = page.locator('#forge-scenes fieldset');
  await fields.nth(0).locator('input[type=text]').fill('Transferred room');
  await fields.nth(1).locator('input[type=checkbox]').uncheck();
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-apply')).toBeEnabled();
  await expect(fields.nth(0)).toContainText('Selected · ready');
  await expect(fields.nth(1)).toContainText('Skipped');
  await expect(page.locator('#forge-report')).toContainText('Copy artwork: terrain');
  await page.screenshot({ path: testInfo.outputPath('forge-transfer-preflight.png') });
  await page.setViewportSize({ width: 760, height: 640 });
  await page.locator('#forge-apply').scrollIntoViewIfNeeded();
  await expect(page.locator('#forge-apply')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('forge-transfer-compact.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fields.nth(0).locator('input[type=text]').fill('Final room');
  await expect(page.locator('#forge-apply')).toBeDisabled();
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-apply')).toBeEnabled();
  // A concurrent project edit makes this confirmation stale and leaves the import unapplied.
  execFileSync(workspace.python, [
    '-c',
    `
import sys
from gbc_scene_forge.project.application import Project
p = Project(sys.argv[1])
p.scenes.create('Concurrent scene', 2, 2, 8, p.catalog()['revision'])
`,
    root,
  ]);
  await page.locator('#forge-apply').click();
  await expect(page.locator('#import-form .form-error')).toContainText('Project changed');
  expect((await project()).scenes).toHaveLength(2);
  await page.locator('#import-atlas-dialog [data-close]').click();
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await clickControl(page, 'library-import');
  await page.locator('#import-kind').selectOption('forge');
  await page.locator('#forge-zip').setInputFiles(projectZip);
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-scenes fieldset')).toHaveCount(2);
  await fields.nth(0).locator('input[type=text]').fill('Final room');
  await fields.nth(1).locator('input[type=checkbox]').uncheck();
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-apply')).toBeEnabled();
  await page.locator('#forge-apply').click();
  await expect(page.locator('#import-atlas-dialog')).not.toBeVisible();
  await expect(page.locator('#status')).toContainText('Imported selected Forge scenes');
  let after = await project();
  expect(after.scenes.map((s: { name: string }) => s.name)).toEqual([
    'Room',
    'Concurrent scene',
    'Final room',
  ]);
  expect(
    await (await page.request.get(new URL(`api/scene/${originalId}`, url).href)).json(),
  ).toEqual(originalScene);
  const copiedId = after.scenes[2].id;
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await chooseSavedScene(page, copiedId);
  await expect(page.locator('#scenes')).toHaveValue(copiedId);
  // An actual canvas edit survives cancelling the import's unsaved-work prompt.
  await page.locator('#palette button[data-kind=tile]').first().click();
  await page.locator('#scene').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  await clickControl(page, 'library-import');
  await page.locator('#import-kind').selectOption('forge');
  await page.locator('#forge-zip').setInputFiles(sceneZip);
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-scenes fieldset')).toHaveCount(1);
  await page.locator('#forge-scenes input[type=text]').fill('Scene-only copy');
  await page.locator('#forge-check').click();
  await expect(page.locator('#forge-apply')).toBeEnabled();
  await page.locator('#forge-apply').click();
  await expect(page.locator('#discard-dialog')).toBeVisible();
  await page.locator('#discard-dialog button[value=cancel]').click();
  await expect(page.locator('#dirty')).toHaveText('UNSAVED');
  after = await project();
  expect(after.scenes).toHaveLength(3);
  await page.locator('#forge-apply').click();
  await page.locator('#discard-dialog button[value=discard]').click();
  await expect(page.locator('#status')).toContainText('Imported selected Forge scenes');
  await clickControl(page, 'show-export');
  await page.locator('#export-scope').selectOption('project');
  const download = page.waitForEvent('download');
  await page.locator('#export-confirm').click();
  expect((await download).suggestedFilename()).toMatch(/^forge-project-.*\.zip$/);
});
