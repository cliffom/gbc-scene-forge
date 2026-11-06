/** Layer sources, wheel navigation and isolated local history in the real editor. */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, activateScene } from '../support/browser-fixtures.ts';
import {
  revealArtworkControl,
  saveArtwork,
  activeArtworkLayer,
  selectArtworkLayer,
  renameArtworkLayer,
} from '../support/artwork-controls.ts';

test('saving new artwork with automatic refresh disabled keeps its saved status', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    'from pathlib import Path; import sys; from gbc_scene_forge.project.application import Project; Project.create(Path(sys.argv[1]), "Local artwork save")',
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('#project-commands').click();
  await page.locator('#auto-refresh').uncheck();
  await page.locator('#project-command-panel').evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.hidePopover();
    }
  });
  await page.locator('#show-artwork').click();
  await page.locator('#art-name').fill('Local picture');
  await page.locator('#art-create').click();
  await page.locator('#art-canvas').click({ position: { x: 10, y: 10 } });
  await saveArtwork(page);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await expect(page.locator('#art-sync')).toBeHidden();
  await expect(page.locator('#undo')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('local-save-refresh-disabled.png') });
});

test('layer list separates selection and rename, preserves byte opacity, and isolates documents', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Layer fields')
a=p.artwork.documents
items=[{**layers.item('Base'),'opacity':127},layers.item('Overlay')]
for key in ['picture','other']:
    c=a.create(key,key,'sprite',16,16,p.catalog()['revision'])
    a.save(layers.edit(c,items))
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  const names = page.locator('.art-layer-select');
  const opacity = page.locator('#art-layer-opacity');
  const range = page.locator('#art-layer-opacity-range');
  await expect(names).toHaveText(['Overlay', 'Base']);
  await selectArtworkLayer(page, 'Overlay');
  await selectArtworkLayer(page, 'Base');
  await expect(page.locator('#art-layer-name')).toHaveCount(0);
  await expect(opacity).toHaveValue('50');
  await opacity.focus();
  await opacity.press('Enter');
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#document-state')).toHaveText('Saved');
  const choice = activeArtworkLayer(page).locator('.art-layer-select');
  await choice.dblclick();
  const name = page.locator('#art-layer-name');
  await name.fill(' Canceled ');
  // Unrelated redraws must preserve the same editing input and pending text.
  await page.locator('#art-canvas').dispatchEvent('pointerleave');
  await expect(name).toHaveValue(' Canceled ');
  await name.press('Escape');
  await expect(choice).toHaveText('Base');
  await expect(choice).toBeFocused();
  await choice.press('F2');
  await name.fill(' Renamed ');
  await name.press('Enter');
  await expect(choice).toHaveText('Renamed');
  await expect(choice).toBeFocused();
  await choice.press('F2');
  await name.fill('   ');
  await name.press('Enter');
  await expect(page.locator('#art-layer-status')).toContainText('name is required');
  await expect(choice).toHaveText('Renamed');
  await opacity.fill('101');
  await opacity.press('Enter');
  await expect(opacity).toHaveValue('50');
  await expect(page.locator('#art-layer-status')).toContainText('0 to 100');
  await opacity.fill('22');
  await opacity.press('Escape');
  await expect(opacity).toHaveValue('50');
  await opacity.fill('63');
  await opacity.press('Enter');
  await expect(range).toHaveValue('63');
  await page.locator('#undo').click();
  await expect(opacity).toHaveValue('50');
  await range.fill('40');
  await range.dispatchEvent('change');
  await expect(opacity).toHaveValue('40');
  await page.locator('#undo').click();
  await expect(opacity).toHaveValue('50');
  await page.locator('#undo').click();
  await expect(choice).toHaveText('Base');
  await expect(page.locator('#document-state')).toHaveText('Saved');
  // Rename commits on blur, including when leaving for another document.
  await choice.dblclick();
  await name.fill('First document');
  await page.locator('[data-asset="other/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toHaveText('Base');
  await expect(opacity).toHaveValue('50');
  await expect(page.locator('#art-layer-name')).toHaveCount(0);
  await expect(page.locator('#document-state')).toHaveText('Saved');
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toHaveText('First document');
  await saveArtwork(page);
  const saved: unknown = JSON.parse(
    execFileSync(
      workspace.python,
      [
        '-I',
        '-c',
        `
import sys,json
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
d=p.artwork.documents.list(p.catalog()['revision'])['documents'][0]
c=p.artwork.documents.open(d['target'],p.catalog()['revision'],d['artwork_revision'])
print(json.dumps(c['descriptor']['layers']['items']))
`,
        root,
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(saved).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'First document', opacity: 127 })]),
  );
  await revealArtworkControl(page, 'art-layer-list');
  await page.screenshot({ path: info.outputPath('layer-list-desktop.png') });
});

