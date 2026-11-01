import { expect, type Page } from '@playwright/test';
import { test, editorReady } from '../support/browser-fixtures.ts';

// The sample at 8x leaves scroll room on both axes in editing and review layouts.
test.use({ projectMode: 'sample', viewport: { width: 1440, height: 900 } });

async function openScene(page: Page, url: string) {
  await page.goto(url);
  await editorReady(page);
  await page.locator('#scenes').selectOption({ index: 1 });
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await page.locator('#zoom').selectOption('8');
}

async function startPan(page: Page) {
  const viewport = page.locator('#viewport');
  await viewport.evaluate((element) => {
    element.scrollTo(0, 0);
    element.addEventListener(
      'pointerdown',
      (event) => {
        if (event instanceof PointerEvent) {
          element.setAttribute('data-test-pointer', String(event.pointerId));
          element.setAttribute('data-test-prevented', String(event.defaultPrevented));
        }
      },
      { once: true, capture: true },
    );
  });
  const box = await viewport.boundingBox();
  if (!box) {
    throw Error('Expected scene viewport');
  }
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'middle' });
  await expect(viewport).toHaveAttribute('data-panning', 'true');
  await expect(viewport).toHaveAttribute('data-test-prevented', 'true');
  await page.mouse.move(point.x - 80, point.y - 60, { steps: 4 });
  await expect
    .poll(() => viewport.evaluate((element) => [element.scrollLeft, element.scrollTop]))
    .toEqual([80, 60]);
  return point;
}

async function authoredState(page: Page) {
  // Compare pixels at a canonical camera: offscreen backing pixels are intentionally cleared.
  await page.mouse.move(1, 1);
  return page.evaluate(async () => {
    const viewport = document.getElementById('viewport');
    if (!viewport) {
      throw Error('Expected viewport');
    }
    const position = [viewport.scrollLeft, viewport.scrollTop];
    const settled = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    viewport.scrollTo(0, 0);
    await settled();
    const canvas = document.getElementById('scene');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw Error('Expected scene canvas');
    }
    const state = {
      image: canvas.toDataURL(),
      state: document.getElementById('scene-save-state')?.textContent,
      undo: document.querySelector<HTMLButtonElement>('#undo')?.disabled,
      redo: document.querySelector<HTMLButtonElement>('#redo')?.disabled,
      tool: document.querySelector<HTMLInputElement>('input[name=tool]:checked')?.value,
      layer: document.querySelector<HTMLInputElement>('#layer-name')?.value,
    };
    viewport.scrollTo(position[0], position[1]);
    await settled();
    return state;
  });
}

test('middle-button pan preserves tools, clean/dirty content and history in editing and review', async ({
  page,
  forge,
}, info) => {
  await openScene(page, forge.url);
  const viewport = page.locator('#viewport');
  for (const tool of ['paint', 'erase', 'fill', 'select', 'pan']) {
    await page.locator(`input[name=tool][value=${tool}]`).check();
    const before = await authoredState(page);
    await startPan(page);
    await expect(viewport).toHaveCSS('cursor', 'grabbing');
    if (tool === 'paint') {
      await page.screenshot({ path: info.outputPath('middle-pan-editing.png') });
    }
    await page.mouse.up({ button: 'middle' });
    await expect(viewport).toHaveAttribute('data-panning', 'false');
    expect(await authoredState(page)).toEqual(before);
  }

  await page.locator('input[name=tool][value=paint]').check();
  const originalName = await page.locator('#layer-name').inputValue();
  await page.locator('#layer-name').fill('Middle pan keeps my edits');
  await page.locator('#layer-name').press('Tab');
  await expect(page.locator('#scene-save-state')).toHaveText('Unsaved changes');
  const dirty = await authoredState(page);
  await startPan(page);
  await page.mouse.up({ button: 'middle' });
  expect(await authoredState(page)).toEqual(dirty);
  await page.locator('#undo').click();
  await expect(page.locator('#layer-name')).toHaveValue(originalName);
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  const withRedo = await authoredState(page);
  expect(withRedo.redo).toBe(false);
  await startPan(page);
  await page.mouse.up({ button: 'middle' });
  expect(await authoredState(page)).toEqual(withRedo);
  await page.locator('#redo').click();
  await expect(page.locator('#layer-name')).toHaveValue('Middle pan keeps my edits');

  await page.locator('#review-mode').click();
  const review = await authoredState(page);
  await startPan(page);
  await page.screenshot({ path: info.outputPath('middle-pan-review.png') });
  await page.mouse.up({ button: 'middle' });
  expect(await authoredState(page)).toEqual(review);
  await page.locator('#review-mode').click();
  await expect(page.locator('input[name=tool]:checked')).toHaveValue('paint');
});

