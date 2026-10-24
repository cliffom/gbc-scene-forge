import { $, context } from './dom.mts';
import { guarded, loadImage } from './ui.mts';
import * as decode from './decode.mts';
import type { ApiClient } from './api.mts';
import type { Assets } from './assets.mts';
import type { EditorSession } from './session.mts';
export function createRenderer(
  state: EditorSession,
  assets: Assets,
  client: ApiClient,
  updateApplyAvailability: () => void,
) {
  const json = client.json.bind(client);
  const { assetRegion } = assets;
  const canvas = $('scene'),
    ctx = context(canvas);
  let background: HTMLImageElement | null = null,
    collision: boolean[][] = [],
    frame = 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined,
    previewSerial = 0;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  async function refreshPreview() {
    if (!state.ready) {
      return;
    }
    const serial = ++previewSerial;
    const data = await json('preview', decode.preview, {
      scene: state.editor.scene,
      light: $('lighting').value,
      state: $('state').value,
      frame,
    });
    const image = await loadImage(data.png);
    if (serial !== previewSerial) {
      return;
    }
    background = image;
    collision = data.collision;
    state.comparison = data.comparison;
    updateApplyAvailability();
    draw();
  }
  function draw() {
    if (!state.ready) {
      return;
    }
    $('deselect').disabled = !state.selection && !state.selectedReference;
    const width = state.editor.scene.width * state.cellSize,
      height = state.editor.scene.height * state.cellSize;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = `${width * Number($('zoom').value)}px`;
    canvas.style.height = `${height * Number($('zoom').value)}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#292921';
    ctx.fillRect(0, 0, width, height);
    if (background) {
      ctx.drawImage(background, 0, 0);
    }
    if ($('collision').checked) {
      ctx.fillStyle = '#db71534d';
      collision.forEach((row, y) =>
        row.forEach((solid, x) => {
          if (solid) {
            ctx.fillRect(x * state.cellSize, y * state.cellSize, state.cellSize, state.cellSize);
          }
        }),
      );
    }
    if ($('protected').checked) {
      ctx.fillStyle = '#d4b76735';
      for (const point of state.editor.locked) {
        const [x, y] = point.split(',').map(Number);
        ctx.fillRect(x * state.cellSize, y * state.cellSize, state.cellSize, state.cellSize);
      }
    }
    if ($('grid').checked) {
      ctx.strokeStyle = '#00000045';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      for (let x = state.cellSize; x < width; x += state.cellSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = state.cellSize; y < height; y += state.cellSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }
    const guide = state.catalog.profiles[state.editor.scene.profile].guide;
    if ($('guides').checked && guide) {
      ctx.strokeStyle = '#f3dc8f';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 2]);
      const gx = Math.max(
        0,
        Math.min(state.hover?.tx || 0, Math.max(0, state.editor.scene.width - guide[0])),
      );
      const gy = Math.max(
        0,
        Math.min(state.hover?.ty || 0, Math.max(0, state.editor.scene.height - guide[1])),
      );
      ctx.strokeRect(
        gx * state.cellSize + 0.5,
        gy * state.cellSize + 0.5,
        Math.min(width, guide[0] * state.cellSize) - 1,
        Math.min(height, guide[1] * state.cellSize) - 1,
      );
      ctx.setLineDash([]);
    }
    if ($('markers').checked) {
      ctx.font = `${Math.max(3, state.cellSize - 2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const marker of state.annotations) {
        ctx.fillStyle = '#171b16ca';
        ctx.fillRect(
          marker.x * state.cellSize,
          marker.y * state.cellSize,
          state.cellSize,
          state.cellSize,
        );
        ctx.fillStyle = '#e6d498';
        ctx.fillText(
          marker.label,
          marker.x * state.cellSize + state.cellSize / 2,
          marker.y * state.cellSize + state.cellSize / 2,
        );
      }
    }
    if (state.selection) {
      ctx.fillStyle = '#d4b76730';
      ctx.strokeStyle = '#f2d67b';
      ctx.lineWidth = 0.6;
      ctx.fillRect(
        state.selection.x * state.cellSize,
        state.selection.y * state.cellSize,
        state.selection.w * state.cellSize,
        state.selection.h * state.cellSize,
      );
      ctx.strokeRect(
        state.selection.x * state.cellSize,
        state.selection.y * state.cellSize,
        state.selection.w * state.cellSize,
        state.selection.h * state.cellSize,
      );
    }
    const ref = state.editor.scene.references.find((r) => r.id === state.selectedReference);
    if (ref) {
      const r = assetRegion(ref.asset),
        origin = r.origin || [r.width / 2, r.height - 1];
      ctx.strokeStyle = '#f2d67b';
      ctx.lineWidth = 0.6;
      ctx.strokeRect(ref.x - origin[0], ref.y - origin[1], r.width, r.height);
    }
    if (state.gesture?.type === 'move' && state.selection) {
      const p = state.gesture.current || state.gesture.p;
      const dx = p.tx - state.gesture.p.tx,
        dy = p.ty - state.gesture.p.ty;
      let valid = true;
      try {
        for (let y = 0; y < state.selection.h; y++) {
          for (let x = 0; x < state.selection.w; x++) {
            state.editor.check(state.selection.x + x, state.selection.y + y);
            state.editor.check(state.selection.x + x + dx, state.selection.y + y + dy);
          }
        }
      } catch {
        valid = false;
      }
      dragPreview(
        state.selection.x * state.cellSize,
        state.selection.y * state.cellSize,
        state.selection.w * state.cellSize,
        state.selection.h * state.cellSize,
        (state.selection.x + dx) * state.cellSize,
        (state.selection.y + dy) * state.cellSize,
        valid,
      );
      $('coordinates').textContent =
        `Move to X ${state.selection.x + dx}   Y ${state.selection.y + dy}${valid ? '' : ' · blocked'}`;
    } else if (state.gesture?.type === 'reference') {
      const { ref, p } = state.gesture,
        current = state.gesture.current || p;
      const r = assetRegion(ref.asset),
        origin = r.origin || [r.width / 2, r.height - 1];
      const x = Math.max(0, Math.min(width - 1, ref.x + current.x - p.x));
      const y = Math.max(0, Math.min(height - 1, ref.y + current.y - p.y));
      dragPreview(
        ref.x - origin[0],
        ref.y - origin[1],
        r.width,
        r.height,
        x - origin[0],
        y - origin[1],
        true,
      );
    }
    if (state.hover && ['paint', 'erase', 'fill', 'select'].includes(state.tool)) {
      const shape = ['erase', 'select'].includes(state.tool)
        ? [[state.editor.floor]]
        : state.brush?.cells || [[state.brush?.id]];
      ctx.strokeStyle = state.editor.locked.has(`${state.hover.tx},${state.hover.ty}`)
        ? '#ed886f'
        : '#e6d498';
      ctx.lineWidth = 0.6;
      ctx.strokeRect(
        state.hover.tx * state.cellSize,
        state.hover.ty * state.cellSize,
        (shape[0]?.length || 1) * state.cellSize,
        shape.length * state.cellSize,
      );
    }
  }
  function dragPreview(
    sx: number,
    sy: number,
    w: number,
    h: number,
    x: number,
    y: number,
    valid: boolean,
  ) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    if (background) {
      ctx.drawImage(background, sx, sy, w, h, x, y, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = valid ? '#d4b76730' : '#ed886f55';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = valid ? '#f2d67b' : '#ed886f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }
  function animateFrame() {
    const count =
      state.editor && state.catalog.profiles[state.editor.scene.profile].animation_frames;
    if ($('animate').checked && count && !state.gesture && !$('apply-review').open) {
      frame = (frame + 1) % count;
      void guarded(refreshPreview)();
    }
  }

  function invalidate() {
    clearTimeout(previewTimer);
    previewSerial++;
  }
  function schedulePreview() {
    previewTimer = setTimeout(guarded(refreshPreview), 90);
  }
  function reset() {
    clearInterval(animationTimer);
    background = null;
    frame = 0;
    const profile = state.catalog.profiles[state.editor.scene.profile];
    if (profile.animation_frames) {
      animationTimer = setInterval(animateFrame, profile.animation_interval_ms);
    }
  }
  for (const id of ['grid', 'markers', 'collision', 'protected', 'guides', 'zoom'] as const) {
    $(id).onchange = draw;
  }
  for (const id of ['lighting', 'state'] as const) {
    $(id).onchange = guarded(refreshPreview);
  }
  return { draw, refreshPreview, invalidate, schedulePreview, reset };
}
export type Renderer = ReturnType<typeof createRenderer>;
