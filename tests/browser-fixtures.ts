/** Test-scoped project/server ownership; Playwright owns browser contexts/profiles. */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Forge = { root: string; url: string; python: string };

type Workspace = {
  folder: string;
  python: string;
  start(root: string, fixture?: boolean, single?: boolean, demo?: boolean): Promise<string>;
  stop(): Promise<void>;
};

export const test = base.extend<{
  projectMode: 'empty' | 'sample';
  workspace: Workspace;
  forge: Forge;
}>({
  projectMode: ['empty', { option: true }],
  // Playwright requires a destructured fixture parameter, even without dependencies.
  // eslint-disable-next-line no-empty-pattern
  workspace: async ({}, use, testInfo) => {
    const folder = await mkdtemp(join(tmpdir(), 'forge-playwright-'));
    const python = resolve(process.env.FORGE_TEST_PYTHON ?? '.venv/bin/python');
    let server: ReturnType<typeof spawn> | undefined;
    let logs = '';
    const stop = async () => {
      const child = server;
      if (child && child.exitCode === null && child.signalCode === null && child.pid) {
        await new Promise<void>((done) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
          child.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          child.kill('SIGINT');
        });
      }
      server = undefined;
    };
    const start: Workspace['start'] = async (
      root,
      fixture = false,
      single = true,
      demo = false,
    ) => {
      await stop();
      const args = demo
        ? ['-m', 'gbc_scene_forge.adapters.sample', '--root', root, '--reset', '--port', '0']
        : fixture
          ? [
              'tests/serve_standalone_fixture.py',
              '--root',
              root,
              ...(single ? ['--single-project'] : []),
            ]
          : [
              '-I',
              '-m',
              'gbc_scene_forge',
              '--no-browser',
              single ? '--project' : '--project-root',
              root,
              '--port',
              '0',
            ];
      const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      server = child;
      let startup = '';
      return await new Promise<string>((resolveUrl, reject) => {
        const timer = setTimeout(() => fail(Error(`Startup timed out: ${startup}`)), 10000);
        const cleanup = () => {
          clearTimeout(timer);
          child.off('error', fail);
          child.off('exit', exited);
        };
        const fail = (error: Error) => {
          cleanup();
          reject(error);
        };
        const exited = (code: number | null) => fail(Error(`Server exited (${code}): ${startup}`));
        const output = (data: Buffer) => {
          logs += data.toString();
          startup += data.toString();
          const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(startup);
          if (match) {
            cleanup();
            resolveUrl(match[1]);
          }
        };
        child.once('error', fail);
        child.once('exit', exited);
        child.stdout.on('data', output);
        child.stderr.on('data', output);
      });
    };
    try {
      await use({ folder, python, start, stop });
    } finally {
      await stop();
      await testInfo.attach('server.log', { body: logs, contentType: 'text/plain' });
      await rm(folder, { recursive: true, force: true });
    }
  },
  forge: async ({ projectMode, workspace }, use) => {
    const { folder, python } = workspace;
    const root = join(folder, projectMode === 'sample' ? 'world' : 'projects');
    if (projectMode === 'sample') {
      await promisify(execFile)(python, [
        '-I',
        '-c',
        'import sys; from pathlib import Path; from gbc_scene_forge.project.application import Project; Project.from_sample(Path(sys.argv[1]), title="Forest and village")',
        root,
      ]);
    }
    const url = await workspace.start(root, false, projectMode === 'sample');
    await use({ root, url, python });
  },
  page: async ({ page }, use, testInfo) => {
    const messages: string[] = [];
    const errors: string[] = [];
    const observe = (observed: Page) => {
      observed.on('dialog', (dialog) => {
        if (dialog.type() === 'beforeunload') {
          void dialog.accept();
        } else {
          void dialog.dismiss();
        }
      });
      observed.on('console', (message) => {
        messages.push(`${message.type()}: ${message.text()}`);
      });
      observed.on('pageerror', (error) => {
        errors.push(error.stack ?? error.message);
      });
    };
    observe(page);
    page.context().on('page', observe);
    try {
      await use(page);
      expect(errors, 'Uncaught browser errors').toEqual([]);
    } finally {
      await testInfo.attach('browser.log', {
        body: [...messages, ...errors].join('\n'),
        contentType: 'text/plain',
      });
    }
  },
});

/** A status label can appear before refresh has enabled the scene selector. */
export async function editorReady(page: Page): Promise<void> {
  await expect(page.locator('#status')).toHaveText(
    'Choose a scene, or import an atlas and create one.',
  );
  await expect(page.locator('#scenes')).toBeEnabled();
}

export async function paint(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.locator('#scene');
  const point = await canvas.evaluate(
    (element, position) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw Error('Expected scene canvas');
      }
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x + (position.x * bounds.width) / element.width,
        y: bounds.y + (position.y * bounds.height) / element.height,
      };
    },
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

/** Poll predicates through evaluate: string waitForFunction violates Forge's CSP. */
export async function waitForUI(page: Page, expression: string): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return Boolean(await page.evaluate(expression));
        } catch (error) {
          if (error instanceof Error && /context.*destroyed|navigation/i.test(error.message)) {
            return false;
          }
          throw error;
        }
      },
      { message: expression },
    )
    .toBe(true);
}

/** Native controls use real input/select events and Playwright actionability. */
export async function setControl(page: Page, id: string, value: string): Promise<void> {
  const control = page.locator('#' + id);
  if (!(await control.isVisible())) {
    const dialog = await control.evaluate((element) => element.closest('dialog')?.id);
    const triggers: Record<string, string> = {
      'create-scene-dialog': 'show-create',
      'import-atlas-dialog': 'library-import',
    };
    if (
      dialog &&
      triggers[dialog] &&
      !(await page
        .locator('#' + dialog)
        .evaluate((element) => element instanceof HTMLDialogElement && element.open))
    ) {
      await clickControl(page, triggers[dialog]);
    }
    const details = control.locator('xpath=ancestor::details[not(@open)]');
    for (const detail of await details.all()) {
      await detail.locator('summary').click();
    }
  }
  const tag = await control.evaluate((element) => element.tagName);
  if (tag === 'SELECT') {
    await control.selectOption(value);
  } else {
    await control.fill(value);
    await control.dispatchEvent('change');
  }
}

/** Canvas coordinates are authored pixels, independent of zoom and scrolling. */
export async function scenePoint(page: Page, x: number, y: number) {
  return await page.locator('#scene').evaluate(
    (element, point) => {
      if (!(element instanceof HTMLCanvasElement)) {
        throw Error('Expected scene canvas');
      }
      const canvas = element;
      const bounds = canvas.getBoundingClientRect();
      return {
        x: bounds.x + (point.x * bounds.width) / canvas.width,
        y: bounds.y + (point.y * bounds.height) / canvas.height,
      };
    },
    { x, y },
  );
}

/** Commands live in native popovers; enter through their visible trigger. */
export async function clickControl(page: Page, id: string): Promise<void> {
  const control = page.locator('#' + id);
  const panel = await control.evaluate((element) => element.closest('[role=tabpanel]')?.id);
  if (panel && !(await control.isVisible())) {
    await page.locator(`[aria-controls="${panel}"]`).click();
  }
  const details = control.locator('xpath=ancestor::details[not(@open)]');
  for (const detail of await details.all()) {
    await detail.locator('summary').click();
  }
  const popover = await control.evaluate((element) => element.closest('[popover]')?.id);
  if (popover && !(await control.isVisible())) {
    await page.locator(`[popovertarget="${popover}"]`).click();
  }
  await control.click();
}

export { expect };
