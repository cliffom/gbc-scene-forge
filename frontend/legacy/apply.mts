import { errorDetails, ProtocolError } from '../errors.mts';
import type { ApiClient } from './api.mts';
import * as decode from './decode.mts';
import type { Documents } from './documents.mts';
import { $, requireValue } from './dom.mts';
import { progressView } from './progress.mts';
import type { Renderer } from './render.mts';
import type { EditorSession } from './session.mts';
import type { ApplyJob, LastApply } from './types.ts';
import { download, guarded, loadImage, status } from './ui.mts';
export function createApply(
  state: EditorSession,
  client: ApiClient,
  documents: Documents,
  renderer: Renderer,
) {
  const api = client.request.bind(client),
    json = client.json.bind(client);
  const { markChanged, changed } = documents;
  const { refreshPreview } = renderer;
  let reviewId: string | null = null,
    applyRunning = false,
    lastApply: LastApply | null = null;
  let monitorGeneration = 0,
    monitoredJobId: string | null = null,
    latestJob: ApplyJob | null = null;
  let connectionError = '',
    receivedAt = 0;
  function updateApplyAvailability() {
    const differs = state.comparison?.differs;
    $('apply').disabled =
      !state.ready || applyRunning || !differs || !state.catalog.capabilities.apply;
    $('undo-apply').disabled = !state.ready || !lastApply?.transaction || applyRunning;
    $('apply').title = applyRunning
      ? 'Apply is running'
      : differs
        ? 'Review and apply layout changes'
        : 'This layout matches the current game';
  }
  async function refreshLastApply() {
    lastApply = await json('last-apply', decode.lastApply, undefined, { timeoutMs: 8000 });
    $('undo-apply').disabled = !state.ready || !lastApply.transaction || applyRunning;
    $('undo-apply').title = lastApply.label
      ? `Restore the game before ${lastApply.label}`
      : 'No scene has been applied';
  }
  function showApplyProgress() {
    $('review-content').hidden = true;
    $('approve-label').hidden = true;
    $('apply-progress').hidden = false;
    $('apply-confirm').hidden = true;
    $('apply-close').disabled = true;
    $('apply-close').textContent = 'Done';
    $('apply-result').textContent = '';
    $('apply-details').open = false;
    $('apply-reconnect').hidden = true;
    if (!$('apply-review').open) {
      $('apply-review').showModal();
    }
  }
  function displayProgress() {
    updateApplyAvailability();
    const now = latestJob?.server_time
      ? latestJob.server_time + (Date.now() - receivedAt) / 1000
      : Date.now() / 1000;
    const view = progressView(latestJob, now, connectionError);
    $('apply-health').dataset.state = view.state;
    $('apply-step').textContent = view.label;
    $('apply-activity').textContent = view.activity;
    $('apply-timing').textContent = view.detail;
    $('apply-reconnect').hidden = !connectionError;
    if (connectionError) {
      $('apply-close').disabled = false;
      $('apply-close').textContent = 'Close status';
      $('apply-result').textContent =
        'This is a connection problem, not a confirmed build failure. Closing this status window does not cancel Apply.';
    } else {
      $('apply-close').disabled = applyRunning;
      $('apply-close').textContent = 'Done';
    }
  }
  async function watchApply(jobId: string) {
    const generation = ++monitorGeneration;
    monitoredJobId = jobId;
    latestJob = null;
    connectionError = '';
    applyRunning = true;
    showApplyProgress();
    displayProgress();
    const ticker = setInterval(displayProgress, 500);
    try {
      while (generation === monitorGeneration) {
        let job;
        try {
          job = await json(`apply-status/${jobId}`, decode.job, undefined, { timeoutMs: 8000 });
          if (generation !== monitorGeneration) {
            return;
          }
          latestJob = job;
          receivedAt = Date.now();
          connectionError = '';
        } catch (cause) {
          const error = errorDetails(cause);
          if (generation !== monitorGeneration) {
            return;
          }
          connectionError = error.message;
          displayProgress();
          if (error instanceof ProtocolError) {
            $('apply-step').textContent = 'Task status could not be read';
            $('apply-result').textContent =
              `${error.message} Automatic retries stopped. Check the current game and last Apply, then reconnect to retry. The task may have completed; this is not a confirmed build failure.`;
            status('Apply status response is incompatible. Automatic retries stopped.');
            break;
          }
          status('Cannot confirm Apply status. Reconnecting; the task may still be running.');
          if (error.status >= 400 && error.status < 500) {
            $('apply-result').textContent =
              `${error.message} Task status is unavailable. Check the current game and last Apply before starting another task.`;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        displayProgress();
        $('apply-log').textContent = job.log || '';
        if (job.status === 'complete') {
          $('apply-result').textContent = job.message || '';
          // Rebase the open draft without replacing edits made while disconnected.
          try {
            if (!state.ready) {
              status(job.message || 'Reviewed changes applied.');
              break;
            }
            const baseline =
              state.editor.scene.profile === job.profile
                ? job.scene
                : (await json(`scene/${state.editor.scene.profile}`, decode.sceneData)).scene;
            state.gameScene = requireValue(baseline);
            state.editor.scene.source_digest = requireValue(baseline).source_digest;
            state.comparison = null;
            markChanged();
            await refreshPreview();
          } catch (cause) {
            const error = errorDetails(cause);
            $('apply-result').textContent +=
              `\nThe game was applied, but the preview could not refresh: ${error.message}`;
          }
          status(job.message || 'Reviewed changes applied.');
          break;
        }
        if (job.status === 'failed') {
          $('apply-result').textContent =
            `${job.failed_step ? `Failed during: ${job.failed_step}\n` : ''}${job.error}`;
          $('apply-details').open = true;
          status(`Apply stopped: ${job.error}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } finally {
      clearInterval(ticker);
      if (generation === monitorGeneration) {
        applyRunning = false;
        $('apply-close').disabled = false;
        updateApplyAvailability();
        try {
          await refreshLastApply();
        } catch {
          /* Preserve the task's primary result when disconnected. */
        }
      }
    }
  }
  $('apply').onclick = guarded(async () => {
    updateApplyAvailability();
    if ($('apply').disabled) {
      return;
    }
    status('Preparing the layout review…');
    const review = await json('apply-review', decode.review, { scene: state.editor.scene });
    reviewId = review.id;
    monitoredJobId = null;
    latestJob = null;
    connectionError = '';
    $('apply-summary').textContent =
      `${review.changed_cells} changed cells in ${review.target}. ${review.note}`;
    $('apply-views').replaceChildren();
    for (const view of review.views) {
      const heading = document.createElement('h3');
      heading.textContent = view.label;
      const comparisonElement = document.createElement('div');
      comparisonElement.className = 'review-comparison';
      for (const [key, label] of [
        ['before', 'Current game'],
        ['after', 'Proposed layout'],
      ] as const) {
        const figure = document.createElement('figure'),
          caption = document.createElement('figcaption');
        caption.textContent = label;
        const images = document.createElement('div');
        images.className = 'review-images';
        for (const scale of [1, 4]) {
          const image = await loadImage(view[key]);
          image.alt = `${label}, ${view.label}, ${scale}×`;
          image.width = image.naturalWidth * scale;
          image.height = image.naturalHeight * scale;
          images.append(image);
        }
        figure.append(caption, images);
        comparisonElement.append(figure);
      }
      $('apply-views').append(heading, comparisonElement);
    }
    $('apply-files').replaceChildren(
      ...review.files.map((name) => {
        const li = document.createElement('li');
        li.textContent = name;
        return li;
      }),
    );
    $('approve-layout').checked = false;
    $('apply-confirm').disabled = true;
    $('apply-confirm').hidden = false;
    $('approve-label').hidden = false;
    $('review-content').hidden = false;
    $('apply-progress').hidden = true;
    $('apply-close').disabled = false;
    $('apply-close').textContent = 'Cancel';
    $('apply-review').showModal();
    status('Review the proposed layout before applying it.');
  });
  $('approve-layout').onchange = () => {
    $('apply-confirm').disabled = !$('approve-layout').checked;
  };
  $('apply-confirm').onclick = guarded(async () => {
    if (!$('approve-layout').checked) {
      return;
    }
    $('apply-confirm').disabled = true;
    try {
      const job = await json(
        'apply',
        decode.job,
        { review: requireValue(reviewId), approved: true },
        { timeoutMs: 8000 },
      );
      await watchApply(requireValue(job.id));
    } catch (cause) {
      const error = errorDetails(cause);
      if (!error.status) {
        // The server may have accepted Apply even if its initial response was malformed.
        await watchApply(requireValue(reviewId));
        return;
      }
      showApplyProgress();
      applyRunning = false;
      latestJob = {
        status: 'failed',
        step: 'Apply could not start',
        error: error.message,
        started_at: Date.now() / 1000,
        ended_at: Date.now() / 1000,
      };
      displayProgress();
      $('apply-result').textContent = error.message;
      $('apply-close').disabled = false;
      status(error.message);
    }
  });
  async function closeApplyProgress() {
    if (applyRunning && !connectionError) {
      return;
    }
    monitorGeneration++;
    applyRunning = false;
    updateApplyAvailability();
    if (monitoredJobId && latestJob?.status && latestJob.status !== 'running') {
      try {
        await api('apply-dismiss', { job: monitoredJobId }, { timeoutMs: 8000 });
      } catch {
        /* Can be acknowledged after reconnecting. */
      }
    }
    $('apply-review').close();
  }
  $('apply-close').onclick = guarded(closeApplyProgress);
  $('apply-review').addEventListener('cancel', (event) => {
    event.preventDefault();
    void guarded(closeApplyProgress)();
  });
  $('apply-reconnect').onclick = guarded(async () => {
    if (monitoredJobId) {
      await watchApply(monitoredJobId);
    }
  });
  $('apply-download-log').onclick = () => {
    const report = [
      `Task: ${monitoredJobId || 'unknown'}`,
      `Status: ${latestJob?.status || 'unavailable'}`,
      `Step: ${latestJob?.failed_step || latestJob?.step || 'unknown'}`,
      `Command: ${latestJob?.process?.command || 'unavailable'}`,
      `Exit code: ${latestJob?.process?.return_code ?? 'unavailable'}`,
      latestJob?.error || connectionError,
      '',
      latestJob?.log || 'No task output received.',
    ].join('\n');
    download(
      new Blob([report], { type: 'text/plain' }),
      `scene-apply-${monitoredJobId || 'status'}.log`,
    );
  };
  $('undo-apply').onclick = guarded(async () => {
    if (!lastApply?.transaction) {
      return;
    }
    const result = await json('undo-apply', decode.sceneData, {
      transaction: lastApply.transaction,
      profile: state.editor.scene.profile,
    });
    state.gameScene = result.scene;
    state.editor.scene.source_digest = result.scene.source_digest;
    changed();
    await refreshLastApply();
    status('Previous project files restored. Your current draft remains open.');
  });
  async function resume() {
    const active = await json('apply-active', decode.activeApply);
    if (active.id) {
      await watchApply(active.id);
    }
  }
  return {
    updateAvailability: updateApplyAvailability,
    refreshLastApply,
    resume,
    isRunning: () => applyRunning,
  };
}
export type Apply = ReturnType<typeof createApply>;