test('layer ordering commits once, cancels cleanly, preserves selection and survives save/recovery', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Layer ordering')
a=p.artwork.documents
c=a.create('picture','Picture','sprite',16,16,p.catalog()['revision'])
items=[layers.item('Base'),layers.item('Middle'),layers.item('Front')]
c=layers.edit(c,items)
c=layers.reseal(c,{item['id']:bytes(color)*256 for item,color in zip(items,[[255,0,0,255],[0,255,0,255],[0,0,255,255]])})
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await selectArtworkLayer(page, 'Middle');
  const identity = await activeArtworkLayer(page).getAttribute('data-layer-id');
  const names = page.locator('.art-layer-select');
  const grip = page.getByRole('button', { name: 'Reorder Middle', exact: true });
  await page.locator('#art-grid').uncheck();
  await page.locator('#art-zoom').selectOption('1');
  const pixel = () =>
    page.locator('#art-canvas').evaluate((node) => {
      if (!(node instanceof HTMLCanvasElement)) {
        throw Error('Expected canvas');
      }
      return [...(node.getContext('2d')?.getImageData(4, 4, 1, 1).data ?? [])];
    });
  expect(await pixel()).toEqual([0, 0, 255, 255]);
  await grip.focus();
  await grip.press('Alt+ArrowUp');
  await expect(names).toHaveText(['Middle', 'Front', 'Base']);
  await expect(grip).toBeFocused();
  expect(await pixel()).toEqual([0, 255, 0, 255]);
  await expect(activeArtworkLayer(page)).toHaveAttribute('data-layer-id', identity ?? '');
  await page.locator('#undo').click();
  await expect(names).toHaveText(['Front', 'Middle', 'Base']);
  await expect(page.locator('#undo')).toBeDisabled();
  const start = await grip.boundingBox();
  const end = await page.locator('.art-layer-row').first().boundingBox();
  if (!start || !end) {
    throw Error('Missing layer bounds');
  }
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, end.y + 2, { steps: 5 });
  await expect(page.locator('#art-layer-list')).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(names).toHaveText(['Front', 'Middle', 'Base']);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, end.y + 2, { steps: 5 });
  await page.mouse.up();
  await expect(names).toHaveText(['Middle', 'Front', 'Base']);
  await expect(activeArtworkLayer(page)).toHaveAttribute('data-layer-id', identity ?? '');
  await page.locator('#undo').click();
  await expect(names).toHaveText(['Front', 'Middle', 'Base']);
  await expect(page.locator('#undo')).toBeDisabled();
  // A locked row cannot move, and other layers cannot cross its stored position.
  await page.getByRole('button', { name: 'Lock Front', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reorder Front', exact: true })).toBeDisabled();
  await grip.press('Alt+ArrowUp');
  await expect(names).toHaveText(['Front', 'Middle', 'Base']);
  await expect(page.locator('#art-message')).toContainText('Unlock');
  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();
  await grip.focus();
  await grip.press('Alt+ArrowUp');
  await expect(names).toHaveText(['Middle', 'Front', 'Base']);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.reload();
  await page.locator('#show-artwork').click();
  await revealArtworkControl(page, 'art-drafts');
  await page.locator('#art-drafts button').filter({ hasText: 'Recover copy' }).first().click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(names).toHaveText(['Middle', 'Front', 'Base']);
  await saveArtwork(page);
  await page.reload();
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(names).toHaveText(['Middle', 'Front', 'Base']);
  await page.screenshot({ path: info.outputPath('layer-stack-desktop.png') });
  await page.locator('#art-layer-add').click();
  await expect(page.locator('#art-layer-name')).toBeFocused();
  await page.locator('#art-layer-name').fill('Long layer name for checking the narrow Inspector');
  await page.locator('#art-layer-name').press('Enter');
  await page.locator('#art-layer-remove').click();
  await expect(names).toHaveCount(3);
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toBeFocused();
  await page.locator('#undo').click();
  await expect(names).toHaveCount(4);
  await expect(page.locator('#art-layer-status')).toBeEmpty();
  for (let i = 4; i < 8; i++) {
    await page.locator('#art-layer-add').click();
    await page.locator('#art-layer-name').press('Enter');
  }
  await expect(page.locator('#art-layer-add')).toBeDisabled();
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 800, height: 640 },
    { width: 1440, height: 600 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('#art-layer-add').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(
      await page.locator('#art-layer-list').evaluate((n) => n.scrollHeight > n.clientHeight),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('layer-list-' + size.width + 'x' + size.height + '.png'),
    });
    if (size.width === 800) {
      await page.locator('#art-layer-opacity').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('layer-opacity-compact.png') });
    }
  }
});

