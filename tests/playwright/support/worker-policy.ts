import { availableParallelism } from 'node:os';

/** Profiling runs own the runner: competing tests invalidate timing/resource observations. */
export function browserWorkers(
  env: NodeJS.ProcessEnv = process.env,
  capacity = availableParallelism(),
): number {
  const override = env.FORGE_BROWSER_WORKERS;
  if (override !== undefined && !/^[1-9]\d*$/.test(override)) {
    throw Error('FORGE_BROWSER_WORKERS must be a positive integer worker count');
  }
  const requested = override === undefined ? undefined : Number(override);
  if (requested !== undefined && !Number.isSafeInteger(requested)) {
    throw Error('FORGE_BROWSER_WORKERS must be a safe integer worker count');
  }
  const profiling =
    env.FORGE_RESPONSIVENESS_PROFILE === '1' ||
    env.FORGE_SCENE_COST_PROFILE === '1' ||
    Boolean(env.FORGE_SCALABILITY_PROFILE) ||
    Boolean(env.FORGE_PROFILE_REFERENCE) ||
    Boolean(env.FORGE_PROFILE_SPARSE) ||
    Boolean(env.FORGE_PROFILE_OUTPUT) ||
    Boolean(env.FORGE_PROFILE_BUNDLE);
  if (profiling && requested !== undefined && requested !== 1) {
    throw Error('Profiling requires FORGE_BROWSER_WORKERS=1 on an otherwise idle runner');
  }
  return profiling ? 1 : (requested ?? (env.CI ? Math.min(4, capacity) : 1));
}
