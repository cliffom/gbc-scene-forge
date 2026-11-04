import { revealArtworkControl, reviewArtwork, saveArtwork } from '../support/artwork-controls.ts';
/** Actual optional-SDK stdio writes alternate with browser artwork edits and conflicts. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { record, array, string } from '../../../frontend/shared/decode.mts';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';
import { expect } from '@playwright/test';
import { test, chooseSavedScene, activateScene } from '../support/browser-fixtures.ts';

test('mcp: artwork brief, hand edits, agent revision, selected sprite variation and conflict recovery', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'projects'),
    output = join(workspace.folder, 'reviews');
  const python = process.env.FORGE_MCP_PYTHON || '.venv/bin/python';
  const run = async (extra: string[] = []) => {
    const result = await promisify(execFile)(python, [
      'examples/mcp/artwork_workshop.py',
      '--root',
      root,
      '--output',
      output,
      ...extra,
    ]);
    return record(JSON.parse(result.stdout));
  };
  const seed = await run();
  const url = await workspace.start(string(seed.project), false, true);
  const catalog = async () =>
    record(await (await page.request.get(new URL('api/project', url).href)).json());
  const post = async (action: string, data: unknown) => {
    const response = await page.request.post(new URL('api/artwork-' + action, url).href, {
      data,
      headers: { 'X-Scene-Token': string((await catalog()).token) },
    });
    assert.equal(response.status(), 200, await response.text());
    return record(await response.json());
  };
  const open = async (atlas: string) => {
    const revision = (await catalog()).revision;
    const inventory = await post('list', { project_revision: revision });
    const item = array(inventory.documents, record).find(
      (d) => record(d.target).atlas_id === atlas,
    );
    assert.ok(item);
    return decodeCandidate(
      await post('open', {
        target: item.target,
        project_revision: revision,
        artwork_revision: item.artwork_revision,
      }),
    );
  };
  const editMoss = async () => {
    await page.locator('#show-artwork').click();
    await page.locator('#art-existing-mode').click();
    await page.locator('#art-source').selectOption({ label: 'moss / artwork (editable)' });
    await page.locator('#art-open').click();
  };
  const dab = async (color: string) => {
    await page.locator('#art-color').fill(color);
    const canvas = page.locator('#art-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    assert.ok(box);
    const zoom = Number(await page.locator('#art-zoom').inputValue());
    await page.mouse.click(box.x + zoom / 2, box.y + zoom / 2);
  };
  await page.goto(url);
  await expect(page.locator('#scenes')).toBeEnabled();
  await chooseSavedScene(page, string(seed.scene_id));
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  const originalLantern = await open('lantern');
  await editMoss();
  await dab('#92a15a');
  await page.locator('#art-undo').click();
  await page.locator('#art-redo').click();
  await reviewArtwork(page);
  await saveArtwork(page);
  await activateScene(page);
  await expect(page.locator('#artwork-surface')).not.toBeVisible();
  const writes = join(output, 'revision-writes.json');
  await writeFile(writes, JSON.stringify([{ x: 7, y: 7, rgba: [180, 156, 78, 255] }]));
  await run(['--asset', 'moss', '--writes', writes]);
  const mixed = new PixelModel(await open('moss'));
  assert.deepEqual(mixed.color({ x: 0, y: 0 }), [146, 161, 90, 255]);
  assert.deepEqual(mixed.color({ x: 7, y: 7 }), [180, 156, 78, 255]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await writeFile(writes, JSON.stringify([{ x: 7, y: 7, rgba: [100, 210, 220, 255] }]));
  await run([
    '--asset',
    'lantern',
    '--variation',
    'cool_lantern',
    '--object',
    '1',
    '--writes',
    writes,
  ]);
  assert.equal((await open('lantern')).rgba, originalLantern.rgba);
  const saved = record(
    await (await page.request.get(new URL(`api/scene/${string(seed.scene_id)}`, url).href)).json(),
  );
  const objects = array(record(saved.scene).layers, record).flatMap((l) =>
    array(l.objects ?? [], record),
  );
  assert.equal(objects.find((o) => o.id === 1)?.asset, 'cool_lantern/artwork');
  assert.equal(objects.find((o) => o.id === 2)?.asset, 'lantern/artwork');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await editMoss();
  await dab('#aa1133');
  await reviewArtwork(page);
  await expect(page.locator('#art-save')).toBeEnabled();
  await writeFile(writes, JSON.stringify([{ x: 6, y: 6, rgba: [90, 130, 80, 255] }]));
  await run(['--asset', 'moss', '--writes', writes]);
  await page.locator('#art-save').click();
  await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
  await page.screenshot({ path: info.outputPath('mixed-writer-conflict.png') });
  await activateScene(page);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Scene opened.');
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.getByRole('button', { name: 'Recover copy', exact: true }).click();
  await expect(page.locator('#art-message')).toContainText('Local pixels are retained');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await (await download).saveAs(info.outputPath('conflicting-artwork-draft.json'));
  assert.deepEqual(new PixelModel(await open('moss')).color({ x: 0, y: 0 }), [146, 161, 90, 255]);
  // Verify the final mixed result survives a portable project ZIP and fresh reopen.
  await promisify(execFile)(workspace.python, [
    '-c',
    `
import io,sys,zipfile
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]));raw,_=p.export_bundle('project',p.catalog()['revision'])
out=Path(sys.argv[2]);zipfile.ZipFile(io.BytesIO(raw)).extractall(out)
q=Project(out)
assert q.scenes.load(sys.argv[3])['scene']==p.scenes.load(sys.argv[3])['scene']
assert len(q.artwork.documents.list(q.catalog()['revision'])['documents'])==3
`,
    string(seed.project),
    join(workspace.folder, 'exported'),
    string(seed.scene_id),
  ]);
});

test('mcp: identical sheet outcomes through browser-only, SDK-only and mixed authoring', async ({
  page,
  workspace,
}) => {
  const results: ReturnType<typeof decodeCandidate>[] = [];
  const baseline = join(workspace.folder, 'baseline');
  await promisify(execFile)(workspace.python, [
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Equivalent outcomes')
a=p.artwork.documents
frames=[dict(id=k,name=k,kind='sprite',x=i*8,y=0,width=8,height=8,origin=[3,5]) for i,k in enumerate(['idle','step'])]
s=[dict(id='walk',name='Walk',loop=False,frames=[dict(frame_id=k,duration_ms=d) for k,d in [('idle',120),('step',240)]])]
c=a.create_sheet('player','Player','sprite',16,8,p.catalog()['revision'],frames=frames,sequences=s)
c=a.edit(c,[dict(x=0,y=0,rgba=[41,52,63,0])])
a.save(c,receipt=p.artwork.reviews.animation(c,'walk',scale=1)['receipt'])
`,
    baseline,
  ]);
  for (const mode of ['browser', 'sdk', 'mixed']) {
    const root = join(workspace.folder, mode);
    await cp(baseline, root, { recursive: true });
    const url = await workspace.start(root);
    await page.goto(url);
    await page.locator('[data-asset="player/idle"]').click();
    if (mode !== 'sdk') {
      await page.locator('#art-color').fill('#ddaa77');
      const canvas = await page.locator('#art-canvas').boundingBox();
      assert.ok(canvas);
      const zoom = Number(await page.locator('#art-zoom').inputValue());
      await page.mouse.click(canvas.x + 1.5 * zoom, canvas.y + 1.5 * zoom);
      if (mode === 'browser') {
        await revealArtworkControl(page, 'art-play');
        const duration = page.getByLabel('Frame 1 duration in milliseconds', { exact: true });
        await duration.fill('333');
        await duration.press('Tab');
      }
      await reviewArtwork(page);
      await saveArtwork(page);
    }
    await activateScene(page);
    const result = await promisify(execFile)(process.env.FORGE_MCP_PYTHON || '.venv/bin/python', [
      '-c',
      `
import asyncio,copy,json,os,sys
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
async def main():
    params=StdioServerParameters(command=sys.executable,args=['-m','gbc_scene_forge.mcp_server','--project',sys.argv[1]],env=dict(os.environ))
    async with stdio_client(params) as (read,write), ClientSession(read,write) as client:
        await client.initialize()
        async def call(name,**args):
            r=await client.call_tool(name,dict(project='project',**args))
            assert not r.isError,r.content
            return r.structuredContent
        async def opened():
            p=await call('get_project')
            d=(await call('list_artwork',project_revision=p['revision']))['documents'][0]
            return await call('open_artwork',target=d['target'],project_revision=p['revision'],artwork_revision=d['artwork_revision'])
        c=await opened()
        if sys.argv[2]!='browser':
            if sys.argv[2]=='sdk':
                c=await call('edit_artwork_pixels',candidate=c,writes=[dict(x=1,y=1,rgba=[221,170,119,255])])
            sequences=copy.deepcopy(c["descriptor"]["sequences"])
            sequences[0]['frames'][0]['duration_ms']=333
            c=await call('edit_artwork_layout',candidate=c,frames=c['descriptor']['frames'],sequences=sequences)
            review=await call('review_artwork_animation',candidate=c,sequence_id='walk',scale=1)
            await call('commit_artwork',candidate=c,receipt=review['receipt'])
        print(json.dumps(await opened()))
asyncio.run(main())
`,
      root,
      mode,
    ]);
    const saved = decodeCandidate(JSON.parse(result.stdout));
    assert.deepEqual(new PixelModel(saved).color({ x: 0, y: 0 }), [41, 52, 63, 0]);
    assert.deepEqual(new PixelModel(saved).color({ x: 1, y: 1 }), [221, 170, 119, 255]);
    assert.equal(saved.descriptor.version, 2);
    if (saved.descriptor.version !== 2) {
      throw Error('Expected sheet');
    }
    assert.equal(saved.descriptor.sequences[0].frames[0].duration_ms, 333);
    assert.equal(saved.descriptor.sequences[0].loop, false);
    results.push(saved);
    // Reopen the saved SDK/browser result through the actual Library/frame route.
    await page.reload();
    await page.locator('[data-asset="player/idle"]').click();
    await revealArtworkControl(page, 'art-play');
    await expect(page.getByLabel('Frame 1 duration in milliseconds', { exact: true })).toHaveValue(
      '333',
    );
  }
  for (const saved of results.slice(1)) {
    assert.equal(saved.rgba, results[0].rgba);
    assert.deepEqual(saved.descriptor, results[0].descriptor);
  }
});
