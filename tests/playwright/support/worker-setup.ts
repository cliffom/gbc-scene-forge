import type { FullConfig } from '@playwright/test';
import { browserWorkers } from './worker-policy.ts';

/** Check the effective count too: Playwright's --workers takes precedence over config. */
export default function checkWorkers(config: FullConfig) {
  browserWorkers({ ...process.env, FORGE_BROWSER_WORKERS: String(config.workers) });
}
