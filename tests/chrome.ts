/** Minimal checked CDP transport for real-browser acceptance tests. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { number, record, string } from '../frontend/shared/decode.mts';
import { errorDetails } from '../frontend/shared/errors.mts';

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    ) {
      return;
    }
    await delay(100);
  }
  throw Error(`Fixture server did not become ready: ${url}`);
}

export class Chrome {
  session: string | null = null;
  errors: string[] = [];
  acceptBeforeUnload = false;
  private browser: ChildProcess;
  private profile: string;
  private input: Writable;
  private pending = new Map<number, Pending>();
  private serial = 0;
  private buffer = '';
  private stderr = '';
  private stopped = false;

  private constructor(browser: ChildProcess, profile: string) {
    this.browser = browser;
    this.profile = profile;
    const input = browser.stdio[3],
      output = browser.stdio[4];
    assert(input instanceof Writable && output instanceof Readable && browser.stderr);
    this.input = input;
    browser.stderr.on('data', (data: Buffer) => {
      this.stderr += data.toString();
    });
    output.on('data', (chunk: Buffer) => this.receive(chunk));
    browser.on('error', (error) => {
      this.stopped = true;
      for (const job of this.pending.values()) {
        clearTimeout(job.timer);
        job.reject(error);
      }
      this.pending.clear();
    });
    // macOS Chrome helpers can inherit the stderr pipe after the browser exits.
    // Release our pipe handles so those helpers cannot stall fixture teardown.
    browser.once('exit', () => {
      input.destroy();
      output.destroy();
      browser.stderr?.destroy();
    });
    browser.once('close', () => {
      this.stopped = true;
      for (const job of this.pending.values()) {
        clearTimeout(job.timer);
        job.reject(Error(`Chrome closed: ${this.stderr.slice(-1500)}`));
      }
      this.pending.clear();
    });
  }

  static async launch(executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') {
    const profile = await mkdtemp(join(tmpdir(), 'forge-fixture-chrome-'));
    const browser = spawn(
      executable,
      [
        '--headless',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--remote-debugging-pipe',
        `--user-data-dir=${profile}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
    );
    return new Chrome(browser, profile);
  }

  private receive(chunk: Buffer) {
    this.buffer += chunk.toString();
    for (;;) {
      const end = this.buffer.indexOf('\0');
      if (end < 0) {
        break;
      }
      const event = record(JSON.parse(this.buffer.slice(0, end)));
      this.buffer = this.buffer.slice(end + 1);
      if (typeof event.id === 'number') {
        const job = this.pending.get(event.id);
        if (job) {
          this.pending.delete(event.id);
          clearTimeout(job.timer);
          if (event.error) {
            job.reject(Error(JSON.stringify(event.error)));
          } else {
            job.resolve(record(event.result));
          }
        }
      }
      if (
        event.method === 'Page.javascriptDialogOpening' &&
        record(event.params).type === 'beforeunload' &&
        this.acceptBeforeUnload
      ) {
        void this.call(
          'Page.handleJavaScriptDialog',
          { accept: true },
          string(event.sessionId),
        ).catch((error: unknown) => {
          this.errors.push(String(error));
        });
      }
      if (event.method === 'Runtime.exceptionThrown') {
        this.errors.push(JSON.stringify(record(event.params).exceptionDetails));
      }
      if (event.method === 'Log.entryAdded') {
        const entry = record(record(event.params).entry);
        if (
          entry.level === 'error' &&
          !(typeof entry.url === 'string' && entry.url.endsWith('/favicon.ico'))
        ) {
          this.errors.push(string(entry.text));
        }
      }
    }
  }

  call(
    method: string,
    params: object = {},
    target = this.session,
  ): Promise<Record<string, unknown>> {
    if (this.stopped) {
      return Promise.reject(Error('Chrome is no longer running'));
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Timed out: ${method}; ${this.stderr.slice(-1500)}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(
        JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }) + '\0',
      );
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw Error(JSON.stringify(result.exceptionDetails));
    }
    return record(result.result).value;
  }

  async wait(expression: string): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        if (await this.evaluate(expression)) {
          return;
        }
      } catch (error) {
        // A reload can replace the execution context between readiness polls.
        if (!/context|navigated or closed/i.test(errorDetails(error).message)) {
          throw error;
        }
      }
      await delay(100);
    }
    throw Error(`UI wait timed out: ${expression}`);
  }

  async click(expression: string) {
    await this.evaluate(`(${expression}).click()`);
  }

  async pointer(x: number, y: number, type = 'mousePressed', modifiers = 0) {
    const rect = record(
      await this.evaluate(`(()=>{const r=document.getElementById('scene').getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height};})()`),
    );
    const dims = record(
      await this.evaluate(
        "({w:document.getElementById('scene').width,h:document.getElementById('scene').height})",
      ),
    );
    await this.call('Input.dispatchMouseEvent', {
      type,
      x: number(rect.x) + (x * number(rect.w)) / number(dims.w),
      y: number(rect.y) + (y * number(rect.h)) / number(dims.h),
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      modifiers,
    });
  }

  async screenshot(name: string) {
    const result = await this.call('Page.captureScreenshot', { format: 'png' });
    await mkdir('build/reports/scene-editor', { recursive: true });
    await writeFile(
      `build/reports/scene-editor/${name}.png`,
      Buffer.from(string(result.data), 'base64'),
    );
  }

  async close() {
    if (!this.stopped) {
      try {
        await this.call('Browser.close', {}, null);
      } catch {
        this.browser.kill();
      }
    }
    if (!this.stopped) {
      await new Promise<void>((resolve) => this.browser.once('close', () => resolve()));
    }
    await rm(this.profile, { recursive: true, force: true });
  }
}
