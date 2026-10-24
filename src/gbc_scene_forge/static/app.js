import {Editor, canvasPoint, clone} from './model.mjs';
import {progressView} from './progress.mjs';

const $ = id => document.getElementById(id);
const canvas = $('scene'), ctx = canvas.getContext('2d');
let catalog, editor, token, revision = null, saved = '', savedId = null;
let gameScene = null;
let originals = new Set(), openedOriginal = false;
let cellSize = 1, annotations = [], comparison = null;
let revertScene = null;
let tool = 'select', brush, selection = null, selectedReference = null, gesture = null;
let background = null, collision = [], frame = 0, previewTimer, previewSerial = 0;
let animationTimer;
let dirty = false;
let reviewId = null, applyRunning = false, lastApply = null;
let monitorGeneration = 0, monitoredJobId = null, latestJob = null, connectionError = '', receivedAt = 0;
const images = new Map();
const status = message => { $('status').textContent = message; };
const guarded = callback => async (...args) => { try { await callback(...args); } catch (error) { status(error.message); } };

async function api(path, data, options = {}) {
  const controller = new AbortController();
  const timer = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  let response;
  try {
    response = await fetch('/api/' + path, {signal: controller.signal, ...(data === undefined ? {} : {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-Scene-Token': token}, body: JSON.stringify(data),
    })});
  } catch (error) {
    throw Error(error.name === 'AbortError' ? `The editor server did not respond within ${options.timeoutMs / 1000} seconds.` : error.message);
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({error: `Editor returned HTTP ${response.status} ${response.statusText}`}));
    const error = Error(result.error || 'The request failed.'); error.status = response.status; throw error;
  }
  return response;
}
const json = async (path, data, options) => (await api(path, data, options)).json();

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function markChanged() {
  $('scene-id').value = savedId || '';
  $('save-new').hidden = !savedId;
  dirty = JSON.stringify(editor.scene) !== saved;
  $('save').disabled = savingDraft || !dirty;
  $('revert').disabled = savingDraft || !dirty || JSON.stringify(editor.scene) === JSON.stringify(revertScene);
  $('dirty').textContent = dirty ? 'UNSAVED' : revision ? 'SAVED' : openedOriginal ? 'ORIGINAL' : 'CURRENT';
  $('undo').disabled = !editor.undoStack.length;
  $('redo').disabled = !editor.redoStack.length;
  updateApplyAvailability(); updateOriginalAvailability();
}

function updateApplyAvailability() {
  const differs = comparison?.differs;
  $('apply').disabled = applyRunning || !differs || !catalog?.capabilities.apply;
  $('apply').title = applyRunning ? 'Apply is running' : differs ? 'Review and apply layout changes' : 'This layout matches the current game';
}

function renderReferences() {
  $('references').replaceChildren();
  $('reference-count').textContent = editor.scene.references.length;
  for (const ref of editor.scene.references) {
    const button = document.createElement('button');
    button.className = 'reference' + (selectedReference === ref.id ? ' selected' : '');
    button.textContent = `${assetEntry(ref.asset).label} · ${ref.x}, ${ref.y}`;
    button.onclick = () => { selectedReference = ref.id; setTool('select'); renderReferences(); draw(); };
    $('references').append(button);
  }
  $('remove-reference').disabled = !editor.scene.references.some(r => r.id === selectedReference);
}

function changed() {
  comparison = null;
  // Invalidate any in-flight preview immediately; a stale response must not paint over an edit.
  previewSerial++;
  markChanged(); renderReferences();
  $('validation').textContent = 'Layout changed. Check the scene before exporting.';
  clearTimeout(previewTimer);
  previewTimer = setTimeout(guarded(refreshPreview), 90);
  draw();
}

async function refreshPreview() {
  const serial = ++previewSerial;
  const data = await json('preview', {scene: editor.scene, light: $('lighting').value,
    state: $('state').value, frame});
  const image = await loadImage(data.png);
  if (serial !== previewSerial) return;
  background = image; collision = data.collision; comparison = data.comparison; updateApplyAvailability();
  draw();
}