test('middle-button pan releases on chords, cancellation, blur and disposal without browser defaults', async ({
  page,
  forge,
}) => {
  await openScene(page, forge.url);
  const viewport = page.locator('#viewport');
  await page.locator('input[name=tool][value=paint]').check();
  const before = await authoredState(page);

  for (const reason of [
    'outside',
    'pointercancel',
    'lostpointercapture',
    'blur',
    'hidden',
    'chord',
  ]) {
    const point = await startPan(page);
    // Space is independent of a middle-button gesture, including release while held.
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(viewport).toHaveAttribute('data-panning', 'true');
    if (reason === 'outside') {
      await page.mouse.move(5, 5);
      await expect(viewport).toHaveAttribute('data-panning', 'true');
      await page.mouse.up({ button: 'middle' });
    } else if (reason === 'blur') {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    } else if (reason === 'hidden') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        try {
          document.dispatchEvent(new Event('visibilitychange'));
        } finally {
          Reflect.deleteProperty(document, 'hidden');
        }
      });
    } else if (reason === 'chord') {
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'middle' });
      // Pointer Events reports this as pointermove while left remains down.
      await page.mouse.move(point.x - 100, point.y - 80);
    } else {
      await viewport.evaluate((element, type) => {
        const pointerId = Number(element.getAttribute('data-test-pointer'));
        if (type === 'lostpointercapture') {
          element.releasePointerCapture(pointerId);
        } else {
          element.dispatchEvent(
            new PointerEvent(type, { pointerId, bubbles: true, pointerType: 'mouse' }),
          );
        }
      }, reason);
      // Native capture changes are delivered with the next pointer event.
      if (reason === 'lostpointercapture') {
        await page.mouse.move(point.x - 100, point.y - 80);
      }
    }
    await expect(viewport, reason).toHaveAttribute('data-panning', 'false');
    const stopped = await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop]);
    await page.mouse.move(point.x - 120, point.y - 100);
    expect(await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual(
      stopped,
    );
    await page.mouse.up({ button: 'middle' });
    if (reason === 'chord') {
      await page.mouse.up({ button: 'left' });
    }
    expect(await authoredState(page)).toEqual(before);
  }

  await page.locator('#scene').focus();
  await page.keyboard.down('Space');
  await startPan(page);
  await page.keyboard.up('Space');
  await expect(viewport).toHaveAttribute('data-panning', 'true');
  await page.mouse.up({ button: 'middle' });
  await expect(viewport).toHaveAttribute('data-panning', 'false');
  expect(await authoredState(page)).toEqual(before);

  const defaults = await viewport.evaluate((element) =>
    ['pointerdown', 'auxclick'].map((type) => {
      const event = new PointerEvent(type, {
        button: 1,
        buttons: 0,
        isPrimary: false,
        bubbles: true,
        cancelable: true,
      });
      // A standalone auxiliary click must be suppressed even after pan has ended.
      return { type, prevented: !element.dispatchEvent(event) };
    }),
  );
  expect(defaults).toEqual([
    { type: 'pointerdown', prevented: false },
    { type: 'auxclick', prevented: true },
  ]);

  await startPan(page);
  await page.evaluate(
    "(async () => { const module = await import('/project.js'); module.editor.dispose(); })()",
  );
  await expect(viewport).toHaveAttribute('data-panning', 'false');
  const stopped = await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop]);
  await page.mouse.move(5, 5);
  await page.mouse.up({ button: 'middle' });
  expect(await viewport.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual(
    stopped,
  );
  await page.evaluate(
    "(async () => { const module = await import('/project.js'); module.mountProjectEditor(); })()",
  );
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await expect(page.locator('#scenes')).toBeEnabled();
  await page.locator('#zoom').selectOption('8');
  await startPan(page);
  await page.mouse.up({ button: 'middle' });
  await expect(viewport).toHaveAttribute('data-panning', 'false');
  await expect(page.locator('#scene-save-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
});
