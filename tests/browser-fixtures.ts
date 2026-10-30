/** Test-scoped project/server ownership; Playwright owns browser contexts/profiles. */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Forge = { root: string; url: string; python: string };

export const test = base.extend<{ projectMode: 'empty' | 'sample'; forge: Forge }>({
  projectMode: ['empty', { option: true }],
  forge: async ({ projectMode }, use, testInfo) => {
    const folder = await mkdtemp(join(tmpdir(), 'forge-playwright-'));
    const root = join(folder, projectMode === 'sample' ? 'world' : 'projects');
    const python = resolve(process.env.FORGE_TEST_PYTHON ?? '.venv/bin/python');
    let logs = '';
    let server: ReturnType<typeof spawn> | undefined;
    try {
      if (projectMode === 'sample') {
        await promisify(execFile)(python, [
          '-I',
          '-c',
          'import sys; from pathlib import Path; from gbc_scene_forge.project.application import Project; Project.from_sample(Path(sys.argv[1]), title="Forest and village")',
          root,
        ]);
      }
      server = spawn(
        python,
        [
          '-I',
          '-m',
          'gbc_scene_forge',
          '--no-browser',
          projectMode === 'sample' ? '--project' : '--project-root',
          root,
          '--port',
          '0',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const child = server;
      const url = await new Promise<string>((resolveUrl, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(Error(`Startup timed out: ${logs}`));
        }, 10000);
        const fail = (error: Error) => {
          cleanup();
          reject(error);
        };
        const exit = (code: number | null) => fail(Error(`Server exited (${code}): ${logs}`));
        const output = (data: Buffer) => {
          logs += data.toString();
          const match = /Editor\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(logs);
          if (match) {
            cleanup();
            resolveUrl(match[1]);
          }
        };
        function cleanup() {
          clearTimeout(timer);
          child.off('error', fail);
          child.off('exit', exit);
          child.stdout?.off('data', output);
          child.stderr?.off('data', output);
        }
        child.once('error', fail);
        child.once('exit', exit);
        child.stdout?.on('data', output);
        child.stderr?.on('data', output);
      });
      // Keep post-startup server errors in failure evidence too.
      child.stdout?.on('data', (data: Buffer) => {
        logs += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        logs += data.toString();
      });
      await use({ root, url, python });
    } finally {
      if (server && server.exitCode === null && server.signalCode === null && server.pid) {
        const child = server;
        await new Promise<void>((done) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
          }, 5000);
          child.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          child.kill('SIGINT');
        });
      }
      await testInfo.attach('server.log', { body: logs, contentType: 'text/plain' });
      await rm(folder, { recursive: true, force: true });
    }
  },
  page: async ({ page }, use, testInfo) => {
    const messages: string[] = [];
    const errors: string[] = [];
    page.on('console', (message) => {
      messages.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      errors.push(error.stack ?? error.message);
    });
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
