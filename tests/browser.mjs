// Optional real-browser QA. Requires Node and a local Chromium/Chrome executable.
// Start tests/serve_fixture.py with a disposable --root before running.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8765/';
const chrome = process.argv[3] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'forge-fixture-chrome-'));
const browser = spawn(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-pipe', `--user-data-dir=${profile}`], {stdio:['ignore','ignore','pipe','pipe','pipe']});
let serial=0, buffer='', session;
const pending=new Map(), errors=[];
let chromeError='';
browser.stderr.on('data', data => { chromeError += data; });
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  for (;;) {
    const end=buffer.indexOf('\0'); if(end<0)break;
    const event=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
    if(event.id) { const job=pending.get(event.id); if(job) { pending.delete(event.id); clearTimeout(job.timer); event.error ? job.reject(Error(JSON.stringify(event.error))) : job.resolve(event.result); } }
    if(event.method==='Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text+': '+JSON.stringify(event.params.exceptionDetails.exception));
    if(event.method==='Log.entryAdded' && event.params.entry.level==='error' && !event.params.entry.url?.endsWith('/favicon.ico')) errors.push(event.params.entry.text);
  }
});
function call(method, params={}, target=session) {
  const id=++serial;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timed out: ${method}; ${chromeError.slice(-1500)}`));},30000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})})+'\0');
  });
}
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  return evaluate(`(async()=>{for(let i=0;i<150;i++){if(${expression})return true;await new Promise(r=>setTimeout(r,100));}throw Error('UI wait timed out: '+${JSON.stringify(expression)});})()`);
}
async function click(expression) { await evaluate(`(${expression}).click()`); }
async function scene() {
  await evaluate('window.__download=null');
  await click("document.getElementById('download')");
  await wait("window.__download?.type==='application/json'");
  return evaluate(`window.__download.text().then(JSON.parse).then(d=>d.version===2?{...d.content,version:1,connector:d.connector,id:d.id,name:d.name,profile:d.target,source_digest:d.source_revision}:d)`);
}
async function pointer(x,y,type='mousePressed') {
  const rect=await evaluate("(()=>{const r=document.getElementById('scene').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
  const dims=await evaluate("({w:document.getElementById('scene').width,h:document.getElementById('scene').height})");
  await call('Input.dispatchMouseEvent',{type,x:rect.x+x*rect.w/dims.w,y:rect.y+y*rect.h/dims.h,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
}
async function screenshot(name) {
  const result=await call('Page.captureScreenshot',{format:'png'});
  await mkdir('build/reports/scene-editor',{recursive:true});
  await writeFile(`build/reports/scene-editor/${name}.png`,Buffer.from(result.data,'base64'));
}
try {
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);
  session=(await call('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});
  await wait("document.getElementById('status')?.textContent.includes('Scene loaded')");
  await evaluate('window.__download=null;URL.createObjectURL=blob=>{window.__download=blob;return "blob:test"};HTMLAnchorElement.prototype.click=function(){}');
  const original=await scene();
  assert.equal(await evaluate("document.getElementById('original').hidden"),true);
  assert.equal(original.profile,'workbench');
  assert.equal(await evaluate("document.getElementById('scene').width"),28);
  assert.equal(await evaluate("document.getElementById('state-field').hidden"),true);
  assert.equal(await evaluate("document.getElementById('project-name').textContent"),'INDEPENDENT FIXTURE');
  // A game-relevant non-grid field proves that the core uses connector comparison.
  await evaluate(`(()=>{const doc=${JSON.stringify(original)};doc.flag=true;const data=new DataTransfer();data.items.add(new File([JSON.stringify(doc)],'fixture.json',{type:'application/json'}));const file=document.getElementById('file');file.files=data.files;file.dispatchEvent(new Event('change'));})()`);
  await wait("document.getElementById('status').textContent.includes('JSON imported')");
  await wait("document.getElementById('apply').disabled===false");
  assert.deepEqual((await scene()).cells,original.cells);
  await click("document.getElementById('open')");
  await wait("document.getElementById('discard').open");
  await click("document.querySelector('#discard button[value=discard]')");
  await wait("document.getElementById('status').textContent.includes('Scene loaded')");
  await click("[...document.querySelectorAll('.asset')].find(b=>b.textContent.includes('Stone'))");
  await pointer(10,10);await pointer(10,10,'mouseReleased');
  assert.equal((await scene()).cells[2][2],'solid');
  await wait("document.getElementById('apply').disabled===false");
  await click("document.getElementById('save')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  await wait("document.getElementById('original').hidden===false");
  await click("document.getElementById('apply')");
  await wait("document.getElementById('apply-review').open");
  await click("document.getElementById('approve-layout')");
  await click("document.getElementById('apply-confirm')");
  await wait("document.getElementById('apply-result').textContent.includes('Reviewed project files updated') && !document.getElementById('apply-close').disabled");
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
  await evaluate('window.__download=null;URL.createObjectURL=blob=>{window.__download=blob;return "blob:test"};HTMLAnchorElement.prototype.click=function(){}');
  await click("document.getElementById('original')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.deepEqual((await scene()).cells,original.cells);
  assert.equal(await evaluate("document.getElementById('original').disabled"),true);
  await evaluate("document.getElementById('name').value='Edited original';document.getElementById('name').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('original').disabled"),false);
  await click("document.getElementById('undo')");
  assert.equal(await evaluate("document.getElementById('original').disabled"),true);
  // A saved draft with identical content must still allow opening the original.
  await evaluate(`(()=>{const doc=${JSON.stringify(original)};const data=new DataTransfer();data.items.add(new File([JSON.stringify(doc)],'same-original.json',{type:'application/json'}));const file=document.getElementById('file');file.files=data.files;file.dispatchEvent(new Event('change'));})()`);
  await wait("document.getElementById('status').textContent.includes('JSON imported')");
  await click("document.getElementById('save')");
  await wait("document.getElementById('dirty').textContent==='SAVED'");
  assert.deepEqual((await scene()).cells,original.cells);
  assert.equal(await evaluate("document.getElementById('original').disabled"),false);
  await click("document.getElementById('original')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.equal(await evaluate("document.getElementById('original').disabled"),true);
  await wait("document.getElementById('apply').disabled===false");
  const applied=await evaluate("fetch('/api/scene/workbench').then(r=>r.json())");
  assert.equal(applied.scene.cells[2][2],'solid');
  assert.equal(await evaluate("document.getElementById('save').disabled"),true);
  await click("document.getElementById('delete-drafts')");
  await wait("document.getElementById('delete-drafts-dialog').open");
  await evaluate("document.querySelectorAll('#delete-drafts-list input').forEach(input=>input.click())");
  await click("document.getElementById('delete-drafts-confirm')");
  await wait("document.getElementById('status').textContent.includes('Deleted 2')");
  assert.equal(await evaluate("document.getElementById('original').hidden"),false);
  // Original loading follows the same unsaved-change confirmation as other opens.
  await evaluate("document.getElementById('name').value='Unsaved';document.getElementById('name').dispatchEvent(new Event('change'))");
  await click("document.getElementById('original')");
  await wait("document.getElementById('discard').open");
  await click("document.querySelector('#discard button[value=discard]')");
  await wait("document.getElementById('dirty').textContent==='ORIGINAL'");
  assert.equal(await evaluate("document.getElementById('original').disabled"),true);
  await click("document.getElementById('undo-apply')");
  await wait("document.getElementById('status').textContent.includes('Previous project files restored')");
  const restored=await evaluate("fetch('/api/scene/workbench').then(r=>r.json())");
  assert.deepEqual(restored.scene.cells,original.cells);
  assert.deepEqual(errors,[]);
  console.log('Independent connector browser QA passed: descriptors, opaque cells, non-grid comparison, draft save, real compile/apply and rollback.');
} finally {
  try { await call('Browser.close',{},null); } catch { browser.kill(); }
  await new Promise(resolve => browser.exitCode!==null?resolve():browser.once('exit',resolve));
  await rm(profile,{recursive:true,force:true});
}