test('layer visibility and locking apply immediately, undo independently, and survive saving', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers
p=Project.create(Path(sys.argv[1]),'Layer visibility')
a=p.artwork.documents
c=a.create('picture','Picture','sprite',16,16,p.catalog()['revision'])
c=a.edit(c,[dict(x=x,y=y,rgba=[255,0,0,255]) for y in range(16) for x in range(16)])
base=layers.item('Base')
base['locked']=True
c=layers.edit(c,[base,layers.item('Overlay')])
a.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-zoom').selectOption('1');
  await page.locator('#art-grid').uncheck();
  await revealArtworkControl(page, 'art-layer-list');
  const visible = activeArtworkLayer(page).locator('.art-layer-visible');
  const locked = activeArtworkLayer(page).locator('.art-layer-lock');
  const pixel = () =>
    page.locator('#art-canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw Error('Expected artwork canvas');
      }
      return [...(canvas.getContext('2d')?.getImageData(4, 4, 1, 1).data ?? [])];
    });
  await expect(locked).toHaveAttribute('aria-pressed', 'true');
  await expect(visible).toBeDisabled();
  await expect(page.locator('#art-layer-opacity')).toBeDisabled();
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  await locked.click();
  await expect(visible).toBeEnabled();
  await visible.click();
  expect(await pixel()).toEqual([0, 0, 0, 0]);
  await page.locator('#undo').click();
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  await expect(locked).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#undo').click();
  await expect(locked).toHaveAttribute('aria-pressed', 'true');
  await expect(visible).toBeDisabled();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#redo').click();
  await page.locator('#redo').click();
  await expect(visible).toHaveAttribute('aria-pressed', 'false');
  expect(await pixel()).toEqual([0, 0, 0, 0]);
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.screenshot({ path: info.outputPath('hidden-layer.png') });
  await saveArtwork(page);
  await page.reload();
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(visible).toHaveAttribute('aria-pressed', 'false');
  await expect(locked).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await visible.click();
  await locked.click();
  await expect(visible).toBeDisabled();
  await page.locator('#undo').click();
  await expect(visible).toBeEnabled();
  await expect(locked).toHaveAttribute('aria-pressed', 'false');
  await expect(visible).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('visible-layer.png') });
});

