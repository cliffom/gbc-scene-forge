// Optional browser acceptance suite. Start serve_fixture.py with a disposable workspace.
import assert from 'node:assert/strict';
import { sceneData, string } from '../frontend/decode.mts';
import { Chrome, waitForServer } from './chrome.ts';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
await waitForServer(url);
const chrome = await Chrome.launch(process.argv[3]);
const call = chrome.call.bind(chrome);
const evaluate = chrome.evaluate.bind(chrome);
const wait = chrome.wait.bind(chrome);
const click = chrome.click.bind(chrome);
const scene = chrome.scene.bind(chrome);
const pointer = chrome.pointer.bind(chrome);
const screenshot = chrome.screenshot.bind(chrome);

try {
  const targetId = string(
    (await call('Target.createTarget', { url: 'about:blank' }, null)).targetId,
  );
  chrome.session = string(
    (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId,
  );
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call('Page.navigate', { url });
  await wait("document.getElementById('status')?.textContent.includes('Scene loaded')");
  await evaluate(
    'window.__download=null;URL.createObjectURL=blob=>{window.__download=blob;return "blob:test"};HTMLAnchorElement.prototype.click=function(){}',
  );
  const original = await scene();
  assert.equal(await evaluate("document.getElementById('original').hidden"), true);
  assert.equal(original.profile, 'workbench');
  assert.equal(await evaluate("document.getElementById('scene').width"), 28);
  assert.equal(await evaluate("document.getElementById('state-field').hidden"), true);
  assert.equal(
    await evaluate("document.getElementById('project-name').textContent"),
    'INDEPENDENT FIXTURE',
  );
  // A game-relevant non-grid field proves that the core uses connector comparison.
  await evaluate(
    `(()=>{const doc=${JSON.stringify(original)};doc.flag=true;const data=new DataTransfer();data.items.add(new File([JSON.stringify(doc)],'fixture.json',{type:'application/json'}));const file=document.getElementById('file');file.files=data.files;file.dispatchEvent(new Event('change'));})()`,
  );
  await wait("document.getElementById('status').textContent.includes('JSON imported')");
  await wait("document.getElementById('apply').disabled===false");
  assert.deepEqual((await scene()).cells, original.cells);
  await click("document.getElementById('open')");
  await wait("document.getElementById('discard').open");
  await click("document.querySelector('#discard button[value=discard]')");
  await wait("document.getElementById('status').textContent.includes('Scene loaded')");
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(10, 10);
  await pointer(10, 10, 'mouseReleased');
  assert.equal((await scene()).cells[2][2], 'solid');
  await wait("document.getElementById('apply').disabled===false");
  await click("document.getElementById('save')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  await wait("document.getElementById('original').hidden===false");
  await click("document.getElementById('apply')");
  await wait("document.getElementById('apply-review').open");
  await click("document.getElementById('approve-layout')");
  await click("document.getElementById('apply-confirm')");
  await wait(
    "document.getElementById('apply-result').textContent.includes('Reviewed project files updated') && !document.getElementById('apply-close').disabled",
  );
  await screenshot('browser-independent-connector');
  await click("document.getElementById('apply-close')");
  await wait("document.getElementById('apply').disabled===true");
  // The persisted original remains available after a reload and after applying edits.
  await click("document.getElementById('open')");
  await wait("document.getElementById('discard').open");
  await click("document.querySelector('#discard button[value=discard]')");
  await wait("document.getElementById('dirty').textContent==='CURRENT'");
  await call('Page.reload');
  await wait("document.getElementById('status')?.textContent.includes('Scene loaded')");
  await wait("document.getElementById('original').hidden===false");
  await evaluate(
    'window.__download=null;URL.createObjectURL=blob=>{window.__download=blob;return "blob:test"};HTMLAnchorElement.prototype.click=function(){}',
  );
  await click("document.getElementById('original')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.deepEqual((await scene()).cells, original.cells);
  assert.equal(await evaluate("document.getElementById('original').disabled"), true);
  await evaluate(
    "document.getElementById('name').value='Edited original';document.getElementById('name').dispatchEvent(new Event('change'))",
  );
  assert.equal(await evaluate("document.getElementById('original').disabled"), false);
  await click("document.getElementById('undo')");
  assert.equal(await evaluate("document.getElementById('original').disabled"), true);
  // A saved draft with identical content must still allow opening the original.
  await evaluate(
    `(()=>{const doc=${JSON.stringify(original)};const data=new DataTransfer();data.items.add(new File([JSON.stringify(doc)],'same-original.json',{type:'application/json'}));const file=document.getElementById('file');file.files=data.files;file.dispatchEvent(new Event('change'));})()`,
  );
  await wait("document.getElementById('status').textContent.includes('JSON imported')");
  await click("document.getElementById('save')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  assert.deepEqual((await scene()).cells, original.cells);
  assert.equal(await evaluate("document.getElementById('original').disabled"), false);
  await click("document.getElementById('original')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.equal(await evaluate("document.getElementById('original').disabled"), true);
  await wait("document.getElementById('apply').disabled===false");
  const applied = sceneData(await evaluate("fetch('/api/scene/workbench').then(r=>r.json())"));
  assert.equal(applied.scene.cells[2][2], 'solid');
  assert.equal(await evaluate("document.getElementById('save').disabled"), true);
  await click("document.getElementById('delete-drafts')");
  await wait("document.getElementById('delete-drafts-dialog').open");
  await evaluate(
    "document.querySelectorAll('#delete-drafts-list input').forEach(input=>input.click())",
  );
  await click("document.getElementById('delete-drafts-confirm')");
  await wait("document.getElementById('status').textContent.includes('Deleted 2')");
  assert.equal(await evaluate("document.getElementById('original').hidden"), false);
  // Original loading follows the same unsaved-change confirmation as other opens.
  await evaluate(
    "document.getElementById('name').value='Unsaved';document.getElementById('name').dispatchEvent(new Event('change'))",
  );
  await click("document.getElementById('original')");
  await wait("document.getElementById('discard').open");
  await click("document.querySelector('#discard button[value=discard]')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.equal(await evaluate("document.getElementById('original').disabled"), true);
  await click("document.getElementById('undo-apply')");
  await wait(
    "document.getElementById('status').textContent.includes('Previous project files restored')",
  );
  const restored = sceneData(await evaluate("fetch('/api/scene/workbench').then(r=>r.json())"));
  assert.deepEqual(restored.scene.cells, original.cells);
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Independent connector browser QA passed: descriptors, opaque cells, non-grid comparison, draft save, real compile/apply and rollback.',
  );
} finally {
  await chrome.close();
}
