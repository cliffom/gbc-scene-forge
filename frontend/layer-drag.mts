/** Pointer-driven layer reordering; the model changes only when a drag is dropped. */
export function layerDragging(
  list: HTMLElement,
  move: (id: number, beforeId: number | null) => void,
) {
  let drag: {
    pointer: number;
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    before: number | null;
  } | null = null;
  let frame = 0;
  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    delete list.dataset.dragging;
    list.querySelectorAll<HTMLElement>('.layer-row').forEach((row) => {
      delete row.dataset.drop;
      delete row.dataset.dragging;
    });
    if (drag && list.hasPointerCapture(drag.pointer)) {
      list.releasePointerCapture(drag.pointer);
    }
    drag = null;
  }
  function indicate() {
    if (!drag?.active) {
      return;
    }
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.layer-row'));
    rows.forEach((row) => delete row.dataset.drop);
    const remaining = rows.filter((row) => Number(row.dataset.layerId) !== drag?.id);
    const next = remaining.find((row) => {
      const rect = row.getBoundingClientRect();
      return drag && drag.y < rect.top + rect.height / 2;
    });
    drag.before = next ? Number(next.dataset.layerId) : null;
    const target = next || remaining.at(-1);
    if (target) {
      target.dataset.drop = next ? 'before' : 'after';
    }
  }
  function scroll() {
    if (!drag?.active) {
      return;
    }
    const rect = list.getBoundingClientRect();
    const speed = drag.y < rect.top + 24 ? -10 : drag.y > rect.bottom - 24 ? 10 : 0;
    if (speed) {
      list.scrollTop += speed;
    }
    indicate();
    frame = requestAnimationFrame(scroll);
  }
  list.addEventListener('pointerdown', (event) => {
    const grip = event.target instanceof Element ? event.target.closest('.layer-grip') : null;
    const row = grip?.closest<HTMLElement>('.layer-row');
    if (!row || !event.isPrimary || event.button !== 0 || row.querySelector('input')?.disabled) {
      return;
    }
    event.preventDefault();
    drag = {
      pointer: event.pointerId,
      id: Number(row.dataset.layerId),
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      before: null,
    };
    list.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 4) {
      drag.active = true;
      list.dataset.dragging = 'true';
      const row = list.querySelector<HTMLElement>(`[data-layer-id="${drag.id}"]`);
      if (row) {
        row.dataset.dragging = 'true';
      }
      scroll();
    }
    indicate();
  });
  list.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointer) {
      return;
    }
    const rect = list.getBoundingClientRect();
    const commit =
      drag.active &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    const { id, before } = drag;
    clear();
    if (commit) {
      move(id, before);
    }
  });
  list.addEventListener('pointercancel', clear);
  list.addEventListener('lostpointercapture', clear);
  document.addEventListener(
    'keydown',
    (event) => {
      if (drag && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        clear();
      }
    },
    true,
  );
}
