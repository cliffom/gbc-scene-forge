/** Human-facing artwork commands and progressive disclosure used by acceptance tasks. */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function revealArtworkControl(page: Page, id: string) {
  const control = page.locator('#' + id);
  if (await control.locator('xpath=ancestor::*[@id="art-layer-panel"]').count()) {
    if (!(await control.isVisible())) {
      await page.locator('#art-layers-toggle').click();
    }
  }
  if (await control.locator('xpath=ancestor::aside[contains(@class,"art-review")]').count()) {
    if (!(await control.isVisible())) {
      await page.locator('#art-save').click();
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
    await page.locator('#art-save').click();
  }
  await expect(page.locator('#art-comparison')).toBeVisible();
  await expect(page.locator('#art-save')).toHaveText('Confirm save');
}

export async function saveArtwork(page: Page) {
  if (!(await page.locator('.art-review').isVisible())) {
    await reviewArtwork(page);
  }
  await page.locator('#art-save').click();
  await expect(page.locator('#art-message')).toContainText('Artwork saved.');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#artwork-dialog')).toBeVisible();
}
