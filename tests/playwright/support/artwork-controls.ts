/** Human-facing artwork commands and progressive disclosure used by acceptance tasks. */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function revealArtworkControl(page: Page, id: string) {
  const control = page.locator('#' + id);
  if (
    id === 'art-png-menu' ||
    (await control
      .locator('xpath=ancestor::*[@id="art-color-controls" or @id="art-view-controls"]')
      .count())
  ) {
    // Resizing can move the group after the caller changes the viewport.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(async () => {
      if (
        !(await control.isVisible()) &&
        (await control.locator('xpath=ancestor::*[@id="art-tool-overflow"]').count())
      ) {
        await page.getByRole('button', { name: 'More artwork tools', exact: true }).click();
      }
      expect(await control.isVisible()).toBe(true);
    }).toPass({ timeout: 5000 });
  }
  if (id === 'art-handoff-list') {
    await page.locator('#art-agent-mode').click();
  }
  if (id === 'art-drafts') {
    // Recovery may open automatically after the async inventory has arrived.
    await expect(page.locator('#document-switcher')).toBeEnabled();
  }
  if (await control.locator('xpath=ancestor::*[@id="art-layer-panel"]').count()) {
    if (!(await control.isVisible())) {
      await page.locator('#art-layers-toggle').click();
    }
  }
  if (await control.locator('xpath=ancestor::aside[contains(@class,"art-review")]').count()) {
    if (!(await control.isVisible())) {
      await page.locator('#save').click();
    }
  }
  if (await control.locator('xpath=ancestor::*[@id="art-properties"]').count()) {
    if (!(await control.isVisible())) {
      await page.locator('#art-properties-toggle').click();
    }
  }
  for (const details of await control.locator('xpath=ancestor::details').all()) {
    if (!(await details.evaluate((node) => node instanceof HTMLDetailsElement && node.open))) {
      await details.locator(':scope > summary').click();
    }
  }
  return control;
}

export async function reviewArtwork(page: Page) {
  if (await page.locator('.art-review').isVisible()) {
    await page.locator('#art-review').click();
  } else {
    await page.locator('#save').click();
  }
  await expect(page.locator('#art-comparison')).toBeVisible();
  await expect(page.locator('#art-message')).toContainText('Review ready.');
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#save')).toHaveText('Confirm save');
}

export async function saveArtwork(page: Page) {
  if (!(await page.locator('.art-review').isVisible())) {
    await reviewArtwork(page);
  }
  await page.locator('#save').click();
  await expect(page.locator('#art-message')).toContainText('Artwork saved.');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#artwork-surface')).toBeVisible();
}

/** Preview a retained agent revision, then explicitly adopt it into independent local work. */
export async function adoptAgentDraft(page: Page, revision: string) {
  await page.locator(`#art-handoff-candidates [data-revision="${revision}"] button`).click();
  await expect(page.locator('#art-agent-image canvas')).toBeVisible();
  await page.locator('#art-agent-adopt').click();
  await expect(page.locator('#art-agent-preview')).not.toBeVisible();
}

/** Raster-layer rows are displayed front-to-back, independently of native storage order. */
export function activeArtworkLayer(page: Page) {
  return page.locator('.art-layer-row[data-active="true"]');
}
export function artworkLayer(page: Page, name: string) {
  return page.locator('.art-layer-row').filter({
    has: page.getByRole('button', { name: `Select ${name}`, exact: true }),
  });
}
export async function selectArtworkLayer(page: Page, name: string) {
  await revealArtworkControl(page, 'art-layer-list');
  await page.getByRole('button', { name: `Select ${name}`, exact: true }).click();
}
export async function renameArtworkLayer(page: Page, name: string) {
  await activeArtworkLayer(page).locator('.art-layer-select').dblclick();
  await page.locator('#art-layer-name').fill(name);
  await page.locator('#art-layer-name').press('Enter');
}