test('wheel zoom preserves pointer coordinates and layers survive local undo, save and reopen', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  execFileSync(workspace.python, [
    '-I',
    '-c',
    `
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Iteration')
c=p.artwork.documents.create('picture','Picture','sprite',375,525,p.catalog()['revision'])
p.artwork.documents.save(c)
`,
    root,
  ]);
  await page.goto(await workspace.start(root));
  await page.locator('[data-asset="picture/artwork"]').click();
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await page.locator('#art-zoom').selectOption('2');
  const viewport = page.locator('#art-viewport');
  await viewport.evaluate((n) => n.scrollBy(40, 25));
  const box = await viewport.boundingBox();
  if (!box) {
    throw Error('Expected viewport');
  }
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const anchor = async () => {
    const canvas = await page.locator('#art-canvas').boundingBox();
    if (!canvas) {
      throw Error('Expected canvas');
    }
    return [(pointer.x - canvas.x) / canvas.width, (pointer.y - canvas.y) / canvas.height];
  };
  await page.mouse.move(pointer.x, pointer.y);
  const before = await anchor();
  await page.mouse.wheel(0, -100);
  await expect(page.locator('#art-zoom')).toHaveValue('4');
  const after = await anchor();
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.002);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.002);
  await page.mouse.wheel(0, 100);
  await expect(page.locator('#art-zoom')).toHaveValue('2');
  const minimum = await page.locator('#art-zoom option').first().getAttribute('value');
  if (!minimum) {
    throw Error('Expected supported zoom');
  }
  await page.locator('#art-zoom').selectOption(minimum);
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('#art-zoom')).toHaveValue(minimum);
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#art-zoom').selectOption('2');
  await (await revealArtworkControl(page, 'art-layer-add')).click();
  await expect(page.locator('.art-layer-select')).toHaveCount(2);
  await page.locator('#art-layer-name').fill(' Glow ');
  await page.locator('#art-layer-name').press('Enter');
  await page.locator('#art-layer-opacity').fill('50');
  await page.locator('#art-layer-opacity').press('Enter');
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toHaveText('Glow');
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await renameArtworkLayer(page, '   ');
  await expect(page.locator('#art-layer-status')).toContainText('name is required');
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toHaveText('Glow');
  await page.locator('#art-color').fill('#ff0000');
  await page.locator('#art-canvas').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('#art-document-state')).toHaveText('Modified');
  await page.locator('#undo').click();
  await page.locator('#redo').click();
  await activeArtworkLayer(page).locator('.art-layer-lock').click();
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  // Several local Undo steps can coalesce before their next durable checkpoint.
  for (let i = 0; i < 4; i++) {
    await page.locator('#undo').click();
  }
  await expect(activeArtworkLayer(page).locator('.art-layer-select')).toHaveText('Layer');
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  for (let i = 0; i < 4; i++) {
    await page.locator('#redo').click();
  }
  await expect(activeArtworkLayer(page).locator('.art-layer-lock')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#art-draft-status')).toContainText('checkpointed');
  await page.screenshot({ path: info.outputPath('layers-and-wheel.png') });
  await saveArtwork(page);
  await page.reload();
  await page.locator('[data-asset="picture/artwork"]').click();
  await revealArtworkControl(page, 'art-layer-list');
  await expect(page.locator('.art-layer-select')).toHaveText(['Glow', 'Base']);
  const red = page.locator('#art-swatches button[data-rgba="255,0,0,255"]');
  await page.locator('#art-palette-toggle').click();
  await page.getByRole('tab', { name: 'Selected layer', exact: true }).click();
  await expect(red).toHaveCount(0);
  await page.keyboard.press('Escape');
  await selectArtworkLayer(page, 'Glow');
  await page.locator('#art-palette-toggle').click();
  await expect(red).toHaveCount(1);
  await page.keyboard.press('Escape');
  await selectArtworkLayer(page, 'Base');
  await page.locator('#art-palette-toggle').click();
  await expect(red).toHaveCount(0);
  await page.keyboard.press('Escape');
  await selectArtworkLayer(page, 'Glow');
  await page.locator('#art-palette-toggle').click();
  await expect(red).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#art-layer-opacity')).toHaveValue('50');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(page.locator('#art-layer-opacity')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('layers-compact.png') });
});

