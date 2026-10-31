/** Resource ownership and replacement of the supported editor composition. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, editorReady } from '../support/browser-fixtures.ts';

test.use({ projectMode: 'sample' });
test('editor disposal, remount and delayed operations preserve ownership', async ({
  page,
  forge,
}) => {
  const { stdout } = await promisify(execFile)(forge.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p = Project(Path(sys.argv[1]))
p.objects.save_stamp('Forest entrance with a long descriptive stamp name', dict(width=1, height=1, grid=8,
    cells=[['sample/grass/0/0']]), [0], p.catalog()['revision'])
print(p.catalog()['project']['scenes'][0]['id'])
`,
    forge.root,
  ]);
  const scene = stdout.trim();
  await page.goto(forge.url);
  const evaluate = (expression: string): Promise<unknown> => page.evaluate(expression);
  const wait = async (expression: string) => {
    await expect
      .poll(() => page.evaluate<unknown>(expression), { message: expression })
      .toBeTruthy();
  };
  await test.step('Remount has single handlers, overlays and polling ownership', async () => {
    await editorReady(page);
    await evaluate(
      `document.getElementById('scenes').value=${JSON.stringify(scene)}; document.getElementById('scenes').dispatchEvent(new Event('change'));`,
    );
    await wait("document.getElementById('scene-save-state').textContent === 'Saved'");

    await evaluate(`(async()=>{window.__requests=[]; window.__fetch=window.fetch;
    window.fetch=(...args)=>{window.__requests.push(String(args[0]));return window.__fetch(...args)};
    window.__module=await import('/project.js'); window.__module.editor.dispose();
    document.activeElement?.blur();})()`);
    assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 0);
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.deepEqual(await evaluate('window.__requests'), []);
    // The embedding host chooses the project URL for an empty replacement.
    // A replaced editor owns exactly one set of handlers, overlays and pollers.
    for (let attempt = 0; attempt < 2; attempt++) {
      await evaluate(
        "document.getElementById('status').textContent='Loading replacement';history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()",
      );
      await editorReady(page);
      assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 1);
      assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 1);
      await evaluate(`window.__requests=[];
      document.getElementById('scenes').value=${JSON.stringify(scene)};
      document.getElementById('scenes').dispatchEvent(new Event('change'));`);
      await wait("document.getElementById('status').textContent === 'Scene opened.'");
      assert.equal(
        await evaluate("window.__requests.filter(url=>url.includes('/api/scene/')).length"),
        1,
      );
      await evaluate('window.__mounted.dispose();window.__requests=[]');
      assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 0);
      assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 0);
      await new Promise((resolve) => setTimeout(resolve, 2300));
      assert.deepEqual(await evaluate('window.__requests'), []);
    }
  });
  await test.step('Late project responses cannot overwrite a replacement', async () => {
    // A load from a disposed editor must not overwrite its replacement, even if
    // a host's fetch wrapper ignores cancellation and delivers the old response late.
    await evaluate(`window.__held=false;window.fetch=async(...args)=>{
    const response=await window.__fetch(...args);
    if(String(args[0]).includes('/api/project')) {
      window.__held=true;
      await new Promise(resolve=>{window.__release=resolve});
    }
    return response;
  };window.__stale=window.__module.mountProjectEditor()`);
    await wait('window.__held');
    await evaluate(`window.__stale.dispose();window.fetch=window.__fetch;
    document.getElementById('status').textContent='Loading replacement';history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()`);
    await editorReady(page);
    await evaluate('window.__release()');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      await evaluate("document.getElementById('status').textContent"),
      'Choose a scene, or import an atlas and create one.',
    );
    assert.equal(await evaluate("document.querySelectorAll('.scene-surface').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('#diagnostics-dialog').length"), 1);
  });
  await test.step('Disposal closes controller-owned dialogs and popovers', async () => {
    // A modal's visible data must never outlive the controller that owns it.
    await evaluate("document.getElementById('show-world').click()");
    await wait("document.getElementById('world-dialog').open");
    await evaluate('window.__mounted.dispose()');
    assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 0);
    await evaluate(
      "document.getElementById('status').textContent='Loading replacement';history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()",
    );
    await editorReady(page);
    await evaluate("document.getElementById('project-command-panel').showPopover()");
    await evaluate('window.__mounted.dispose()');
    assert.equal(await evaluate('document.querySelectorAll(":popover-open").length'), 0);
  });
  await test.step('Pending artwork decode cannot adopt into a replacement', async () => {
    // Hold artwork decoding after the scene response has already arrived. This is
    // independent of request cancellation: refresh must reject the old adoption.
    await evaluate(
      "document.getElementById('status').textContent='Loading replacement';history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()",
    );
    await editorReady(page);
    await evaluate(`window.__decode=HTMLImageElement.prototype.decode;
    window.__decoding=false;
    HTMLImageElement.prototype.decode=async function(){
      await window.__decode.call(this);
      if(!window.__decoding){
        window.__decoding=true;
        await new Promise(resolve=>{window.__releaseDecode=resolve});
      }
    };
    document.getElementById('scenes').value=${JSON.stringify(scene)};
    document.getElementById('scenes').dispatchEvent(new Event('change'));`);
    await wait('window.__decoding');
    await evaluate(`window.__mounted.dispose();
    HTMLImageElement.prototype.decode=window.__decode;
    document.getElementById('status').textContent='Loading replacement';history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()`);
    await editorReady(page);
    await evaluate(`const scenes=document.getElementById('scenes');
    window.__replacementScene=[...scenes.options].find(option=>option.value && option.value!==${JSON.stringify(scene)}).value;
    scenes.value=window.__replacementScene;
    scenes.dispatchEvent(new Event('change'));`);
    await wait("document.getElementById('status').textContent === 'Scene opened.'");
    const displayed = await evaluate(`({name:document.getElementById('scene-name').textContent,
    canvas:document.getElementById('scene').toDataURL()})`);
    await evaluate('window.__releaseDecode()');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      await evaluate("document.getElementById('scenes').value"),
      await evaluate('window.__replacementScene'),
    );
    assert.deepEqual(
      await evaluate(`({name:document.getElementById('scene-name').textContent,
    canvas:document.getElementById('scene').toDataURL()})`),
      displayed,
    );
  });
  await test.step('Interrupted definition save and delete restore controls', async () => {
    // Pending definition mutations temporarily disable the form. Disposal must
    // restore its previous states now, before a replacement reuses the same DOM.
    for (const route of ['save-object-definition', 'delete-object-definition']) {
      await evaluate(`document.getElementById('manage-definitions').click();
      if(${JSON.stringify(route)}==='delete-object-definition') {
        const list=document.getElementById('definition-list');
        list.value=[...list.options].find(option=>option.textContent==='Interrupted definition save').value;
        list.dispatchEvent(new Event('change'));
      } else {
        document.getElementById('definition-name').value='Interrupted definition save';
        document.getElementById('definition-add-field').click();
        document.querySelector('.field-name').value='label';
      }
      window.__mutationHeld=false;
      window.fetch=async(...args)=>{
        const response=await window.__fetch(...args);
        if(String(args[0]).endsWith('/api/'+${JSON.stringify(route)})) {
          window.__mutationHeld=true;
          await new Promise(resolve=>{window.__releaseMutation=resolve});
        }
        return response;
      };`);
      const controlStates = `Array.from(document.querySelectorAll('#definition-form input, #definition-form button, #definition-form select, #definition-form textarea'), control=>control.disabled)`;
      const before = await evaluate(controlStates);
      await evaluate(
        route === 'save-object-definition'
          ? "document.getElementById('definition-save').click()"
          : `window.__confirm=window.confirm;window.confirm=()=>true;
           document.getElementById('definition-delete').click();window.confirm=window.__confirm`,
      );
      await wait('window.__mutationHeld');
      assert.equal(await evaluate(`(${controlStates}).every(Boolean)`), true);
      await evaluate('window.__mounted.dispose()');
      assert.deepEqual(await evaluate(controlStates), before);
      await evaluate(`window.fetch=window.__fetch;
      document.getElementById('status').textContent='Loading replacement';
      history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()`);
      await editorReady(page);
      await evaluate("document.getElementById('manage-definitions').click()");
      const replacementStates = await evaluate(controlStates);
      assert.equal(await evaluate("document.getElementById('definition-name').disabled"), false);
      assert.equal(await evaluate("document.getElementById('definition-kind').disabled"), false);
      assert.equal(await evaluate("document.getElementById('definition-save').disabled"), false);
      assert.equal(await evaluate("document.getElementById('definition-close').disabled"), false);
      await evaluate('window.__releaseMutation()');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await evaluate("document.getElementById('definitions-dialog').open"), true);
      assert.deepEqual(await evaluate(controlStates), replacementStates);
      await evaluate("document.getElementById('definition-close').click()");
      assert.equal(await evaluate("document.getElementById('definitions-dialog').open"), false);
    }
  });
  await test.step('Cancelled draft cleanup cannot resume project navigation', async () => {
    // Draft cleanup cancellation must stop both project-switch continuations.
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'beforeunload') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
    for (const action of ['switch-save', 'switch-discard']) {
      await evaluate(`document.getElementById('scenes').value=${JSON.stringify(scene)};
      document.getElementById('scenes').dispatchEvent(new Event('change'));`);
      await wait("document.getElementById('status').textContent === 'Scene opened.'");
      await evaluate(`document.getElementById('layer-name').value=${JSON.stringify(action)};
      document.getElementById('layer-name').dispatchEvent(new Event('change'));`);
      await wait(
        "document.getElementById('draft-status').textContent === 'Draft checkpoint saved'",
      );
      await evaluate(`(()=>{const projects=document.getElementById('switch-project');
      projects.add(new Option('Cancelled destination','/cancelled-project'));
      projects.value='/cancelled-project';projects.dispatchEvent(new Event('change'));
      window.__cleanupHeld=false;window.fetch=async(...args)=>{
      const response=await window.__fetch(...args);
      if(String(args[0]).endsWith('/api/delete-draft')) {
        window.__cleanupHeld=true;
        await new Promise(resolve=>{window.__releaseCleanup=resolve});
      }
      return response;
    };document.getElementById(${JSON.stringify(action)}).click();})()`);
      await wait('window.__cleanupHeld');
      const path = forge.url;
      await evaluate(`window.__mounted.dispose();window.fetch=window.__fetch;
      document.getElementById('status').textContent='Loading replacement';
      history.replaceState(history.state,'','/');window.__mounted=window.__module.mountProjectEditor()`);
      await editorReady(page);
      await evaluate(
        "document.getElementById('draft-status').textContent='Replacement draft status';window.__releaseCleanup()",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await evaluate('location.href'), path);
      assert.equal(
        await evaluate("document.getElementById('draft-status').textContent"),
        'Replacement draft status',
      );
      assert.equal(
        await evaluate("document.getElementById('status').textContent"),
        'Choose a scene, or import an atlas and create one.',
      );
    }
    await evaluate('window.__mounted.dispose()');
  });
});
