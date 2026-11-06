/** One-row artwork tools; existing controls move into a native overflow popover. */
import { button, element } from './editor-dom.mts';
import type { EditorLifetime } from './editor-lifetime.mts';

export function createArtworkToolbarOverflow(lifetime: EditorLifetime) {
  const toolbar = element('art-toolbar', HTMLElement);
  const trigger = button('art-more-tools');
  const panel = element('art-tool-overflow', HTMLElement);
  const downloadPanel = element('art-png-options', HTMLElement);
  const drawing = element('art-drawing-tools', HTMLElement);
  // Keep drawing and navigation handy; download and then color move first.
  const groups = ['art-png-menu', 'art-color-controls', 'art-view-controls'].map((id) => {
    const node = element(id, HTMLElement);
    const marker = document.createComment(`${id} toolbar position`);
    node.before(marker);
    return { node, marker };
  });
  let width = 0;

  function close() {
    if (downloadPanel.matches(':popover-open')) {
      downloadPanel.hidePopover();
    }
    if (panel.matches(':popover-open')) {
      panel.hidePopover();
    }
  }
  function position() {
    if (!panel.matches(':popover-open')) {
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8))}px`;
  }
  function restore() {
    for (const { node, marker } of groups) {
      if (node.previousSibling !== marker) {
        marker.after(node);
      }
    }
  }
  function layout() {
    if (!toolbar.checkVisibility()) {
      close();
      width = 0;
      return;
    }
    const available = toolbar.clientWidth;
    if (available === width) {
      position();
      return;
    }
    width = available;
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLElement && toolbar.contains(focused);
    close();
    restore();
    trigger.hidden = true;
    const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 0;
    let needed = drawing.getBoundingClientRect().width;
    const sizes = groups.map(({ node }) => node.getBoundingClientRect().width + gap);
    needed += sizes.reduce((sum, size) => sum + size, 0);
    if (needed > available) {
      trigger.hidden = false;
      needed += trigger.getBoundingClientRect().width + gap;
      for (const [index, { node }] of groups.entries()) {
        panel.append(node);
        needed -= sizes[index];
        if (needed <= available) {
          break;
        }
      }
    }
    if (hadFocus && focused instanceof HTMLElement) {
      const target = focused.checkVisibility()
        ? focused
        : trigger.hidden
          ? groups[0].node
          : trigger;
      target.focus({ preventScroll: true });
    }
  }
  panel.addEventListener(
    'toggle',
    () => {
      const open = panel.matches(':popover-open');
      trigger.setAttribute('aria-expanded', String(open));
      position();
      if (open) {
        panel
          .querySelector<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
          )
          ?.focus();
      }
    },
    { signal: lifetime.signal },
  );
  panel.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (target && !target.disabled && ['art-pan', 'art-fit'].includes(target.id)) {
        close();
        trigger.focus({ preventScroll: true });
      }
    },
    { capture: true, signal: lifetime.signal },
  );
  lifetime.observe(new ResizeObserver(layout)).observe(toolbar);
  window.addEventListener('resize', position, { signal: lifetime.signal });
  lifetime.cleanup(() => {
    close();
    restore();
    for (const { marker } of groups) {
      marker.remove();
    }
    trigger.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });
  return { close };
}