test('interrupted saved discovery retries the source inventory without another save', async ({
  page,
  workspace,
}) => {
  const root = join(workspace.folder, 'project');
  const update = (code: string) => execFileSync(workspace.python, ['-I', '-c', code, root]);
  update(`
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project.create(Path(sys.argv[1]),'Discovery')
c=p.artwork.documents.create('local','Local','sprite',16,16,p.catalog()['revision'])
p.artwork.documents.save(c)
`);
  await page.goto(await workspace.start(root));
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await expect(page.locator('#art-source option')).toHaveCount(1);
  await expect(page.locator('#art-open')).toBeEnabled();
  await page.locator('#project-name').click();
  let releaseInventory = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseInventory = resolve;
  });
  let inventoryRequested = () => {};
  const requested = new Promise<void>((resolve) => {
    inventoryRequested = resolve;
  });
  await page.route(
    '**/api/artwork-list',
    async (route) => {
      const response = await route.fetch();
      inventoryRequested();
      await responseGate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  update(`
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
c=p.artwork.documents.create('agent','Agent','sprite',16,16,p.catalog()['revision'])
p.artwork.documents.save(c)
`);
  try {
    await requested;
    await expect(page.locator('[data-asset="agent/artwork"]')).toBeVisible();
    // Invalidate the in-flight response, then leave the editor eligible to retry.
    await page.keyboard.press('Shift');
  } finally {
    releaseInventory();
  }
  await expect(page.locator('#art-source option')).toHaveText([
    'local / artwork (editable)',
    'agent / artwork (editable)',
  ]);
  await page.locator('#art-source').selectOption({ label: 'agent / artwork (editable)' });
  await page.locator('#art-open').click();
  await expect(page.locator('#artwork-heading')).toHaveText('Agent');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
});

test('discovery enables the first saved source and disables it after manual deletion refresh', async ({
  page,
  workspace,
}, info) => {
  const root = join(workspace.folder, 'project');
  const update = (code: string) => execFileSync(workspace.python, ['-I', '-c', code, root]);
  update(`
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
Project.create(Path(sys.argv[1]),'First artwork')
`);
  await page.goto(await workspace.start(root));
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await expect(page.locator('#art-source')).toBeDisabled();
  await expect(page.locator('#art-open')).toBeDisabled();
  await page.locator('#art-name').fill('My independent copy');
  await (await revealArtworkControl(page, 'art-id')).fill('my_copy');
  await page.locator('#project-name').click();
  update(`
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
c=p.artwork.documents.create('agent','Agent','sprite',16,16,p.catalog()['revision'])
p.artwork.documents.save(c)
`);
  await expect(page.locator('[data-asset="agent/artwork"]')).toBeVisible();
  await expect(page.locator('#art-source option')).toHaveText(['agent / artwork (editable)']);
  await expect(page.locator('#art-source')).toBeEnabled();
  await expect(page.locator('#art-open')).toBeEnabled();
  await expect(page.locator('#art-duplicate')).toBeEnabled();
  await expect(page.locator('#art-name')).toHaveValue('My independent copy');
  await expect(page.locator('#art-id')).toHaveValue('my_copy');
  await expect(page.locator('#art-source-help')).toContainText('Edit the shared original');
  await page.screenshot({ path: info.outputPath('first-source-discovered.png') });
  await page.locator('#art-open').click();
  await expect(page.locator('#artwork-heading')).toHaveText('Agent');
  await expect(page.locator('#art-document-state')).toHaveText('Saved');
  await activateScene(page);
  await page.locator('#project-commands').click();
  await page.locator('#auto-refresh').uncheck();
  await page.locator('#show-artwork').click();
  await page.locator('#art-existing-mode').click();
  await expect(page.locator('#art-open')).toBeEnabled();
  update(`
import sys
from pathlib import Path
from gbc_scene_forge.project.application import Project
p=Project(Path(sys.argv[1]))
p.artwork.delete_atlas('agent',p.catalog()['revision'])
`);
  await page.locator('#project-commands').click();
  await page.locator('#check-external').click();
  await expect(page.locator('[data-asset="agent/artwork"]')).toHaveCount(0);
  await expect(page.locator('#art-source')).toBeDisabled();
  await expect(page.locator('#art-open')).toBeDisabled();
  await expect(page.locator('#art-duplicate')).toBeDisabled();
});
