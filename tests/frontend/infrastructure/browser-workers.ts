import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserWorkers } from '../../playwright/support/worker-policy.ts';

await test('browser concurrency uses bounded CI capacity and explicit local overrides', () => {
  assert.equal(browserWorkers({}, 16), 1);
  assert.equal(browserWorkers({ CI: 'true' }, 2), 2);
  assert.equal(browserWorkers({ CI: 'true' }, 8), 4);
  assert.equal(browserWorkers({ CI: 'true', FORGE_BROWSER_WORKERS: '1' }, 8), 1);
  assert.equal(browserWorkers({ FORGE_BROWSER_WORKERS: '3' }, 8), 3);
  for (const invalid of ['', '0', '-1', '1.5', '50%', ' 2', 'Infinity', '9007199254740992']) {
    assert.throws(() => browserWorkers({ FORGE_BROWSER_WORKERS: invalid }), /integer worker count/);
  }
});

await test('explicit measurement modes require exclusive single-worker execution', () => {
  for (const flag of [
    'FORGE_RESPONSIVENESS_PROFILE',
    'FORGE_SCENE_COST_PROFILE',
    'FORGE_SCALABILITY_PROFILE',
    'FORGE_PROFILE_REFERENCE',
    'FORGE_PROFILE_SPARSE',
    'FORGE_PROFILE_OUTPUT',
    'FORGE_PROFILE_BUNDLE',
  ]) {
    const env = { CI: 'true', [flag]: '1' };
    assert.equal(browserWorkers(env, 8), 1, flag);
    assert.equal(browserWorkers({ ...env, FORGE_BROWSER_WORKERS: '1' }, 8), 1, flag);
    assert.throws(() => browserWorkers({ ...env, FORGE_BROWSER_WORKERS: '4' }, 8), /Profiling/);
  }
  assert.equal(browserWorkers({ CI: 'true', FORGE_RESPONSIVENESS_PROFILE: '0' }, 8), 4);
});
