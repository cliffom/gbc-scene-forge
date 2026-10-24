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
  // Python connectors may serialize disabled optional preview fields as null.
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]) === '/api/catalog') {
        const data = await response.json();
        for (const profile of Object.values(data.profiles)) {
          profile.animation_frames = null; profile.animation_interval_ms = null; profile.animation_label = null;
        }
        return Response.json(data);
      }
      return response;
    };
  })();`,
  });
  await call('Page.navigate', { url });
  await wait("document.getElementById('status')?.textContent.includes('Scene loaded')");
  await wait("document.querySelector('.brand img')?.naturalWidth === 64");
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.brand img')).imageRendering"),
    'pixelated',
  );
  for (const size of [16, 32]) {
    const icon = await fetch(new URL(`/branding/favicon-${size}.png`, url));
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
  }
  await screenshot('browser-branding');
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
  assert.equal(await evaluate("document.getElementById('save').disabled"), true);
  // Canceling creation preserves the canvas and never writes a draft.
  await click("document.getElementById('create-draft')");
  await wait("document.getElementById('create-draft-dialog').open");
  await screenshot('browser-create-draft');
  await evaluate("document.getElementById('create-draft-name').value='Canceled draft'");
  await click("document.getElementById('create-draft-cancel')");
  assert.equal((await scene()).name, original.name);
  assert.deepEqual(await evaluate("fetch('/api/drafts').then(r=>r.json())"), []);
  await click("document.getElementById('create-draft')");
  await wait("document.getElementById('create-draft-dialog').open");
  await evaluate("document.getElementById('create-draft-name').value='   '");
  await click("document.getElementById('create-draft-confirm')");
  assert.equal(await evaluate("document.getElementById('create-draft-dialog').open"), true);
  assert.deepEqual(await evaluate("fetch('/api/drafts').then(r=>r.json())"), []);
  await evaluate(`(() => {
    const input = document.getElementById('create-draft-name');
    input.value = 'Named draft'; input.dispatchEvent(new Event('input'));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (String(args[0]) === '/api/save') {
        window.fetch = originalFetch;
        return Response.json({error: 'Temporary save failure'}, {status: 500});
      }
      return originalFetch(...args);
    };
  })()`);
  await click("document.getElementById('create-draft-confirm')");
  await wait(
    "document.getElementById('create-draft-error').textContent.includes('Temporary save failure')",
  );
  assert.equal((await scene()).name, original.name);
  await click("document.getElementById('create-draft-confirm')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  await wait("document.getElementById('original').hidden===false");
  assert.equal((await scene()).name, 'Named draft');
  const firstDraftId = (await scene()).id;
  assert.equal(await evaluate("document.getElementById('name').readOnly"), true);
  assert.equal(
    await evaluate("getComputedStyle(document.getElementById('name')).color"),
    await evaluate("getComputedStyle(document.getElementById('scene-id'), '::placeholder').color"),
  );
  await click("document.getElementById('undo')");
  assert.equal((await scene()).name, 'Named draft');
  assert.equal((await scene()).id, firstDraftId);
  await click("document.getElementById('redo')");
  assert.equal((await scene()).name, 'Named draft');
  assert.equal((await scene()).id, firstDraftId);
  // Saving edits updates this draft; creation from it always makes a new copy.
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(14, 10);
  await pointer(14, 10, 'mouseReleased');
  await click("document.getElementById('save')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  assert.equal((await scene()).id, firstDraftId);
  await click("document.getElementById('create-draft')");
  await wait("document.getElementById('create-draft-dialog').open");
  await evaluate("document.getElementById('create-draft-name').value='Copied draft'");
  await click("document.getElementById('create-draft-confirm')");
  await wait("!document.getElementById('create-draft-dialog').open");
  assert.notEqual((await scene()).id, firstDraftId);
  assert.equal((await scene()).name, 'Copied draft');
  assert.deepEqual((await scene()).cells[2][2], 'solid');
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
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(14, 10);
  await pointer(14, 10, 'mouseReleased');
  assert.equal(await evaluate("document.getElementById('original').disabled"), false);
  await click("document.getElementById('undo')");
  assert.equal(await evaluate("document.getElementById('original').disabled"), true);
  // A saved draft with identical content must still allow opening the original.
  await evaluate(
    `(()=>{const doc=${JSON.stringify(original)};const data=new DataTransfer();data.items.add(new File([JSON.stringify(doc)],'same-original.json',{type:'application/json'}));const file=document.getElementById('file');file.files=data.files;file.dispatchEvent(new Event('change'));})()`,
  );
  await wait("document.getElementById('status').textContent.includes('JSON imported')");
  await click("document.getElementById('create-draft')");
  await wait("document.getElementById('create-draft-dialog').open");
  await click("document.getElementById('create-draft-confirm')");
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
  await wait("document.getElementById('status').textContent.includes('Deleted 3')");
  assert.equal(await evaluate("document.getElementById('original').hidden"), false);
  // Original loading follows the same unsaved-change confirmation as other opens.
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(14, 10);
  await pointer(14, 10, 'mouseReleased');
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
  // Permanent protocol failures stop polling without claiming the build failed.
  await evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.statusPolls = 0;
    window.restoreStatusFetch = () => { window.fetch = originalFetch; };
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]).includes('/api/apply-status/')) {
        window.statusPolls++;
        const data = await response.json(); data.started_at = 'invalid';
        return Response.json(data);
      }
      return response;
    };
  })();`);
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(10, 10);
  await pointer(10, 10, 'mouseReleased');
  await wait("document.getElementById('apply').disabled===false");
  await click("document.getElementById('apply')");
  await wait("document.getElementById('apply-review').open");
  await click("document.getElementById('approve-layout')");
  await click("document.getElementById('apply-confirm')");
  await wait(
    "document.getElementById('apply-result').textContent.includes('Automatic retries stopped') && !document.getElementById('apply-close').disabled",
  );
  await evaluate('new Promise(resolve => setTimeout(resolve, 2300))');
  assert.equal(await evaluate('window.statusPolls'), 1);
  assert.match(
    string(await evaluate("document.getElementById('apply-result').textContent")),
    /not a confirmed build failure/,
  );
  await evaluate('window.restoreStatusFetch()');
  await click("document.getElementById('apply-reconnect')");
  await wait(
    "document.getElementById('apply-result').textContent.includes('Reviewed project files updated') && !document.getElementById('apply-close').disabled",
  );
  await click("document.getElementById('apply-close')");
  await click("document.getElementById('undo-apply')");
  await wait(
    "document.getElementById('status').textContent.includes('Previous project files restored')",
  );
  assert.deepEqual(chrome.errors, []);
  console.log(
    'Independent connector browser QA passed: descriptors, opaque cells, non-grid comparison, draft save, real compile/apply and rollback, nullable profiles, and protocol-error recovery.',
  );
} finally {
  await chrome.close();
}
