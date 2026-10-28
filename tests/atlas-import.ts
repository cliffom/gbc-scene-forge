import assert from 'node:assert/strict';
import { test } from 'node:test';
import { folderFromFiles, readBundle, relativeParts } from '../frontend/atlas-import.mts';

function file(path: string, content: string) {
  const result = new File([content], path.split('/').at(-1) || 'file');
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}
await test('folder import lists manifests and reads only the selected bundle with nested PNG paths', async () => {
  const folder = folderFromFiles([
    file('Art/props/one.atlas.json', JSON.stringify({ png: 'images/atlas.png' })),
    file('Art/props/images/atlas.png', 'PNG bytes'),
    file('Art/two.atlas.json', JSON.stringify({ png: 'another.png' })),
    file('Art/source.aseprite', 'unneeded source'),
  ]);
  assert.equal(folder.name, 'Art');
  assert.deepEqual(folder.manifests, ['props/one.atlas.json', 'two.atlas.json']);
  const bundle = await readBundle(folder, 'props/one.atlas.json');
  assert.equal(bundle.name, 'one.atlas.json');
  assert.equal(atob(bundle.png), 'PNG bytes');
  assert.equal(bundle.manifest, JSON.stringify({ png: 'images/atlas.png' }));
  await assert.rejects(readBundle(folder, 'two.atlas.json'), /Missing or unreadable atlas PNG/);
});
await test('folder import rejects escaping paths and missing or ambiguous selections', async () => {
  for (const path of [
    '../atlas.png',
    '/atlas.png',
    'C:atlas.png',
    'images\\atlas.png',
    './atlas.png',
  ]) {
    assert.throws(() => relativeParts(path), /inside the manifest folder/);
    const folder = folderFromFiles([file('Art/one.atlas.json', JSON.stringify({ png: path }))]);
    await assert.rejects(readBundle(folder, 'one.atlas.json'), /inside the manifest folder/);
  }
  assert.throws(
    () => folderFromFiles([file('A/file.png', ''), file('B/file.png', '')]),
    /one atlas folder/,
  );
  assert.throws(
    () => folderFromFiles([file('A/file.png', ''), file('A/file.png', '')]),
    /Duplicate/,
  );
  const folder = folderFromFiles([file('Art/one.atlas.json', '{}')]);
  await assert.rejects(readBundle(folder, '../one.atlas.json'));
  await assert.rejects(readBundle(folder, 'missing.atlas.json'));
});
await test('folder import enforces manifest and PNG size bounds before upload', async () => {
  const hugeManifest = folderFromFiles([file('Art/one.atlas.json', 'x'.repeat(1024 * 1024 + 1))]);
  await assert.rejects(readBundle(hugeManifest, 'one.atlas.json'), /manifest exceeds/);
  const hugePng = folderFromFiles([
    file('Art/one.atlas.json', JSON.stringify({ png: 'atlas.png' })),
    file('Art/atlas.png', 'x'.repeat(4 * 1024 * 1024 + 1)),
  ]);
  await assert.rejects(readBundle(hugePng, 'one.atlas.json'), /PNG exceeds/);
});
