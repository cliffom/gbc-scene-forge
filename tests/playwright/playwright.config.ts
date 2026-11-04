import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserWorkers } from './support/worker-policy.ts';

// Every invocation owns a unique report directory; later wheel/MCP runs retain earlier failures.
const run =
  process.env.FORGE_BROWSER_RUN ??
  new Date().toISOString().replaceAll(':', '-') + '-' + process.pid;
process.env.FORGE_BROWSER_RUN = run;
const reports = resolve(import.meta.dirname, '../../build/reports/playwright', run);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  testIgnore: process.env.FORGE_MCP_ONLY
    ? /^(?!.*(?:mcp|refresh)\.spec\.ts).*$/
    : /(?:mcp|refresh)\.spec\.ts$/,
  outputDir: `${reports}/results`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${reports}/html`, open: 'never' }],
    ['json', { outputFile: `${reports}/summary.json` }],
  ],
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: browserWorkers(),
  fullyParallel: true,
  globalSetup: './support/worker-setup.ts',
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 15000,
    navigationTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  },
});
