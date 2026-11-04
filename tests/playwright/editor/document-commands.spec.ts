/** Shared commands must act exactly once on the current document, including outside its surface. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  chooseSavedScene,
  activateScene,
  paint,
} from '../support/browser-fixtures.ts';
import { reviewArtwork, saveArtwork } from '../support/artwork-controls.ts';

async function pixel(page: Page, x: number, y: number) {
  const box = await page.locator('#art-canvas').boundingBox();
  if (!box) {
    throw Error('Expected artwork canvas');
  }
  const zoom = Number(await page.locator('#art-zoom').inputValue());
  await page.mouse.click(box.x + (x + 0.5) * zoom, box.y + (y + 0.5) * zoom);
}
async function snapshot(page: Page, id = 'art-canvas') {
  await page.mouse.move(10, 10);
  return page.locator('#' + id).evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) {
      throw Error('Expected canvas');
    }
    if (node.id === 'scene') {
      return node.toDataURL();
    }
    const context = node.getContext('2d');
    if (!context) {
      throw Error('Expected canvas context');
    }
    const zoom = node.width / 8;
    const pixels: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        pixels.push(...context.getImageData((x + 0.5) * zoom, (y + 0.5) * zoom, 1, 1).data);
      }
    }
    return JSON.stringify(pixels);
  });
}
async function setup(
  page: Page,
  workspace: { folder: string; python: string; start: (root: string) => Promise<string> },
) {
  const root = join(workspace.folder, 'project');
  const scene = execFileSync(
    workspace.python,
    [
      '-I',
      '-c',
      `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Shared commands')
a=p.artwork.documents
c=a.create('grass','Grass','tile',8,8,p.catalog()['revision'])
c=a.edit(c,[dict(x=x,y=y,rgba=[76,112,53,255]) for y in range(8) for x in range(8)])
a.save(c)
s=p.scenes.create('Workshop',24,20,8,p.catalog()['revision'])
s['scene']['cells'][0][0]='grass/artwork/0/0'
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  await page.goto(await workspace.start(root));
  await chooseSavedScene(page, scene);
  await page.locator('[data-asset="grass/artwork"]').click();
  await paint(page, 20, 20);
  const before = await snapshot(page, 'scene');
  await page.locator('#edit-placement-artwork').click();
  await page.locator('#art-open').click();
  await expect(page.locator('#art-canvas')).toBeFocused();
  return before;
}
async function returnToArtwork(page: Page) {
  await page.locator('#document-switcher').click();
  await page.locator('#artwork-documents button').filter({ hasText: 'Grass' }).click();
}

test('shared pointer and keyboard history target only the active document after repeated switches', async ({
  page,
  workspace,
}) => {
  const scene = await setup(page, workspace);
  const original = await snapshot(page);
  await page.locator('#art-color').fill('#cc8833');
  await pixel(page, 1, 1);
  const first = await snapshot(page);
  await pixel(page, 2, 2);
  const second = await snapshot(page);
  expect(first).not.toBe(second);
  for (let i = 0; i < 3; i++) {
    await activateScene(page);
    expect(await snapshot(page, 'scene')).toBe(scene);
    await returnToArtwork(page);
  }
  await expect(page.locator('#duplicate-selection')).toBeDisabled();
  await page.locator('#toggle-inspector').focus();
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(first);
  await page.locator('#undo').click();
  expect(await snapshot(page)).toBe(original);
  await page.keyboard.press('Control+Shift+z');
  expect(await snapshot(page)).toBe(first);
  await page.locator('#redo').click();
  expect(await snapshot(page)).toBe(second);
  await activateScene(page);
  expect(await snapshot(page, 'scene')).toBe(scene);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#undo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await returnToArtwork(page);
  expect(await snapshot(page)).toBe(second);
});

test('clipboard, form focus and modal focus preserve command ownership and exact pixels', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.locator('#art-color').fill('#cc8833');
  await pixel(page, 1, 1);
  const painted = await snapshot(page);
  await page.locator('#copy-selection').click();
  await page.locator('#cut-selection').click();
  const cleared = await snapshot(page);
  expect(cleared).not.toBe(painted);
  await page.keyboard.press('Control+v');
  expect(await snapshot(page)).toBe(painted);
  await page.locator('#art-alpha').focus();
  // Native input shortcuts must not change model history or open Save review.
  for (const key of ['Control+z', 'Control+x', 'Control+v', 'Control+s']) {
    await page.keyboard.press(key);
  }
  expect(await snapshot(page)).toBe(painted);
  await expect(page.locator('#art-comparison')).toBeHidden();
  await page.locator('#document-switcher').click();
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(painted);
  await page.keyboard.press('Escape');
  await page.locator('#undo').click();
  expect(await snapshot(page)).toBe(cleared);
  await page.locator('#redo').click();
  expect(await snapshot(page)).toBe(painted);
});

test('one Save location reviews artwork, invalidates edited receipts and retains saved history', async ({
  page,
  workspace,
}, info) => {
  const scene = await setup(page, workspace);
  await page.locator('#art-color').fill('#cc8833');
  await pixel(page, 1, 1);
  const first = await snapshot(page);
  await page.locator('#toggle-inspector').focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#art-comparison')).toBeVisible();
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await expect(page.locator('#art-references')).toContainText('Saving a shared edit updates all');
  await pixel(page, 2, 2);
  const second = await snapshot(page);
  await expect(page.locator('#art-comparison')).toBeHidden();
  await expect(page.locator('#save')).toHaveText('Save artwork…');
  await reviewArtwork(page);
  await page.screenshot({ path: info.outputPath('artwork-review.png') });
  await saveArtwork(page);
  expect(await snapshot(page)).toBe(second);
  await page.locator('#undo').click();
  expect(await snapshot(page)).toBe(first);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await page.locator('#redo').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await activateScene(page);
  // Pixel changes in the source are rendered in both placed copies; scene history stays local.
  expect(await snapshot(page, 'scene')).not.toBe(scene);
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#save')).toHaveText('Save scene');
  await page.locator('#save').click();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.screenshot({ path: info.outputPath('scene-saved.png') });
});

test('remounting installs one command route and preserves native form shortcuts in scene review', async ({
  page,
  workspace,
}) => {
  await setup(page, workspace);
  await page.evaluate(`(async () => {
    const module = await import('/project.js');
    module.editor.dispose();
    for (let i=0;i<2;i++) { const mounted=module.mountProjectEditor(); mounted.dispose(); }
    module.mountProjectEditor();
  })()`);
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await page.locator('#art-source').selectOption({ label: 'grass / artwork (editable)' });
  await page.locator('#art-open').click();
  await page.locator('#art-color').fill('#cc8833');
  await pixel(page, 1, 1);
  const first = await snapshot(page);
  await pixel(page, 2, 2);
  await page.locator('#toggle-inspector').focus();
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toBe(first);
  let reviews = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/artwork-review')) {
      reviews++;
    }
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save')).toHaveText('Confirm save');
  expect(reviews).toBe(1);
  await activateScene(page);
  await page.locator('#review-mode').click();
  await page.locator('#zoom').focus();
  const prevented = await page.locator('#zoom').evaluate((node) => {
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.locator('#review-mode').click();
});
