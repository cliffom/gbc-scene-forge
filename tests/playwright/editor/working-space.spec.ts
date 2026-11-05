/** Milestone 24 P2: shared workspace tasks and exact native PNG downloads. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, chooseSavedScene, activateScene } from '../support/browser-fixtures.ts';
import { revealArtworkControl } from '../support/artwork-controls.ts';
import { record, string, number, array } from '../../../frontend/shared/decode.mts';
import type { Page } from '@playwright/test';

const seed = `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.from_sample(Path(sys.argv[1]),title='Working space')
a=p.artwork.documents
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
c=a.create_sheet('player','Player poses','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=[])
c=a.edit(c,[dict(x=0,y=0,rgba=[17,34,51,255])])
base=layers.item('Base'); top=layers.item('Overlay')
c=layers.edit(c,[base,top]); a.save(c)
a.save(a.create('other','Other artwork','sprite',16,16,p.catalog()['revision']))
`;
async function work(page: Page) {
  const button = await revealArtworkControl(page, 'art-download');
  const waiting = page.waitForEvent('download');
  await button.click();
  const path = await (await waiting).path();
  if (!path) {
    throw Error('Expected downloaded work');
  }
  const result = record(JSON.parse(await readFile(path, 'utf8')));
  await page.locator('.art-document-actions > summary').click();
  return result;
}
async function png(page: Page, scope: string) {
  await page.locator('#art-png-menu').click();
  await page.locator('#art-png-scope').selectOption(scope);
  const waiting = page.waitForEvent('download');
  await page.locator('#art-download-png').focus();
  await page.keyboard.press('Enter');
  const download = await waiting;
  const path = await download.path();
  if (!path) {
    throw Error('Expected PNG download');
  }
  return { path, name: download.suggestedFilename() };
}
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 800, height: 640 },
]) {
  test(`drawing, timing, shortcuts and PNG at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    const root = join(workspace.folder, 'project');
    execFileSync(workspace.python, ['-I', '-c', seed, root]);
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(root));
    await page.locator('[data-asset="player/f1"]').click();
    await expect(page.locator('#art-dock')).not.toHaveAttribute('open');
    await expect(page.locator('#art-drawing-scope')).toBeInViewport();
    const heights: Record<string, number> = {};
    const measure = async (state: string) => {
      const bounds = await page.locator('.art-canvas-scroll').boundingBox();
      if (!bounds) {
        throw Error('Expected drawing viewport');
      }
      heights[state] = bounds.height;
      await page.screenshot({ path: info.outputPath(`${state}.png`) });
    };
    await measure('drawing');
    await page.locator('#art-show-animation').click();
    await expect(page.locator('#art-sequence')).toBeFocused();
    await measure('animation');
    await page.locator('#art-dock > summary').click();
    await (await revealArtworkControl(page, 'art-layer')).selectOption({ label: 'Overlay' });
    await page.locator('#art-layers-toggle').click();
    await page.locator('#art-color').fill('#cc7744');
    await page.locator('#art-alpha').fill('127');
    await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
    await page.keyboard.press('e');
    await expect(page.locator('input[name="art-tool"][value="erase"]')).toBeChecked();
    await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
    await page.locator('#undo').click();
    await page.keyboard.press('p');
    await page.keyboard.press('h');
    await expect(page.locator('#art-pan')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('p');
    await expect(page.locator('#art-pan')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#art-draft-status')).toHaveText(
      'Unsaved artwork checkpointed in this project.',
    );
    const before = await work(page);
    const sheet = await png(page, 'sheet');
    const frame = await png(page, 'frame');
    expect(sheet.name).toBe('player-sheet.png');
    expect(frame.name).toBe('player-f1.png');
    // Decode using Python's standard-library zlib, checking native RGBA including alpha.
    const decode = `
import sys,struct,zlib,json
b=open(sys.argv[1],'rb').read();assert b[:8]==b'\\x89PNG\\r\\n\\x1a\\n'
p=8;data=b''
while p<len(b):
 n=struct.unpack('>I',b[p:p+4])[0];t=b[p+4:p+8];d=b[p+8:p+8+n]
 assert zlib.crc32(t+d)==struct.unpack('>I',b[p+8+n:p+12+n])[0]
 if t==b'IHDR':w,h,depth,color,*_=struct.unpack('>IIBBBBB',d);assert (depth,color)==(8,6)
 if t==b'IDAT':data+=d
 p+=n+12
raw=zlib.decompress(data);rgba=b''.join(raw[y*(w*4+1)+1:(y+1)*(w*4+1)] for y in range(h))
print(json.dumps(dict(width=w,height=h,rgba=list(rgba))))
`;
    const decoded = (path: string) => {
      const value = record(
        JSON.parse(
          execFileSync(workspace.python, ['-I', '-c', decode, path], { encoding: 'utf8' }),
        ),
      );
      return {
        width: number(value.width),
        height: number(value.height),
        rgba: array(value.rgba, number),
      };
    };
    const all = decoded(sheet.path),
      one = decoded(frame.path);
    expect([all.width, all.height, one.width, one.height]).toEqual([32, 16, 16, 16]);
    const expected = Buffer.from(string(before.current_rgba), 'base64');
    expect(Buffer.from(all.rgba)).toEqual(expected);
    expect(one.rgba.slice((16 + 1) * 4, (16 + 1) * 4 + 4)).toEqual([204, 119, 68, 127]);
    expect(one.rgba.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(await work(page)).toEqual(before);
    await expect(page.locator('#document-state')).toHaveText('Modified');
    await page.locator('#undo').click();
    await expect(page.locator('#document-state')).toHaveText('Saved');
    await page.locator('#redo').click();
    const afterRedo = await work(page);
    expect(afterRedo.current_rgba).toEqual(before.current_rgba);
    expect(afterRedo.current_descriptor).toEqual(before.current_descriptor);
    expect(afterRedo.layer_rgba).toEqual(before.layer_rgba);
    await page.locator('#toggle-library').click();
    await page.locator('#toggle-inspector').click();
    await chooseSavedScene(page, { label: 'Riverside' });
    await expect(page.locator('input[name="tool"][value="erase"]')).toBeEnabled();
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('#scene').focus();
    await page.keyboard.press('e');
    await expect(page.locator('input[name="tool"][value="erase"]')).toBeChecked();
    await expect(page.locator('.notifications')).not.toBeVisible();
    await page.locator('#document-switcher').click();
    await page.locator('#artwork-documents button').filter({ hasText: 'Player poses' }).click();
    await expect(page.locator('#library-pane')).toBeHidden();
    await expect(page.locator('#inspector-pane')).toBeHidden();
    await expect(page.locator('#art-dock')).not.toHaveAttribute('open');
    await page.locator('#keyboard-help').click();
    await expect(page.locator('#keyboard-help-dialog')).toContainText('E: Erase');
    await page.keyboard.press('Escape');
    await page.locator('#toggle-inspector').click();
    await page.locator('#save').click();
    await expect(page.locator('#art-comparison')).toBeVisible();
    await measure('review');
    const reviewed = await work(page);
    await png(page, 'frame');
    await expect(page.locator('#save')).toHaveText('Confirm save');
    expect(await work(page)).toEqual(reviewed);
    await writeFile(
      info.outputPath('viewport-heights.json'),
      JSON.stringify({ viewport, heights }, null, 2),
    );
    await activateScene(page);
  });
}

for (const goal of ['artwork', 'import', 'blockout']) {
  test(`new project starts with ${goal} at compact width`, async ({ page, forge }, info) => {
    await page.setViewportSize({ width: 800, height: 640 });
    await page.goto(forge.url);
    await page.locator('#project-title').fill(`Goal ${goal}`);
    await page.locator('#project-starter').selectOption(goal);
    await page.locator('#project-form button.primary').click();
    if (goal === 'artwork') {
      await expect(page.locator('#art-name')).toBeVisible();
      await expect(page.locator('#art-size-guidance')).toContainText('Single tiles');
      await page.locator('#art-name').fill('Tile created by keyboard');
      await page.keyboard.press('e');
      await expect(page.locator('#art-name')).toHaveValue('Tile created by keyboarde');
      await page.locator('#art-kind').selectOption('sprite');
      await expect(page.locator('#art-size-guidance')).toContainText('Sprites / illustrations');
      await page.locator('#art-width').fill('24');
      await page.locator('#art-height').fill('12');
      await page.locator('#art-create').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#art-canvas')).toBeVisible();
      await expect(page.locator('#art-png-scope option[value=frame]')).toHaveAttribute('disabled');
      await page.locator('#keyboard-help').click();
      await page.keyboard.press('e');
      await expect(page.locator('input[name=art-tool][value=pencil]')).toBeChecked();
      await page.keyboard.press('Escape');
    } else if (goal === 'blockout') {
      await expect(page.locator('#create-blockout-dialog')).toBeVisible();
      await expect(page.locator('#create-blockout-dialog button.primary')).toBeInViewport();
    } else {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('Import');
    }
    await expect(page.locator('.notifications')).not.toBeVisible();
    await expect(page.locator('.routine-notifications .notification')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('starting-goal.png') });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`selected-object editing precedes secondary operations at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    const root = join(workspace.folder, 'project');
    execFileSync(workspace.python, [
      '-I',
      '-c',
      seed +
        `
scene=next(item for item in p.catalog()['project']['scenes'] if item['name']=='Riverside')
loaded=p.scenes.load(scene['id'])
for layer in loaded['scene']['layers']:
 for obj in layer.get('objects',[]):
  if obj.get('asset'):obj['name']='Explorer '+('long named placement '*4)
p.scenes.save(loaded['id'],loaded['scene'],loaded['revision'],p.catalog()['revision'])
`,
      root,
    ]);
    await page.setViewportSize(viewport);
    await page.goto(await workspace.start(root));
    await chooseSavedScene(page, { label: 'Riverside' });
    await expect(page.locator('#scene')).toBeVisible();
    await page.locator('.layer-choice').filter({ hasText: 'Objects' }).click();
    const objects = page.locator('#object-list');
    await objects.selectOption({ index: 0 });
    await expect(page.locator('#selection-name')).toContainText('long named placement');
    await expect(page.locator('#animation-preview')).toBeVisible();
    await expect(page.locator('#convert-sprites')).not.toBeVisible();
    await expect(page.locator('#edit-placement-artwork')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('selection.png') });
    await page.locator('#preview-animation').selectOption('walk');
    await expect(page.locator('#preview-play')).toBeEnabled();
    await page.locator('#preview-play').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#preview-play')).toHaveText('Pause');
    await expect(page.locator('#document-state')).toHaveText('Saved');
    await page.keyboard.press('Enter');
    await expect(page.locator('#preview-play')).toHaveText('Play');
    await page.locator('#selection-secondary > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#convert-sprites')).toBeVisible();
    const preview = await page.locator('#animation-preview').boundingBox();
    const secondary = await page.locator('#selection-secondary').boundingBox();
    expect(preview && secondary && preview.y < secondary.y).toBeTruthy();
    await page.screenshot({ path: info.outputPath('selection-secondary.png') });
    await objects.selectOption({ index: 1 });
    await expect(page.locator('#edit-object')).toBeEnabled();
    await expect(page.locator('#animation-preview')).not.toBeVisible();
    await expect(page.locator('#document-state')).toHaveText('Saved');
  });
}
