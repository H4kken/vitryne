// SPDX-License-Identifier: AGPL-3.0-or-later
import init, { App } from './pkg/drape_web.js';
import { loadTshirtAssets } from './assets.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
// With &post=1, progress and errors also go to the dev server (bench-out/<dir>/<name>.log.json), so
// browsers we can't automate (Safari) still tell us what happened.
const report = (kind, text) => q.get('post') === '1' && fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent((q.get('name') ?? 'browser') + '.log')}`, { method: 'POST', body: JSON.stringify({ kind, text, t: performance.now(), ua: navigator.userAgent }) }).catch(() => {});
window.addEventListener('error', (e) => report('error', String(e.message)));
window.addEventListener('unhandledrejection', (e) => report('error', String(e.reason?.message ?? e.reason)));
const canvas = $('gfx');
const status = $('status');
let app = null;
let assets = null;
let fps = 0;
let frameMs = NaN;

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  app?.resize(canvas.width, canvas.height);
}

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
}

// Scene value: "<scene>:<res>[:nopins]"; self-collision from the checkbox.
async function load(sceneRes) {
  const [scene, res, extra] = sceneRes.split(':');
  const opts = JSON.stringify({ self_collision: $('selfc').checked, pins: extra !== 'nopins', ...(q.has('rebuild') ? { self_rebuild: parseInt(q.get('rebuild'), 10) } : {}), ...(q.has('ut') ? { untangle_every: parseInt(q.get('ut'), 10) } : {}) });
  status.textContent = `loading ${scene}…`;
  if (scene === 'tshirt' && !assets) assets = await loadTshirtAssets(q);
  fitCanvas();
  const a = assets ?? { obj: '', sdf: new Uint8Array() };
  app?.free();
  app = null;
  app = await App.create('gfx', scene, parseFloat(res), opts, scene === 'tshirt' ? a.obj : '', scene === 'tshirt' ? a.sdf : new Uint8Array());
  status.textContent = q.get('auto') === '1' ? 'auto test running…' : 'ok: running';
  status.className = '';
}

// Render loop + stats.
let frames = 0;
let t0 = performance.now();
function tick() {
  if (app) {
    app.frame();
    frames++;
    const now = performance.now();
    if (now - t0 >= 1000) {
      fps = (frames * 1000) / (now - t0);
      frames = 0;
      t0 = now;
      app.measure_frame().then((ms) => (frameMs = ms));
      $('stats').textContent = `${app.vertices()} verts · ${fps.toFixed(0)} fps · work ${frameMs.toFixed(2)} ms/frame (sim+render) · sim t ${app.sim_time().toFixed(1)} s`;
    }
  }
  requestAnimationFrame(tick);
}

// Input.
let orbiting = null;
canvas.addEventListener('pointerdown', async (e) => {
  if (!app) return;
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = ndc(e);
  orbiting = { x: e.clientX, y: e.clientY, pending: true };
  const grabbed = await app.pointer_down(x, y);
  if (grabbed) orbiting = null;
  else if (orbiting) orbiting.pending = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (!app) return;
  if (app.dragging()) {
    const [x, y] = ndc(e);
    app.pointer_move(x, y);
  } else if (orbiting && !orbiting.pending) {
    app.orbit(e.clientX - orbiting.x, e.clientY - orbiting.y);
    orbiting.x = e.clientX;
    orbiting.y = e.clientY;
  }
});
canvas.addEventListener('pointerup', () => {
  orbiting = null;
  app?.pointer_up();
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); app?.zoom(-e.deltaY / 100); }, { passive: false });
window.addEventListener('resize', fitCanvas);
const toggle = (btn, on) => btn.classList.toggle('on', on);
$('fast').onclick = () => { const on = !$('fast').classList.contains('on'); toggle($('fast'), on); app?.set_fast(on); };
$('pause').onclick = () => { const on = !$('pause').classList.contains('on'); toggle($('pause'), on); app?.set_paused(on); };
$('reset').onclick = () => app?.reset();
$('scene').onchange = () => load($('scene').value).catch(fail);
$('selfc').onchange = () => load($('scene').value).catch(fail);
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') $('fast').click();
  if (e.key === ' ') $('pause').click();
  if (e.key === 'r' || e.key === 'R') $('reset').click();
  if (e.key === 'c' || e.key === 'C') $('selfc').click();
});

function fail(e) {
  report('error', String(e?.message ?? e));
  status.textContent = 'error: ' + (e?.message ?? e);
  status.className = 'err';
  console.error(e);
}

// Automation: ?auto=1 [&scene=tshirt:0.00864] [&sc=1] [&rebuild=k] [&ut=N] [&post=1&name=X]
// Fast-drapes until sim t >= 6 s, then drags the cloth at the view centre in a circle for 3 s
// at normal speed, measuring rAF fps and the sampled GPU frame cost, then reports.
async function autoTest() {
  const sleepFrames = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  report('progress', 'loaded, fast-draping');
  const tLoad = performance.now();
  app.set_fast(true);
  while (app.sim_time() < 6) await sleepFrames(1);
  const drapeWall = (performance.now() - tLoad) / 1000;
  app.set_fast(false);
  const grabbed = await app.pointer_down(0, 0);
  const costs = [];
  let n = 0;
  const tDrag = performance.now();
  while (performance.now() - tDrag < 3000) {
    const a = ((performance.now() - tDrag) / 3000) * Math.PI * 2;
    app.pointer_move(0.12 * Math.sin(a), 0.12 * (1 - Math.cos(a)));
    await sleepFrames(1);
    if (++n % 10 === 0) costs.push(await app.measure_frame());
  }
  const dragFps = (n * 1000) / (performance.now() - tDrag);
  app.pointer_up();
  await sleepFrames(30);
  costs.sort((x, y) => x - y);
  const rep = {
    user_agent: navigator.userAgent,
    scene: q.get('scene') ?? $('scene').value,
    self_collision: $('selfc').checked,
    vertices: app.vertices(),
    load: JSON.parse(app.load_info() || '{}'),
    asset_fetch_ms: assets?.fetch_ms,
    sdf_download_bytes: assets?.sdf_download_bytes,
    fast_drape_wall_s_to_sim_6s: drapeWall,
    grabbed,
    drag_fps_raf: dragFps,
    drag_frame_cost_ms: { median: costs[costs.length >> 1], max: costs[costs.length - 1], samples: costs.length },
    adapter: JSON.parse(app.adapter_report()),
    screenshot: canvas.toDataURL('image/jpeg', 0.7),
  };
  $('report').textContent = JSON.stringify(rep);
  if (q.get('post') === '1') {
    await fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent(q.get('name') ?? 'viewer')}`, { method: 'POST', body: JSON.stringify(rep) });
  }
  status.textContent = `ok: auto test done (${dragFps.toFixed(0)} fps while dragging)`;
}

(async () => {
  if (!navigator.gpu) throw new Error('navigator.gpu missing: this browser has no WebGPU (WebGL fallback is disabled by design)');
  await init();
  if (q.has('scene')) $('scene').value = q.get('scene');
  if (q.get('sc') === '1') $('selfc').checked = true;
  await load($('scene').value);
  requestAnimationFrame(tick);
  if (q.get('auto') === '1') await autoTest();
})().catch(fail);
