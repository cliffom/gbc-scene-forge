/** Download discovery, native keyboard choices, overflow and unchanged editor work. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/browser-fixtures.ts';
import { revealArtworkControl } from '../support/artwork-controls.ts';

async function setup(
  page: Page,
  workspace: { folder: string; python: string; start: (root: string) => Promise<string> },
) {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Download artwork')
a=p.artwork.documents
frames=[dict(id=f'f{i}',name=f'Pose {i}',kind='sprite',x=i*16,y=0,width=16,height=16,origin=[4,8]) for i in range(2)]
c=a.create_sheet('player','Player poses','sprite',32,16,p.catalog()['revision'],frames=frames,sequences=[])
c=a.edit(c,[dict(x=2,y=2,rgba=[72,145,200,127])]);a.save(c)
a.save(a.create('image','Single artwork','sprite',24,12,p.catalog()['revision']))
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="player/f0"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 760, height: 640 },
]) {
  test(`download icon and options preserve artwork at ${viewport.width}`, async ({
    page,
    workspace,
  }, info) => {
    await page.setViewportSize(viewport);
    await setup(page, workspace);
    let downloads = 0;
    page.on('download', () => downloads++);
    const trigger = await revealArtworkControl(page, 'art-png-menu');
    await expect(trigger).toHaveAccessibleName('Download artwork');
    await expect(trigger).toHaveText('');
    await expect(trigger.locator('use')).toHaveAttribute('href', '#icon-download');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Download artwork', exact: true });
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#art-png-sheet')).toBeFocused();
    await expect(page.locator('#art-png-output')).toHaveText('PNG · 32 × 16 px · RGBA');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#art-png-frame')).toBeChecked();
    await expect(page.locator('#art-png-frame')).toBeFocused();
    await expect(page.locator('#art-png-frame-detail')).toHaveText('Pose 0 · 16 × 16 px');
    await expect(page.locator('#art-png-filename')).toHaveText('player-f0.png');
    await expect(page.locator('#art-png-output')).toHaveText('PNG · 16 × 16 px · RGBA');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(page.locator('#art-png-frame')).toBeFocused();
    // Native radio keys keep the drawing tool unchanged while the panel has focus.
    await page.keyboard.press('p');
    await expect(page.locator('input[name=art-tool][value=pencil]')).toBeChecked();
    await expect(page.locator('#art-png-frame')).toBeChecked();
    const bounds = await panel.boundingBox();
    if (!bounds) {
      throw Error('Expected download overlay bounds');
    }
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.y).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 12);
    await page.screenshot({ path: info.outputPath('download-overlay.png') });
    if (process.env.FORGE_DOWNLOAD_CAPTURES) {
      await mkdir(process.env.FORGE_DOWNLOAD_CAPTURES, { recursive: true });
      await page.screenshot({
        path: join(process.env.FORGE_DOWNLOAD_CAPTURES, `download-${viewport.width}.png`),
      });
    }
    await page.getByRole('button', { name: 'Close download options' }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(downloads).toBe(0);
    // Fast keyboard navigation can focus Download before the native toggle task fires.
    await trigger.evaluate((node) => {
      if (!(node instanceof HTMLButtonElement)) {
        throw Error('Expected download trigger');
      }
      node.click();
      document.querySelector<HTMLButtonElement>('#art-download-png')?.focus();
    });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#art-download-png')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    // Sheet navigation refreshes the preview without changing export scope or authored work.
    await (await revealArtworkControl(page, 'art-frame')).selectOption('f1');
    await (await revealArtworkControl(page, 'art-png-menu')).click();
    await expect(page.locator('#art-png-frame-detail')).toHaveText('Pose 1 · 16 × 16 px');
    await expect(page.locator('#art-png-filename')).toHaveText('player-f1.png');
    const waiting = page.waitForEvent('download');
    await page.locator('#art-download-png').focus();
    await page.keyboard.press('Enter');
    expect((await waiting).suggestedFilename()).toBe('player-f1.png');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();
    // Another document keeps its own whole-image choice and unavailable-frame guidance.
    await page.locator('[data-asset="image/artwork"]').click();
    await expect(page.locator('#art-document-state')).toHaveText('Saved');
    await (await revealArtworkControl(page, 'art-png-menu')).click();
    await expect(page.locator('#art-png-sheet')).toBeChecked();
    await expect(page.locator('#art-png-sheet-title')).toHaveText('Whole artwork');
    await expect(page.locator('#art-png-frame')).toBeDisabled();
    await expect(page.locator('#art-png-frame-detail')).toContainText('sheet frame is selected');
    await expect(page.locator('#art-png-output')).toHaveText('PNG · 24 × 12 px · RGBA');
    await page.keyboard.press('Escape');
    await page.locator('#document-switcher').click();
    await page.locator('#artwork-documents button').filter({ hasText: 'Player poses' }).click();
    await (await revealArtworkControl(page, 'art-png-menu')).click();
    await expect(page.locator('#art-png-frame')).toBeChecked();
    await expect(page.locator('#art-png-filename')).toHaveText('player-f1.png');
  });
}

test('download guards reject missing frame selection, gestures and busy artwork', async ({
  page,
  workspace,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await setup(page, workspace);
  const trigger = await revealArtworkControl(page, 'art-png-menu');
  await trigger.click();
  await page.locator('#art-png-frame').check();
  await page.keyboard.press('Escape');
  // Exercise the native selector's empty-selection boundary without changing sheet data.
  await page.locator('#art-frame').selectOption([]);
  await trigger.click();
  await expect(page.locator('#art-png-frame')).toBeDisabled();
  await expect(page.locator('#art-download-png')).toBeDisabled();
  await expect(page.locator('#art-png-frame-detail')).toContainText('Select a frame');
  await expect(page.locator('#art-png-filename')).toHaveText('—');
  await page.locator('#art-png-sheet').check();
  await expect(page.locator('#art-download-png')).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.locator('#art-frame').selectOption('f0');
  const canvas = await page.locator('#art-canvas').boundingBox();
  if (!canvas) {
    throw Error('Expected artwork canvas bounds');
  }
  await page.mouse.move(canvas.x + 24, canvas.y + 24);
  await page.mouse.down();
  await expect(trigger).toBeDisabled();
  await page.mouse.up();
  await expect(trigger).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/artwork-review', async (route) => {
    await gate;
    await route.continue();
  });
  await page.locator('#save').click();
  try {
    await expect(trigger).toBeDisabled();
    await expect(page.locator('#art-download-png')).toBeDisabled();
  } finally {
    release();
  }
  await expect(trigger).toBeEnabled();
  await expect(page.locator('#art-comparison')).toBeVisible();
});
