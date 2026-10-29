import type { ApplyJob } from './types.ts';
// Describe observable activity. A live process with quiet output is not a failed task.
export function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return value >= 60
    ? `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, '0')}s`
    : `${value}s`;
}

export function progressView(job: ApplyJob | null, now: number, connectionError = '') {
  if (connectionError) {
    return {
      state: 'disconnected',
      label: 'Connection lost',
      activity: 'Apply may still be running. Reconnecting to check its status…',
      detail: connectionError,
    };
  }
  if (!job) {
    return {
      state: 'running',
      label: 'Checking task status',
      activity: 'Waiting for the editor server…',
      detail: '',
    };
  }
  const elapsed = duration((job.ended_at || now) - job.started_at);
  const phase = duration((job.ended_at || now) - (job.phase_started_at || job.started_at));
  const timing = `Elapsed ${elapsed}${job.step_index ? ` · Step ${job.step_index} of ${job.step_count}` : ''} · This step ${phase}`;
  if (job.status === 'failed') {
    return {
      state: 'failed',
      label: job.step || 'Apply failed',
      activity: job.error || 'The background task stopped unexpectedly.',
      detail: timing,
    };
  }
  if (job.status === 'complete') {
    return {
      state: 'complete',
      label: 'Applied to game',
      activity: job.message || 'Build and checks passed.',
      detail: timing,
    };
  }
  const quiet = job.last_output_at ? Math.max(0, now - job.last_output_at) : 0;
  return {
    state: quiet >= 15 ? 'quiet' : 'running',
    label: job.step || 'Apply running',
    activity: job.activity || job.step || '',
    detail: `${timing}\n${job.process?.running ? 'Process running' : 'Worker running'}${job.last_output_at ? ` · Last output ${duration(quiet)} ago` : ' · Waiting for first output'}. Status connection active.`,
  };
}