function draw() {
  if (!editor) return;
  $('deselect').disabled = !selection && !selectedReference;
  const width = editor.scene.width * cellSize, height = editor.scene.height * cellSize;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  canvas.style.width = `${width * Number($('zoom').value)}px`;
  canvas.style.height = `${height * Number($('zoom').value)}px`;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#292921'; ctx.fillRect(0, 0, width, height);
  if (background) ctx.drawImage(background, 0, 0);
  if ($('collision').checked) {
    ctx.fillStyle = '#db71534d';
    collision.forEach((row, y) => row.forEach((solid, x) => { if (solid) ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); }));
  }
  if ($('protected').checked) {
    ctx.fillStyle = '#d4b76735';
    for (const point of editor.locked) { const [x, y] = point.split(',').map(Number); ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize); }
  }
  if ($('grid').checked) {
    ctx.strokeStyle = '#00000045'; ctx.lineWidth = .25; ctx.beginPath();
    for (let x = cellSize; x < width; x += cellSize) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = cellSize; y < height; y += cellSize) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }
  const guide = catalog.profiles[editor.scene.profile].guide;
  if ($('guides').checked && guide) {
    ctx.strokeStyle = '#f3dc8f'; ctx.lineWidth = .5; ctx.setLineDash([2, 2]);
    const gx = Math.max(0, Math.min(hover?.tx || 0, Math.max(0, editor.scene.width - guide[0])));
    const gy = Math.max(0, Math.min(hover?.ty || 0, Math.max(0, editor.scene.height - guide[1])));
    ctx.strokeRect(gx * cellSize + .5, gy * cellSize + .5, Math.min(width, guide[0]*cellSize)-1, Math.min(height,guide[1]*cellSize)-1);
    ctx.setLineDash([]);
  }
  if ($('markers').checked) {
    ctx.font = `${Math.max(3,cellSize-2)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const marker of annotations) {
      ctx.fillStyle = '#171b16ca'; ctx.fillRect(marker.x*cellSize,marker.y*cellSize,cellSize,cellSize);
      ctx.fillStyle = '#e6d498'; ctx.fillText(marker.label,marker.x*cellSize+cellSize/2,marker.y*cellSize+cellSize/2);
    }
  }
  if (selection) {
    ctx.fillStyle = '#d4b76730'; ctx.strokeStyle = '#f2d67b'; ctx.lineWidth = .6;
    ctx.fillRect(selection.x * cellSize, selection.y * cellSize, selection.w * cellSize, selection.h * cellSize);
    ctx.strokeRect(selection.x * cellSize, selection.y * cellSize, selection.w * cellSize, selection.h * cellSize);
  }
  const ref = editor.scene.references.find(r => r.id === selectedReference);
  if (ref) {
    const r = assetRegion(ref.asset), origin = r.origin || [r.width / 2, r.height - 1];
    ctx.strokeStyle = '#f2d67b'; ctx.lineWidth = .6;
    ctx.strokeRect(ref.x - origin[0], ref.y - origin[1], r.width, r.height);
  }
  if (gesture?.type === 'move' && selection) {
    const p = gesture.current || gesture.p;
    const dx = p.tx - gesture.p.tx, dy = p.ty - gesture.p.ty;
    let valid = true;
    try {
      for (let y = 0; y < selection.h; y++) for (let x = 0; x < selection.w; x++) {
        editor.check(selection.x + x, selection.y + y);
        editor.check(selection.x + x + dx, selection.y + y + dy);
      }
    } catch { valid = false; }
    dragPreview(selection.x * cellSize, selection.y * cellSize, selection.w * cellSize, selection.h * cellSize,
      (selection.x + dx) * cellSize, (selection.y + dy) * cellSize, valid);
    $('coordinates').textContent = `Move to X ${selection.x + dx}   Y ${selection.y + dy}${valid ? '' : ' · blocked'}`;
  } else if (gesture?.type === 'reference') {
    const {ref, p} = gesture, current = gesture.current || p;
    const r = assetRegion(ref.asset), origin = r.origin || [r.width / 2, r.height - 1];
    const x = Math.max(0, Math.min(width - 1, ref.x + current.x - p.x));
    const y = Math.max(0, Math.min(height - 1, ref.y + current.y - p.y));
    dragPreview(ref.x - origin[0], ref.y - origin[1], r.width, r.height, x - origin[0], y - origin[1], true);
  }
  if (hover && ['paint', 'erase', 'fill', 'select'].includes(tool)) {
    const shape = ['erase', 'select'].includes(tool) ? [[editor.floor]] : brush?.cells || [[brush?.id]];
    ctx.strokeStyle = editor.locked.has(`${hover.tx},${hover.ty}`) ? '#ed886f' : '#e6d498';
    ctx.lineWidth = .6; ctx.strokeRect(hover.tx * cellSize, hover.ty * cellSize, (shape[0]?.length || 1) * cellSize, shape.length * cellSize);
  }
}

function dragPreview(sx, sy, w, h, x, y, valid) {
  ctx.save();
  ctx.globalAlpha = .7;
  if (background) ctx.drawImage(background, sx, sy, w, h, x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = valid ? '#d4b76730' : '#ed886f55';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = valid ? '#f2d67b' : '#ed886f'; ctx.lineWidth = 1;
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  ctx.restore();
}

let hover = null;
function point(event) {
  const p = canvasPoint(event, canvas.getBoundingClientRect(), canvas.width, canvas.height);
  return {...p, tx: Math.floor(p.x / cellSize), ty: Math.floor(p.y / cellSize)};
}
function setTool(value) {
  tool = value;
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === value)));
  canvas.style.cursor = value === 'pan' ? 'grab' : value === 'select' ? 'default' : 'crosshair';
  draw();
}
function paint(p) {
  if (tool === 'erase') editor.stamp(p.tx, p.ty, [[editor.floor]]);
  else if (tool === 'fill') {
    if (!brush || brush.cells || brush.reference) throw Error('Choose an individual tile for flood fill.');
    editor.fill(p.tx, p.ty, brush.id);
  } else if (brush?.reference) {
    editor.change(scene => scene.references.push({id: crypto.randomUUID(), asset: brush.id, x: p.x, y: p.y}));
    selectedReference = editor.scene.references.at(-1).id;
  } else if (brush) editor.stamp(p.tx, p.ty, brush.cells || [[brush.id]]);
  else throw Error('Choose a compatible brush from the asset library.');
}

canvas.addEventListener('pointerdown', guarded(event => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  $('viewport').focus();
  const p = point(event);
  if (tool === 'pan' || event.button === 1) {
    gesture = {type: 'pan', x: event.clientX, y: event.clientY, left: $('viewport').scrollLeft, top: $('viewport').scrollTop};
  } else if (tool === 'select') {
    const ref = [...editor.scene.references].reverse().find(ref => {
      const r = assetRegion(ref.asset), o = r.origin || [r.width / 2, r.height - 1];
      return p.x >= ref.x - o[0] && p.x < ref.x - o[0] + r.width && p.y >= ref.y - o[1] && p.y < ref.y - o[1] + r.height;
    });
    selectedReference = ref?.id || null;
    if (ref) gesture = {type: 'reference', p, ref: clone(ref)};
    else if (selection && p.tx >= selection.x && p.ty >= selection.y && p.tx < selection.x + selection.w && p.ty < selection.y + selection.h) gesture = {type: 'move', p};
    else { selection = {x: p.tx, y: p.ty, w: 1, h: 1}; gesture = {type: 'selection', p}; }
    renderReferences(); draw();
  } else {
    editor.begin(); gesture = {type: 'paint', last: null};
    paint(p); gesture.last = `${p.tx},${p.ty}`; changed();
    if (tool === 'fill' || brush?.reference) { editor.end(); gesture = null; markChanged(); }
  }
}));

canvas.addEventListener('pointermove', guarded(event => {
  const p = point(event); hover = p;
  if (gesture) gesture.current = p;
  $('coordinates').textContent = `X ${p.tx.toString().padStart(2, '0')}   Y ${p.ty.toString().padStart(2, '0')}`;
  canvas.title = `${editor.scene.cells[p.ty]?.[p.tx] || 'Outside scene'}${editor.reasons.has(`${p.tx},${p.ty}`) ? ' · '+editor.reasons.get(`${p.tx},${p.ty}`) : ''}`;
  if (gesture?.type === 'pan') {
    $('viewport').scrollLeft = gesture.left - event.clientX + gesture.x;
    $('viewport').scrollTop = gesture.top - event.clientY + gesture.y;
  } else if (gesture?.type === 'selection') {
    const tx = Math.max(0, Math.min(editor.scene.width - 1, p.tx)), ty = Math.max(0, Math.min(editor.scene.height - 1, p.ty));
    selection = {x: Math.min(gesture.p.tx, tx), y: Math.min(gesture.p.ty, ty), w: Math.abs(gesture.p.tx - tx) + 1, h: Math.abs(gesture.p.ty - ty) + 1};
  } else if (gesture?.type === 'paint' && gesture.last !== `${p.tx},${p.ty}`) {
    // Interpolate fast strokes so pointer sampling cannot leave holes in a brush line.
    const [lx, ly] = (gesture.last || `${p.tx},${p.ty}`).split(',').map(Number);
    const count = Math.max(Math.abs(lx - p.tx), Math.abs(ly - p.ty));
    for (let i = 1; i <= count; i++) {
      const tx = Math.round(lx + (p.tx - lx) * i / count), ty = Math.round(ly + (p.ty - ly) * i / count);
      try { paint({...p, tx, ty}); } catch (error) { status(error.message); }
    }
    gesture.last = `${p.tx},${p.ty}`; changed();
  }
  draw();
}));

canvas.addEventListener('pointerup', guarded(event => {
  const g = gesture; gesture = null;
  editor.end();
  if (g?.type === 'move') {
    const p = point(event), dx = p.tx - g.p.tx, dy = p.ty - g.p.ty;
    try {
      editor.move(selection, dx, dy); selection = {...selection, x: selection.x + dx, y: selection.y + dy}; changed();
    } catch (error) { status(error.message); }
  } else if (g?.type === 'reference') {
    const p = point(event);
    editor.change(scene => {
      const ref = scene.references.find(r => r.id === g.ref.id);
      ref.x = Math.max(0, Math.min(scene.width * cellSize - 1, g.ref.x + p.x - g.p.x));
      ref.y = Math.max(0, Math.min(scene.height * cellSize - 1, g.ref.y + p.y - g.p.y));
    }); changed();
  }
  markChanged(); draw();
}));
canvas.addEventListener('pointercancel', () => { gesture = null; editor.cancel(); changed(); });
canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
canvas.addEventListener('dragover', event => event.preventDefault());
canvas.addEventListener('drop', guarded(event => {
  event.preventDefault();
  const id = event.dataTransfer.getData('text/plain');
  const entry = entries().find(e => e.id === id && e.available);
  if (!entry) throw Error('This asset is unavailable for the selected scene.');
  chooseBrush(entry); const p = point(event); paint(p); changed();
  status(entry.reference ? 'Composition reference placed.' : 'Placement added.');
}));

function assetEntry(id) {
  const entry = catalog.entries.find(entry => entry.id === id);
  if (!entry) throw Error('Unknown asset');
  return entry;
}
function assetRegion(id) { return assetEntry(id).rect; }
function entries() {
  return catalog.entries.map(entry => ({...entry, available:entry.profiles.includes(editor.scene.profile)}));
}
function tileRegion(id) { return assetEntry(id).rect; }

function thumbnail(entry) {
  const thumb = document.createElement('canvas');
  const cells = entry.cells || [[entry.id]];
  if (entry.rect) {
    const r = entry.rect;
    thumb.width = r.width; thumb.height = r.height;
    thumb.getContext('2d').drawImage(images.get(entry.family), r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  } else {
    thumb.width = cells[0].length * cellSize; thumb.height = cells.length * cellSize;
    cells.forEach((row, y) => row.forEach((id, x) => {
      const family = assetEntry(id).family, r = tileRegion(id);
      thumb.getContext('2d').drawImage(images.get(family), r.x, r.y, cellSize, cellSize, x * cellSize, y * cellSize, cellSize, cellSize);
    }));
  }
  const scale = Math.max(1, Math.min(4, Math.floor(48 / Math.max(thumb.width, thumb.height))));
  thumb.style.width = `${thumb.width * scale}px`; thumb.style.height = `${thumb.height * scale}px`;
  return thumb;
}

function chooseBrush(entry) {
  if (!entry.available) { status('This tile is visible for reference; its loader or palette is unavailable in this profile.'); return; }
  brush = entry; setTool('paint');
  $('selected-brush').textContent = entry.label + (entry.reference ? ' · reference' : '');
  renderAssets();
}

function renderAssets() {
  const query = $('search').value.toLowerCase(), kind = $('kind').value, family = $('family').value;
  const items = entries().filter(e => (!family || e.family === family) &&
    (!query || `${e.label} ${e.family}`.toLowerCase().includes(query)) &&
    (kind === 'all' || kind === 'placeable' && e.available && !e.reference || kind === 'sprite' && e.reference || kind === 'tile' && !e.reference));
  $('asset-count').textContent = items.length;
  const fragment = document.createDocumentFragment();
  for (const entry of items) {
    const button = document.createElement('button');
    button.className = 'asset' + (entry.available ? '' : ' unavailable') + (brush?.id === entry.id ? ' selected' : '');
    button.draggable = entry.available;
    button.title = `${entry.family} · ${entry.label}${entry.available ? '' : ' · unavailable in this profile'}`;
    button.setAttribute('aria-pressed', String(brush?.id === entry.id));
    button.append(thumbnail(entry));
    const label = document.createElement('span'); label.textContent = entry.label; button.append(label);
    const type = document.createElement('span'); type.className = 'type'; type.textContent = entry.reference ? 'REFERENCE' : entry.cells ? 'STAMP' : entry.available ? 'BRUSH' : 'VIEW ONLY'; button.append(type);
    button.onclick = () => chooseBrush(entry);
    button.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', entry.id); event.dataTransfer.effectAllowed = 'copy'; });
    fragment.append(button);
  }
  $('assets').replaceChildren(fragment);
}

async function mayReplace() {
  if (!dirty) return true;
  const dialog = $('discard'); dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), {once: true}));
}

async function activate(data) {
  clearTimeout(previewTimer); previewSerial++;
  const current = await json('scene/' + data.scene.profile);
  const locked = current.locked;
  const descriptor = {...catalog.profiles[data.scene.profile],constraints:current.constraints};
  cellSize = descriptor.cell_size; annotations = current.markers || []; comparison = null;
  gameScene = current.scene;
  editor = new Editor(data.scene, locked, descriptor); revision = data.revision || null;
  openedOriginal = data.original === true;
  revertScene = clone(editor.scene);
  savedId = revision ? data.scene.id : null; saved = JSON.stringify(editor.scene);
  selection = null; selectedReference = null; background = null; gesture = null;
  $('profile').value = editor.scene.profile;
  updateOriginalAvailability();
  $('name').value = editor.scene.name;
  const profile = catalog.profiles[editor.scene.profile];
  clearInterval(animationTimer); frame = 0;
  if (profile.animation_frames) animationTimer = setInterval(animateFrame, profile.animation_interval_ms);
  $('lighting').replaceChildren(...profile.lighting.map(l => new Option(l[0].toUpperCase() + l.slice(1), l)));
  $('state').replaceChildren(...profile.states.map(mode => new Option(mode.label,mode.id)));
  $('state-field').hidden = profile.states.length < 2;
  $('animate').parentElement.hidden = !profile.animation_frames;
  $('animation-label').textContent = profile.animation_label || 'Animate';
  $('guides').parentElement.hidden = !profile.guide;
  $('source-label').textContent = `${catalog.project.source_label} · ${cellSize} × ${cellSize} TILES`;
  $('dimensions').textContent = `${editor.scene.width} × ${editor.scene.height} TILES`;
  $('scene-type').textContent = `${profile.type.toUpperCase()} · ${editor.scene.width * cellSize} × ${editor.scene.height * cellSize} px`;
  $('validation').textContent = 'Check the layout before exporting.';
  const initial = entries().find(e => e.id === editor.floor); chooseBrush(initial); setTool('select');
  markChanged(); renderReferences(); await refreshPreview();
  status('Scene loaded. Production sources are unchanged.');
}

async function refreshDrafts() {
  const [drafts, available] = await Promise.all([json('drafts'), json('originals')]);
  originals = new Set(available); updateOriginalAvailability();
  $('drafts').replaceChildren(new Option('Saved drafts…', ''), ...drafts.map(d => new Option(d.name, d.id)));
  $('delete-drafts').disabled = !drafts.length;
}

let deletableDrafts = [];
$('delete-drafts').onclick = guarded(async () => {
  deletableDrafts = await json('drafts');
  const list = $('delete-drafts-list'); list.replaceChildren();
  $('delete-drafts-error').textContent = '';
  $('delete-drafts-confirm').disabled = true;
  for (const draft of deletableDrafts) {
    const row = document.createElement('label');
    const check = document.createElement('input'); check.type = 'checkbox'; check.value = draft.id;
    check.onchange = () => { $('delete-drafts-confirm').disabled = !list.querySelector('input:checked'); };
    row.append(check, document.createTextNode(`${draft.name} (${draft.id})`)); list.append(row);
  }
  if (!deletableDrafts.length) list.textContent = 'No saved drafts.';
  $('delete-drafts-dialog').showModal();
});
$('delete-drafts-cancel').onclick = () => $('delete-drafts-dialog').close();
$('delete-drafts-confirm').onclick = async () => {
  const button = $('delete-drafts-confirm'); button.disabled = true;
  const selected = new Set([...$('delete-drafts-list').querySelectorAll('input:checked')].map(input => input.value));
  try {
    const result = await json('delete-drafts', {drafts: deletableDrafts.filter(d => selected.has(d.id)).map(({id, revision}) => ({id, revision}))});
    if (result.deleted.includes(savedId)) { savedId = null; revision = null; saved = ''; markChanged(); }
    $('delete-drafts-dialog').close();
    await refreshDrafts(); status(`Deleted ${result.deleted.length} saved draft(s). Current canvas and game files are unchanged.`);
  } catch (error) {
    $('delete-drafts-error').textContent = error.message;
  } finally { button.disabled = false; }
};

function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function validate() {
  const result = await json('validate', {scene: editor.scene});
  const div = $('validation'); div.replaceChildren();
  const line = document.createElement('p'); line.className = result.valid ? 'success' : 'error';
  line.textContent = result.valid ? '✓ Layout passes game-source checks.' : 'Layout needs attention.'; div.append(line);
  for (const error of result.errors) { const p = document.createElement('p'); p.className = 'error'; p.textContent = error; div.append(p); }
  status(result.valid ? 'Layout validated. Visual review and ROM checks remain part of the handoff.' : 'Export blocked. Review the scene errors.');
  return result;
}

document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
for (const id of ['search', 'family', 'kind']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderAssets);
for (const id of ['grid', 'markers', 'collision', 'protected', 'guides', 'zoom']) $(id).onchange = draw;
for (const id of ['lighting', 'state']) $(id).onchange = guarded(refreshPreview);
$('undo').onclick = () => { editor.undo(); selection = null; changed(); };
$('redo').onclick = () => { editor.redo(); selection = null; changed(); };
$('open').onclick = guarded(async () => { if (await mayReplace()) await activate(await json('scene/' + $('profile').value)); });
function updateOriginalAvailability() {
  const target = $('profile').value;
  $('original').hidden = !originals.has(target);
  $('original').disabled = !!editor && target === editor.scene.profile && openedOriginal && !savedId && !dirty;
}
$('profile').onchange = updateOriginalAvailability;
$('original').onclick = guarded(async () => {
  if (await mayReplace()) {
    await activate(await json('original/' + $('profile').value));
    status('Original layout loaded. Review and Apply to game to restore it; game files are unchanged.');
  }
});
$('new').onclick = guarded(async () => { if (await mayReplace()) { await activate(await json('new', {profile: $('profile').value})); saved = ''; markChanged(); status('Template created. Name your draft before saving.'); } });
$('drafts').onchange = guarded(async () => { const id = $('drafts').value; if (id && await mayReplace()) await activate(await json('draft/' + id)); $('drafts').value = ''; });
$('import').onclick = () => $('file').click();
$('file').onchange = guarded(async () => {
  const file = $('file').files[0]; $('file').value = ''; if (!file || !await mayReplace()) return;
  if (file.size > 1024 * 1024) throw Error('Scene JSON must be smaller than 1 MiB.');
  const scene = JSON.parse(await file.text());
  // Preview uses the same authoritative structural validation as saving/export.
  await activate(await json('import',{scene})); saved = ''; markChanged(); status('JSON imported. Saving creates a separate draft.');
});
$('name').onchange = () => { editor.change(scene => { scene.name = $('name').value; }); changed(); };
let savingDraft = false;
async function saveDraft(asNew = false) {
  if (savingDraft) return;
  savingDraft = true; $('save').disabled = true; $('save-new').disabled = true;
  const documentEditor = editor, snapshot = clone(editor.scene);
  try {
    const result = await json('save', {scene: snapshot, saved_id: asNew ? null : savedId, revision: asNew ? null : revision});
    if (editor === documentEditor) {
      editor.scene.id = result.id; snapshot.id = result.id;
      revision = result.revision; savedId = result.id; saved = JSON.stringify(snapshot);
      revertScene = clone(snapshot); markChanged();
    }
    await refreshDrafts(); status(`Saved ${result.path}`);
  } finally { savingDraft = false; $('save-new').disabled = false; markChanged(); }
}
$('save').onclick = guarded(() => saveDraft());
$('save-new').onclick = guarded(() => saveDraft(true));
$('revert').onclick = guarded(async () => {
  if ($('revert').disabled) return;
  const dialog = $('revert-dialog'); dialog.returnValue = ''; dialog.showModal();
  const confirmed = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'revert'), {once: true}));
  if (!confirmed) return;
  clearTimeout(previewTimer); previewSerial++;
  revertScene.source_digest = gameScene.source_digest;
  editor = new Editor(revertScene, [...editor.locked].map(point => point.split(',').map(Number)), editor.descriptor);
  selection = null; selectedReference = null; gesture = null;
  $('name').value = editor.scene.name;
  $('validation').textContent = 'Check the layout before exporting.';
  markChanged(); renderReferences(); await refreshPreview();
  status('Reverted to the last saved or opened scene. Game files are unchanged.');
});
$('download').onclick = guarded(async () => download(await (await api('document',{scene:editor.scene})).blob(), editor.scene.id + '.scene.json'));
$('validate').onclick = guarded(validate);
$('export').onclick = guarded(async () => {
  if (!(await validate()).valid) return;
  const response = await api('export', {scene: editor.scene});
  download(await response.blob(), editor.scene.id + '.zip'); status('Handoff exported. Start with HANDOFF.md and the review previews.');
});
async function refreshLastApply() {
  lastApply = await json('last-apply', undefined, {timeoutMs: 8000});
  $('undo-apply').disabled = !lastApply.transaction || applyRunning;
  $('undo-apply').title = lastApply.label ? `Restore the game before ${lastApply.label}` : 'No scene has been applied';
}

function showApplyProgress() {
  $('review-content').hidden = true; $('approve-label').hidden = true;
  $('apply-progress').hidden = false; $('apply-confirm').hidden = true;
  $('apply-close').disabled = true; $('apply-close').textContent = 'Done';
  $('apply-result').textContent = '';
  $('apply-details').open = false;
  $('apply-reconnect').hidden = true;
  if (!$('apply-review').open) $('apply-review').showModal();
}

function displayProgress() {
  updateApplyAvailability();
  const now = latestJob?.server_time ? latestJob.server_time + (Date.now() - receivedAt) / 1000 : Date.now() / 1000;
  const view = progressView(latestJob, now, connectionError);
  $('apply-health').dataset.state = view.state;
  $('apply-step').textContent = view.label;
  $('apply-activity').textContent = view.activity;
  $('apply-timing').textContent = view.detail;
  $('apply-reconnect').hidden = !connectionError;
  if (connectionError) {
    $('apply-close').disabled = false; $('apply-close').textContent = 'Close status';
    $('apply-result').textContent = 'This is a connection problem, not a confirmed build failure. Closing this status window does not cancel Apply.';
  } else {
    $('apply-close').disabled = applyRunning; $('apply-close').textContent = 'Done';
  }
}

async function watchApply(jobId) {
  const generation = ++monitorGeneration;
  monitoredJobId = jobId; latestJob = null; connectionError = '';
  applyRunning = true; showApplyProgress(); displayProgress();
  const ticker = setInterval(displayProgress, 500);
  try {
    while (generation === monitorGeneration) {
      let job;
      try {
        job = await json('apply-status/' + jobId, undefined, {timeoutMs: 8000});
        if (generation !== monitorGeneration) return;
        latestJob = job; receivedAt = Date.now(); connectionError = '';
      } catch (error) {
        if (generation !== monitorGeneration) return;
        connectionError = error.message;
        displayProgress();
        status('Cannot confirm Apply status. Reconnecting; the task may still be running.');
        if (error.status >= 400 && error.status < 500) {
          $('apply-result').textContent = `${error.message} Task status is unavailable. Check the current game and last Apply before starting another task.`;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      displayProgress();
      $('apply-log').textContent = job.log || '';
      if (job.status === 'complete') {
        $('apply-result').textContent = job.message;
        // Rebase the open draft without replacing edits made while disconnected.
        try {
          const baseline = editor.scene.profile === job.profile ? job.scene : (await json('scene/' + editor.scene.profile)).scene;
          gameScene = baseline;
          editor.scene.source_digest = baseline.source_digest; comparison = null;
          markChanged(); await refreshPreview();
        } catch (error) { $('apply-result').textContent += `\nThe game was applied, but the preview could not refresh: ${error.message}`; }
        status(job.message || 'Reviewed changes applied.');
        break;
      }
      if (job.status === 'failed') {
        $('apply-result').textContent = `${job.failed_step ? `Failed during: ${job.failed_step}\n` : ''}${job.error}`;
        $('apply-details').open = true;
        status(`Apply stopped: ${job.error}`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  } finally {
    clearInterval(ticker);
    if (generation === monitorGeneration) {
      applyRunning = false; $('apply-close').disabled = false;
      updateApplyAvailability();
      try { await refreshLastApply(); } catch { /* Preserve the task's primary result when disconnected. */ }
    }
  }
}

$('apply').onclick = guarded(async () => {
  updateApplyAvailability();
  if ($('apply').disabled) return;
  status('Preparing the layout review…');
  const review = await json('apply-review', {scene: editor.scene});
  reviewId = review.id;
  monitoredJobId = null; latestJob = null; connectionError = '';
  $('apply-summary').textContent = `${review.changed_cells} changed cells in ${review.target}. ${review.note}`;
  $('apply-views').replaceChildren();
  for (const view of review.views) {
    const heading = document.createElement('h3'); heading.textContent = view.label;
    const comparison = document.createElement('div'); comparison.className = 'review-comparison';
    for (const [key, label] of [['before', 'Current game'], ['after', 'Proposed layout']]) {
      const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = label;
      const images = document.createElement('div'); images.className = 'review-images';
      for (const scale of [1, 4]) {
        const image = await loadImage(view[key]); image.alt = `${label}, ${view.label}, ${scale}×`;
        image.width = image.naturalWidth * scale; image.height = image.naturalHeight * scale; images.append(image);
      }
      figure.append(caption, images); comparison.append(figure);
    }
    $('apply-views').append(heading, comparison);
  }
  $('apply-files').replaceChildren(...review.files.map(name => { const li = document.createElement('li'); li.textContent = name; return li; }));
  $('approve-layout').checked = false; $('apply-confirm').disabled = true; $('apply-confirm').hidden = false;
  $('approve-label').hidden = false; $('review-content').hidden = false; $('apply-progress').hidden = true;
  $('apply-close').disabled = false; $('apply-close').textContent = 'Cancel';
  $('apply-review').showModal(); status('Review the proposed layout before applying it.');
});
$('approve-layout').onchange = () => { $('apply-confirm').disabled = !$('approve-layout').checked; };
$('apply-confirm').onclick = guarded(async () => {
  if (!$('approve-layout').checked) return;
  $('apply-confirm').disabled = true;
  try {
    const job = await json('apply', {review: reviewId, approved: true}, {timeoutMs: 8000});
    await watchApply(job.id);
  } catch (error) {
    if (!error.status) { await watchApply(reviewId); return; }
    showApplyProgress(); applyRunning = false;
    latestJob = {status: 'failed', step: 'Apply could not start', error: error.message, started_at: Date.now()/1000, ended_at: Date.now()/1000};
    displayProgress(); $('apply-result').textContent = error.message; $('apply-close').disabled = false;
    status(error.message);
  }
});
async function closeApplyProgress() {
  if (applyRunning && !connectionError) return;
  monitorGeneration++; applyRunning = false;
  updateApplyAvailability();
  if (monitoredJobId && latestJob?.status && latestJob.status !== 'running') {
    try { await json('apply-dismiss', {job: monitoredJobId}, {timeoutMs: 8000}); } catch { /* Can be acknowledged after reconnecting. */ }
  }
  $('apply-review').close();
}
$('apply-close').onclick = guarded(closeApplyProgress);
$('apply-review').addEventListener('cancel', event => { event.preventDefault(); guarded(closeApplyProgress)(); });
$('apply-reconnect').onclick = guarded(async () => { if (monitoredJobId) await watchApply(monitoredJobId); });
$('apply-download-log').onclick = () => {
  const report = [`Task: ${monitoredJobId || 'unknown'}`, `Status: ${latestJob?.status || 'unavailable'}`, `Step: ${latestJob?.failed_step || latestJob?.step || 'unknown'}`, `Command: ${latestJob?.process?.command || 'unavailable'}`, `Exit code: ${latestJob?.process?.return_code ?? 'unavailable'}`, latestJob?.error || connectionError, '', latestJob?.log || 'No task output received.'].join('\n');
  download(new Blob([report], {type: 'text/plain'}), `scene-apply-${monitoredJobId || 'status'}.log`);
};
$('undo-apply').onclick = guarded(async () => {
  if (!lastApply?.transaction) return;
  const result = await json('undo-apply', {transaction: lastApply.transaction, profile: editor.scene.profile});
  gameScene = result.scene;
  editor.scene.source_digest = result.scene.source_digest;
  changed(); await refreshLastApply();
  status('Previous project files restored. Your current draft remains open.');
});
$('remove-reference').onclick = () => { editor.change(scene => { scene.references = scene.references.filter(r => r.id !== selectedReference); }); selectedReference = null; changed(); };
function deselect() {
  const painting = editor.stroke !== null;
  gesture = null; editor.cancel(); selection = null; selectedReference = null;
  if (painting) changed();
  else { renderReferences(); draw(); }
  status('Selection cleared.');
}
$('deselect').onclick = deselect;
document.addEventListener('keydown', guarded(event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); event.shiftKey ? editor.redo() : editor.undo(); selection = null; changed(); }
  else if ((event.metaKey || event.ctrlKey) && key === 's') { event.preventDefault(); $('save').click(); }
  else if (key === 'escape') { event.preventDefault(); deselect(); }
  else if (key === 'delete' || key === 'backspace') {
    event.preventDefault(); if (selectedReference) $('remove-reference').click(); else if (selection) { editor.erase(selection); changed(); }
  } else if (!event.metaKey && !event.ctrlKey && ({p:'paint',s:'select',f:'fill',e:'erase',h:'pan'})[key]) setTool(({p:'paint',s:'select',f:'fill',e:'erase',h:'pan'})[key]);
}));
window.addEventListener('beforeunload', event => { if (dirty || applyRunning) { event.preventDefault(); event.returnValue = ''; } });
function animateFrame() { const count = editor && catalog.profiles[editor.scene.profile].animation_frames; if ($('animate').checked && count && !gesture && !$('apply-review').open) { frame = (frame + 1) % count; guarded(refreshPreview)(); } }

guarded(async () => {
  catalog = await json('catalog'); token = catalog.token;
  await Promise.all(catalog.families.map(async f => images.set(f.id, await loadImage(f.url))));
  $('family').append(...catalog.families.map(f => new Option(f.id.replaceAll('-', ' '), f.id)));
  $('profile').replaceChildren(...Object.entries(catalog.profiles).map(([id,p]) => new Option(p.label,id)));
  $('project-name').textContent = catalog.project.name; document.title = catalog.project.label;
  $('apply').hidden = !catalog.capabilities.apply; $('export').hidden = !catalog.capabilities.export;
  $('new').hidden = !catalog.capabilities.templates;
  $('reference-panel').hidden = !catalog.capabilities.references;
  document.querySelector('#kind option[value="sprite"]').hidden = !catalog.capabilities.references;
  await activate(await json('scene/'+Object.keys(catalog.profiles)[0]));
  await refreshDrafts();
  await refreshLastApply();
  const active = await json('apply-active');
  if (active.id) await watchApply(active.id);
})();
