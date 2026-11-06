/** Inactive appearance must agree with real document capabilities and native hover. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, chooseSavedScene, paint } from '../support/browser-fixtures.ts';
import { saveArtwork } from '../support/artwork-controls.ts';

async function appearance(button: Locator) {
  return button.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      opacity: style.opacity,
      background: style.backgroundColor,
      border: style.borderTopColor,
      color: style.color,
      cursor: style.cursor,
    };
  });
}

async function inactive(page: Page, id: string) {
  const button = page.locator('#' + id);
  await expect(button).toBeDisabled();
  await page.mouse.move(0, 0);
  const before = await appearance(button);
  expect(before.opacity).toBe('0.4');
  expect(before.cursor).toBe('default');
  await button.hover();
  expect(await appearance(button)).toEqual(before);
  await page.mouse.move(0, 0);
  return before;
}

async function createProject(
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
p=Project.create(Path(sys.argv[1]),'Button states')
a=p.artwork.documents
c=a.create('grass','Grass','tile',8,8,p.catalog()['revision'])
c=a.edit(c,[dict(x=x,y=y,rgba=[76,112,53,255]) for y in range(8) for x in range(8)])
a.save(c)
s=p.scenes.create('Workshop',24,20,8,p.catalog()['revision'])
print(s['id'])
`,
      root,
    ],
    { encoding: 'utf8' },
  ).trim();
  await page.goto(await workspace.start(root));
  await expect(page.locator('#project-folder')).toBeEnabled();
  await expect(page.locator('#empty-scene')).toBeVisible();
  return scene;
}

async function holdRequest(
  page: Page,
  path: string,
  action: () => Promise<void>,
  check: () => Promise<void>,
) {
  let release = () => {};
  let arrived = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const pattern = '**/api/' + path;
  await page.route(pattern, async (route) => {
    arrived();
    await pending;
    await route.continue();
  });
  try {
    await action();
    await requested;
    await check();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
}

for (const [width, height] of [
  [1440, 900],
  [800, 640],
]) {
  test(`empty document buttons share inactive styling at ${width}×${height}`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize({ width, height });
    await createProject(page, workspace);
    const save = await inactive(page, 'save');
    expect(await inactive(page, 'close-document')).toEqual(save);
    for (const id of ['undo', 'redo', 'fit-scene']) {
      await inactive(page, id);
    }
    await page.screenshot({ path: info.outputPath(`empty-${width}.png`) });
  });
}

test('native text, primary, destructive and folder variants suppress disabled hover only', async ({
  page,
  workspace,
}) => {
  await createProject(page, workspace);
  // Native probes isolate the production cascade from individual dialog busy gates.
  await page.evaluate(() => {
    const probes = document.createElement('div');
    probes.style.cssText = 'position:fixed;left:20px;top:220px;z-index:1000;display:flex;gap:10px';
    for (const [index, variant] of [
      '',
      'primary',
      'danger',
      'destructive-command',
      'folder-button',
      'icon-button',
    ].entries()) {
      const button = document.createElement('button');
      button.id = `button-probe-${index}`;
      button.className = variant;
      button.textContent = variant || 'Text';
      button.disabled = true;
      probes.append(button);
    }
    document.body.append(probes);
  });
  for (let index = 0; index < 6; index++) {
    const id = `button-probe-${index}`;
    const disabled = await inactive(page, id);
    const button = page.locator('#' + id);
    await button.evaluate((node) => {
      if (node instanceof HTMLButtonElement) {
        node.disabled = false;
      }
    });
    await expect(button).toBeEnabled();
    const enabled = await appearance(button);
    expect(enabled.opacity).toBe('1');
    expect(enabled.cursor).toBe('pointer');
    await button.hover();
    const hovered = await appearance(button);
    expect(hovered).not.toEqual(enabled);
    expect(hovered.background).not.toBe(disabled.background);
    await page.mouse.move(0, 0);
  }
});

test('saved, modified and busy Scene and Artwork buttons follow their active capabilities', async ({
  page,
  workspace,
}, info) => {
  const scene = await createProject(page, workspace);
  await chooseSavedScene(page, scene);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await inactive(page, 'save');
  await expect(page.locator('#close-document')).toBeEnabled();
  await page.locator('[data-asset="grass/artwork"]').click();
  await paint(page, 20, 20);
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save')).toHaveClass('primary');
  await expect(page.locator('#save')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('scene-modified.png') });
  await holdRequest(
    page,
    'save-scene',
    () => page.locator('#save').click(),
    async () => {
      expect(await inactive(page, 'save')).toEqual(await inactive(page, 'close-document'));
    },
  );
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await inactive(page, 'save');
  await expect(page.locator('#close-document')).toBeEnabled();

  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await page.locator('#art-source').selectOption({ label: 'grass / artwork (editable)' });
  await page.locator('#art-open').click();
  await expect(page.locator('#art-canvas')).toBeFocused();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  // Artwork retains its existing review entry even when its pixels are saved.
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save')).toHaveText('Save artwork…');
  await expect(page.locator('#close-document')).toBeEnabled();
  await page.locator('#art-color').fill('#cc7744');
  await page.locator('#art-canvas').click({ position: { x: 24, y: 24 } });
  await expect(page.locator('#document-state')).toHaveText('Modified');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save')).toHaveClass('primary');
  await page.screenshot({ path: info.outputPath('artwork-modified.png') });
  await holdRequest(
    page,
    'artwork-review',
    () => page.locator('#save').click(),
    async () => {
      expect(await inactive(page, 'save')).toEqual(await inactive(page, 'close-document'));
    },
  );
  await expect(page.locator('#art-message')).toContainText('Review ready.');
  await expect(page.locator('#save')).toHaveText('Confirm save');
  await holdRequest(
    page,
    'artwork-save',
    () => page.locator('#save').click(),
    async () => {
      await inactive(page, 'save');
      await inactive(page, 'close-document');
    },
  );
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#close-document')).toBeEnabled();
  // Preserve the ordinary review/commit route after saving and returning to clean state.
  await page.locator('#undo').click();
  await saveArtwork(page);
  await expect(page.locator('#save')).toBeEnabled();
});
