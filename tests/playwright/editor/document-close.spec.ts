/** Native dialog events can outlive the editor that queued them. */
import { build } from 'esbuild';
import { test, expect } from '../support/browser-fixtures.ts';

test('a queued close event cannot cancel a replacement document confirmation', async ({ page }) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { createDocumentClose } from './frontend/editor/document-close.mts';
import { EditorLifetime } from './frontend/editor/editor-lifetime.mts';
document.body.innerHTML = \`<dialog id="close-document-dialog">
  <p id="close-document-description"></p><p id="close-document-save-hint"></p>
  <button id="close-document-save">Save</button>
  <button id="close-document-keep">Keep</button>
  <button id="close-document-discard">Discard</button>
  <button id="close-document-cancel">Cancel</button>
</dialog>\`;
const dialog = document.getElementById('close-document-dialog');
let events = 0;
dialog.addEventListener('close', () => document.body.dataset.events = String(++events));
const lifetime = new EditorLifetime();
const first = createDocumentClose(lifetime);
// Match the mount's static-dialog cleanup. Reopen in this same task, before
// the browser dispatches the native close event queued during disposal.
lifetime.cleanup(() => dialog.close());
first('old document').then(value => document.body.dataset.oldResult = String(value));
lifetime.dispose();
const replacement = createDocumentClose(new EditorLifetime());
document.body.dataset.result = 'pending';
replacement('replacement document').then(value => document.body.dataset.result = String(value));
`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  await page.goto('about:blank');
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  await expect(page.locator('body')).toHaveAttribute('data-events', '1');
  await expect(page.locator('body')).toHaveAttribute('data-old-result', 'null');
  await expect(page.locator('#close-document-dialog')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-result', 'pending');
  await page.locator('#close-document-discard').click();
  await expect(page.locator('body')).toHaveAttribute('data-result', 'discard');
  await expect(page.locator('#close-document-dialog')).not.toBeVisible();
});
