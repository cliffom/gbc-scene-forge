/** The shared host must preserve the real scene/artwork save loop and resource ownership. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  test,
  expect,
  paint,
  clickControl,
  chooseSavedScene,
  activateScene,
} from '../support/browser-fixtures.ts';
import { reviewArtwork, saveArtwork, revealArtworkControl } from '../support/artwork-controls.ts';

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [800, 640],
]) {
  test(`scene and artwork share the workbench and Inspector at ${width}×${height}`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize({ width, height });
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
p=Project.create(Path(sys.argv[1]),'Shared editor prototype')
a=p.artwork.documents
c=a.create('grass','Grass','tile',8,8,p.catalog()['revision'])
c=a.edit(c,[dict(x=x,y=y,rgba=[76,112,53,255]) for y in range(8) for x in range(8)])
a.save(c)
s=p.scenes.create('Workshop',12,10,8,p.catalog()['revision'])
s['scene']['cells'][0][0]='grass/artwork/0/0'
p.scenes.save(s['id'],s['scene'],s['revision'],p.catalog()['revision'])
print(s['id'])
`,
        root,
      ],
      { encoding: 'utf8' },
    ).trim();
    const url = await workspace.start(root);
    await page.goto(url);
    await chooseSavedScene(page, scene);
    await expect(page.locator('#status')).toHaveText('Scene opened.');
    // Keep an unrelated scene edit across source editing and saving.
    await page.locator('[data-asset="grass/artwork"]').click();
    await paint(page, 20, 20);
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    if (await page.locator('#expand-scene-tools').isVisible()) {
      await page.locator('#expand-scene-tools').click();
    }
    await page.locator('input[name=tool][value=select]').check();
    await paint(page, 4, 4);
    await clickControl(page, 'edit-placement-artwork');
    await page.locator('#art-open').click();
    await expect(page.locator('#editor-layout')).toHaveAttribute('data-document', 'artwork');
    await expect(page.locator('#editor-workbench > #artwork-surface')).toBeVisible();
    await expect(page.locator('#scene-surface')).toBeHidden();
    await expect(page.locator('#inspector-pane')).toHaveAccessibleName('Artwork inspector');
    await expect(page.locator('#inspector-pane #art-inspector-actions')).toBeVisible();
    await expect(page.locator('#scene-panel')).toBeHidden();
    await expect(page.locator('#art-canvas')).toBeFocused();
    await (await revealArtworkControl(page, 'art-color')).fill('#cc8833');
    if (await page.locator('#art-tool-overflow').isVisible()) {
      await page.keyboard.press('Escape');
    }
    const bounds = await page.locator('#art-canvas').boundingBox();
    if (!bounds) {
      throw Error('Expected artwork canvas');
    }
    await page.mouse.click(bounds.x + 24, bounds.y + 24);
    await expect(page.locator('#art-document-state')).toHaveText('Modified');
    await page.screenshot({ path: info.outputPath('artwork.png') });
    // Shared controls outside the former dialog must not trigger scene Undo.
    await page.locator('#toggle-inspector').focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('#art-document-state')).toHaveText('Modified');
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.locator('#toggle-inspector').click();
    await expect(page.locator('#inspector-pane')).toBeHidden();
    await reviewArtwork(page);
    await expect(page.locator('#inspector-pane')).toBeVisible();
    await expect(page.locator('#inspector-pane #art-review-panel')).toBeVisible();
    const geometry = await page.locator('#art-viewport').boundingBox();
    expect(geometry?.height).toBeGreaterThanOrEqual(150);
    const save = await page.locator('#save').boundingBox();
    if (!save) {
      throw Error('Expected Save action');
    }
    expect(save.y + save.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: info.outputPath('review.png') });
    await saveArtwork(page);
    await activateScene(page);
    await expect(page.locator('#editor-workbench > #scene-surface')).toBeVisible();
    await expect(page.locator('#inspector-pane')).toHaveAccessibleName('Scene inspector');
    await expect(page.locator('#scene-panel')).toBeVisible();
    await expect(page.locator('#art-inspector-content')).toBeHidden();
    await expect(page.locator('#scene')).toBeFocused();
    await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
    await page.screenshot({ path: info.outputPath('scene.png') });
    if (
      (await page.locator('#expand-scene-tools').isVisible()) &&
      (await page.locator('#expand-scene-tools').getAttribute('aria-expanded')) !== 'true'
    ) {
      await page.locator('#expand-scene-tools').click();
    }
    await page.locator('#undo').click();
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    await page.locator('#redo').click();
    await clickControl(page, 'save');
    await expect(page.locator('#scene-save-state')).toHaveText('Saved');
    // Check persisted artwork rather than just the displayed Saved badge.
    // The domain service provides the exact saved RGBA independently of the UI.
    expect(
      execFileSync(
        workspace.python,
        [
          '-I',
          '-c',
          `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
item=p.artwork.documents.list(p.catalog()['revision'])['documents'][0]
c=p.artwork.documents.open(item['target'],p.catalog()['revision'],item['artwork_revision'])
import base64
rgba=base64.b64decode(c['rgba'])
print(list(rgba[(1*8+1)*4:(1*8+1)*4+4]))
`,
          root,
        ],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe('[204, 136, 51, 255]');
  });
}

test('artwork without a scene and repeated remounts retain a single shared host', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    "import sys;from pathlib import Path;from gbc_scene_forge.project.application import Project;Project.create(Path(sys.argv[1]),'No scene')",
    root,
  ]);
  await page.goto(await workspace.start(root));
  await expect(page.locator('#show-artwork')).toBeEnabled();
  await page.locator('#show-artwork').click();
  await page.locator('#art-create').click();
  await expect(page.locator('#editor-workbench > #artwork-surface')).toBeVisible();
  await expect(page.locator('#art-canvas')).toBeFocused();
  await page.evaluate(`(async () => {
    const module = await import('/project.js');
    module.editor.dispose();
    for (let i = 0; i < 2; i++) {
      const mounted = module.mountProjectEditor();
      mounted.dispose();
    }
    module.mountProjectEditor();
  })()`);
  await expect(page.locator('#show-artwork')).toBeEnabled();
  await page.locator('#show-artwork').click();
  await page.locator('#art-create').click();
  await expect(page.locator('#editor-workbench > #artwork-surface')).toHaveCount(1);
  await expect(page.locator('#inspector-pane #art-inspector-actions')).toHaveCount(1);
  await expect(page.locator('#art-canvas')).toBeFocused();
  await activateScene(page);
  await expect(page.locator('#scene-surface')).toBeVisible();
  await expect(page.locator('#viewport')).toBeFocused();
});
