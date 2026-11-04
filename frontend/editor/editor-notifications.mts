/** Mounted, document-owned feedback. Timers never own or clear another notice. */
import type { EditorLifetime } from './editor-lifetime.mts';

type Severity = 'info' | 'warning' | 'error';
type FeedbackKey = string | object;
type Options = { key?: FeedbackKey; severity?: Severity; persistent?: boolean };
type Notice = {
  owner: unknown;
  key: FeedbackKey;
  card: HTMLElement;
  message: HTMLElement;
  persistent: boolean;
  remaining: number;
  started: number;
  hovered: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function feedbackText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '');
}

export interface Feedback {
  readonly text: string;
  readonly state: string;
  readonly revision: number;
  show(text: string, options?: Options): void;
  warning(error: unknown): void;
  error(error: unknown, key?: FeedbackKey): void;
  clear(key?: FeedbackKey): void;
  sync(): void;
  capture(): {
    current(): boolean;
    error(error: unknown, key?: FeedbackKey): void;
    clear(key: FeedbackKey): void;
  };
}

export function createNotifications(lifetime: EditorLifetime, workbench: HTMLElement) {
  const region = document.createElement('section');
  region.className = 'notifications';
  region.setAttribute('aria-label', 'Notifications');
  region.popover = 'manual';
  document.body.append(region);
  const channels: Feedback[] = [];

  function position() {
    const modal = document.querySelector<HTMLDialogElement>('dialog[open]:modal');
    const host = modal ?? document.body;
    if (region.parentElement !== host) {
      region.hidePopover();
      host.append(region);
    }
    const viewport = workbench.querySelector<HTMLElement>(
      '#scene-surface:not([hidden]) #viewport, #artwork-surface:not([hidden]) .art-canvas-scroll',
    );
    const viewportBounds = viewport?.getBoundingClientRect();
    const bounds =
      viewportBounds?.width && viewportBounds.height
        ? viewportBounds
        : workbench.getBoundingClientRect();
    region.style.top = `${modal ? 16 : Math.max(12, bounds.top + 12)}px`;
    region.style.right = `${modal ? 16 : Math.max(12, innerWidth - bounds.right + 12)}px`;
    region.style.maxWidth = `${Math.max(200, Math.min(360, bounds.width - 24, innerWidth - 24))}px`;
    region.style.maxHeight = `${Math.max(100, innerHeight - parseFloat(region.style.top) - 24)}px`;
    if (region.querySelector('.notification:not([hidden])') && !region.matches(':popover-open')) {
      region.showPopover();
    } else if (!region.querySelector('.notification:not([hidden])')) {
      region.hidePopover();
    }
  }

  // Move into the active modal so its dismissal controls remain keyboard reachable.
  const observer = lifetime.observe(
    new MutationObserver(() => {
      for (const channel of channels) {
        channel.sync();
      }
      position();
    }),
  );
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'data-document'],
  });
  const layoutObserver = lifetime.observe(new ResizeObserver(position));
  layoutObserver.observe(workbench);
  for (const viewport of document.querySelectorAll('#viewport, .art-canvas-scroll')) {
    layoutObserver.observe(viewport);
  }
  window.addEventListener('resize', position, { signal: lifetime.signal });
  lifetime.cleanup(() => region.remove());

  return {
    channel(
      id: string,
      context: () => unknown = () => null,
      active: () => boolean = () => true,
    ): Feedback {
      const notices = new Set<Notice>();
      let owner = context();
      let revision = 0;
      let text = '';
      let state = '';
      function pause(notice: Notice) {
        if (notice.timer !== undefined) {
          lifetime.cancelTimeout(notice.timer);
          notice.timer = undefined;
          notice.remaining = Math.max(0, notice.remaining - (performance.now() - notice.started));
        }
      }
      function schedule(notice: Notice) {
        pause(notice);
        if (!notices.has(notice) || lifetime.disposed) {
          return;
        }
        if (
          notice.persistent ||
          notice.card.hidden ||
          document.hidden ||
          notice.hovered ||
          notice.card.matches(':focus-within')
        ) {
          return;
        }
        notice.started = performance.now();
        notice.timer = lifetime.timeout(() => remove(notice), notice.remaining);
      }
      function remove(notice: Notice) {
        pause(notice);
        notices.delete(notice);
        notice.card.remove();
        sync();
        position();
      }
      function sync() {
        const next = context();
        if (next !== owner) {
          owner = next;
          revision++;
          text = '';
          state = '';
          for (const notice of [...notices]) {
            if (!notice.persistent) {
              pause(notice);
              notices.delete(notice);
              notice.card.remove();
            }
          }
        }
        let latest: Notice | undefined;
        for (const notice of [...notices]) {
          notice.message.removeAttribute('id');
          const hidden = notice.owner !== owner || !active();
          if (hidden && !notice.persistent) {
            pause(notice);
            notices.delete(notice);
            notice.card.remove();
            continue;
          }
          if (hidden !== notice.card.hidden) {
            notice.card.hidden = hidden;
            schedule(notice);
          }
          if (!hidden) {
            latest = notice;
          }
        }
        if (latest) {
          latest.message.id = id;
        }
      }
      function clear(key?: FeedbackKey) {
        sync();
        let removed = false;
        for (const notice of [...notices]) {
          if (notice.owner === owner && (key === undefined || key === notice.key)) {
            remove(notice);
            removed = true;
          }
        }
        if (removed || key === undefined) {
          revision++;
        }
        if (key === undefined) {
          text = '';
          state = '';
        }
      }
      function show(value: string, options: Options = {}) {
        if (lifetime.disposed) {
          return;
        }
        sync();
        if (!value) {
          clear('message');
          return;
        }
        const key = options.key ?? 'message';
        const severity = options.severity ?? 'info';
        const persistent = options.persistent ?? severity === 'error';
        const previous = [...notices].find((item) => item.owner === owner && item.key === key);
        text = feedbackText(value);
        state = severity === 'error' ? 'error' : '';
        revision++;
        if (
          previous &&
          previous.message.textContent === text &&
          previous.persistent === persistent &&
          previous.card.dataset.severity === severity
        ) {
          pause(previous);
          previous.remaining = 5000;
          notices.delete(previous);
          notices.add(previous);
          sync();
          schedule(previous);
          return;
        }
        if (previous) {
          remove(previous);
        }
        const card = document.createElement('div');
        card.className = 'notification';
        card.dataset.severity = severity;
        card.dataset.channel = id;
        const label = document.createElement('span');
        label.className = 'notification-severity';
        label.textContent =
          severity === 'error' ? 'Error' : severity === 'warning' ? 'Notice' : 'Info';
        const message = document.createElement('span');
        message.className = 'notification-message';
        message.dataset.state = state;
        message.dataset.error = String(severity !== 'info');
        // Live regions exist before their content changes; coalescing repeats does not reannounce.
        message.setAttribute('role', severity === 'error' ? 'alert' : 'status');
        message.setAttribute('aria-atomic', 'true');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'notification-dismiss';
        close.setAttribute('aria-label', 'Dismiss notification');
        close.textContent = '×';
        card.append(label, message, close);
        const notice: Notice = {
          owner,
          key,
          card,
          message,
          persistent,
          remaining: 5000,
          started: 0,
          hovered: false,
        };
        notices.add(notice);
        close.addEventListener('click', () => {
          revision++;
          remove(notice);
        });
        card.addEventListener('pointerenter', () => pause(notice));
        card.addEventListener('pointerleave', () => schedule(notice));
        card.addEventListener('focusin', () => pause(notice));
        card.addEventListener('focusout', () => queueMicrotask(() => schedule(notice)));
        region.append(card);
        sync();
        position();
        const announcement = text;
        lifetime.frame(() => {
          if (notices.has(notice)) {
            message.textContent = announcement;
          }
        });
        // Bound routine stacks; never evict a consequential failure to make room.
        const transient = [...notices].filter((item) => !item.persistent);
        for (const item of transient.slice(0, -3)) {
          remove(item);
        }
        schedule(notice);
      }
      const feedback: Feedback = {
        get text() {
          return text;
        },
        get state() {
          return state;
        },
        get revision() {
          return revision;
        },
        show,
        warning(error) {
          show(feedbackText(error), { severity: 'warning' });
        },
        error(error, key = 'operation') {
          show(feedbackText(error), { severity: 'error', key });
        },
        clear,
        sync,
        capture() {
          sync();
          const capturedOwner = owner,
            capturedRevision = revision;
          const capturedNotices = [...notices].filter((notice) => notice.owner === owner);
          const current = () =>
            !lifetime.disposed && context() === capturedOwner && revision === capturedRevision;
          return {
            current,
            error(error, key) {
              if (current()) {
                feedback.error(error, key);
              }
            },
            clear(key) {
              for (const notice of capturedNotices) {
                if (notice.key === key && notices.has(notice)) {
                  remove(notice);
                }
              }
            },
          };
        },
      };
      document.addEventListener(
        'pointermove',
        (event) => {
          // Cards let drawing pass through; hover is geometric rather than a hit target.
          for (const notice of notices) {
            const bounds = notice.card.getBoundingClientRect();
            const hovered =
              !notice.card.hidden &&
              event.clientX >= bounds.left &&
              event.clientX <= bounds.right &&
              event.clientY >= bounds.top &&
              event.clientY <= bounds.bottom;
            if (hovered !== notice.hovered) {
              notice.hovered = hovered;
              if (hovered) {
                pause(notice);
              } else {
                schedule(notice);
              }
            }
          }
        },
        { signal: lifetime.signal, capture: true },
      );
      document.addEventListener(
        'pointerleave',
        () => {
          for (const notice of notices) {
            notice.hovered = false;
            schedule(notice);
          }
        },
        { signal: lifetime.signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          for (const notice of notices) {
            schedule(notice);
          }
        },
        { signal: lifetime.signal },
      );
      lifetime.cleanup(() => {
        for (const notice of notices) {
          pause(notice);
        }
        notices.clear();
      });
      channels.push(feedback);
      return feedback;
    },
  };
}
