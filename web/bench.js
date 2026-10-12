import init, { run_bench, run_drag_bench, bake_sdf_ms } from './pkg/drape_web.js';
import { loadGarmentAssets, loadTshirtAssets } from './assets.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
// With &post=1, progress and errors also go to the dev server (bench-out/<dir>/<name>.log.json), so
// browsers we can't automate (Safari) still tell us what happened.
const report = (kind, text) => q.get('post') === '1' && fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent((q.get('name') ?? 'browser') + '.log')}`, { method: 'POST', body: JSON.stringify({ kind, text, t: performance.now(), ua: navigator.userAgent }) }).catch(() => {});
window.addEventListener('error', (e) => report('error', String(e.message)));
window.addEventListener('unhandledrejection', (e) => report('error', String(e.reason?.message ?? e.reason)));
const status = $('status');
const results = [];
let assets = null;

const f2 = (x) => (x == null ? '—' : x.toFixed(2));
const DRAPE_COLS = [
  ['scene', (r) => r.scene ?? 'sheet'],
  ['vertices', (r) => r.mesh.vertices],
  ['substeps', (r) => (r.sim ?? r.config.sim).substeps],
  ['dispatches', (r) => r.mesh.dispatches_per_frame],
  ['pipelined ms', (r) => f2(r.frame_ms_pipelined)],
  ['serial med ms', (r) => f2(r.frame_ms_serial.median)],
  ['rest frame', (r) => r.rest_frame ?? '—'],
  ['rest wall s', (r) => f2(r.rest_wall_s_pipelined)],
  ['max v', (r) => f2(r.max_speed)],
  ['NaN frames', (r) => r.non_finite_frames],
  ['max pen mm', (r) => f2(r.penetration?.max_penetration_mm)],
  ['seam gap mm', (r) => f2(r.max_seam_gap_mm)],
  ['self-coll', (r) => (r.self_collision ? `on, k=${r.self_collision.rebuild_every}${r.self_collision.untangle ? `, untangle ${r.self_collision.untangle.every}` : ''}` : 'off')],
  ['self-isect final', (r) => r.self_intersections_final?.pairs],
  ['persistent', (r) => r.self_intersections_after_pipelined?.persistent_pairs],
];
const DRAG_COLS = [
  ['scene', (r) => r.scene],
  ['vertices', (r) => r.vertices],
  ['seed', (r) => r.config.seed],
  ['episodes', (r) => r.episodes.length],
  ['max v', (r) => f2(r.max_speed)],
  ['frames >5 m/s', (r) => r.frames_over_5ms],
  ['longest run >5', (r) => r.max_consecutive_frames_over_5ms],
  ['stable (S3)', (r) => (r.stable ? 'yes' : 'NO')],
  ['verts >5 m/s', (r) => r.max_vertices_over_5ms],
  ['NaN frames', (r) => r.non_finite_frames],
  ['pen after mm', (r) => f2(r.penetration_after?.max_penetration_mm)],
  ['seam gap after mm', (r) => f2(r.max_seam_gap_mm_after)],
  ['frame ms', (r) => f2(r.frame_ms_serial.median)],
  ['self-coll', (r) => (r.sim.self_collision ? `on, k=${r.sim.self_rebuild_every}` : 'off')],
  ['eps w/ isect', (r) => r.episodes_starting_intersected],
  ['isect after', (r) => r.self_intersections_after?.pairs],
];

function renderTable(cols) {
  $('table').innerHTML = '<tr>' + cols.map(([h]) => `<th>${h}</th>`).join('') + '</tr>' +
    results.map((r) => '<tr>' + cols.map(([, f]) => `<td>${f(r)}</td>`).join('') + '</tr>').join('');
}

const output = () => ({ user_agent: navigator.userAgent, cross_origin_isolated: self.crossOriginIsolated, date: new Date().toISOString(), runs: results });
const nums = (s, parse = parseFloat) => s.split(',').map((x) => parse(x.trim())).filter((x) => x > 0);
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  $('run').disabled = true;
  results.length = 0;
  try {
    if (!navigator.gpu) throw new Error('navigator.gpu missing: no WebGPU in this browser');
    const mode = $('mode').value;
    const res = nums($('res').value);
    const substeps = nums($('substeps').value, (x) => parseInt(x, 10));
    const frames = parseInt($('frames').value, 10);
    const garment = mode === 'tshirt' || mode === 'drag' ? $('garment').value : '';
    if (mode !== 'sheet' && (!assets || (assets.garment ?? '') !== garment)) {
      status.textContent = 'loading body + SDF…';
      assets = garment ? await loadGarmentAssets(garment) : await loadTshirtAssets(q);
    }
    const scene = garment ? 'garment' : 'tshirt';
    const opts = JSON.stringify({
      self_collision: $('selfc').checked,
      pins: !$('nopins').checked,
      ...($('rebuild').value ? { self_rebuild: parseInt($('rebuild').value, 10) } : {}),
      ...($('cap').value ? { contact_max_accel: parseFloat($('cap').value) } : {}),
      ...($('ut').value ? { untangle_every: parseInt($('ut').value, 10) } : {}),
      ...(garment ? { garment_toml: assets.toml, garment_dxf: assets.dxf } : {}),
    });
    const obj = assets?.obj ?? '';
    const sdf = assets?.sdf ?? new Uint8Array();
    if (mode === 'bake') {
      status.textContent = 'baking SDF in wasm (single thread)…';
      await tick();
      results.push({ bake_ms: bake_sdf_ms(obj) });
    } else if (mode === 'drag') {
      const [maxOff, minPull] = $('gentle').checked ? [0.15, 0.5] : [0.25, 0.3];
      for (const r of res) for (const seed of nums($('seeds').value, (x) => parseInt(x, 10))) {
        status.textContent = `drag test edge ${r}, seed ${seed}…`;
        report('progress', status.textContent);
        await tick();
        results.push(JSON.parse(await run_drag_bench(scene, r, seed, 60, maxOff, minPull, opts, obj, sdf)));
        renderTable(DRAG_COLS);
      }
    } else {
      for (const ss of substeps) for (const r of res) {
        status.textContent = `${mode} res ${r}, ${ss} substeps, ${frames} frames…`;
        report('progress', status.textContent);
        await tick();
        const sc = mode === 'tshirt' ? scene : mode;
        results.push(JSON.parse(await run_bench(sc, r, ss, frames, $('ts').checked, $('record').checked, opts, mode === 'tshirt' ? obj : '', mode === 'tshirt' ? sdf : new Uint8Array())));
        renderTable(DRAPE_COLS);
      }
    }
    const out = output();
    if (assets) { out.asset_fetch_ms = assets.fetch_ms; out.sdf_download_bytes = assets.sdf_download_bytes; }
    $('report').textContent = JSON.stringify(out, null, 1);
    $('copy').disabled = false;
    if (q.get('post') === '1') {
      await fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent(q.get('name') ?? 'browser')}`, { method: 'POST', body: JSON.stringify(out) });
    }
    status.textContent = `ok: ${results.length} runs done`;
    status.className = '';
  } catch (e) {
    status.textContent = 'error: ' + (e?.message ?? e);
    status.className = 'err';
    report('error', status.textContent);
    console.error(e);
  } finally {
    $('run').disabled = false;
  }
}

$('run').onclick = run;
$('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(output(), null, 1));
$('mode').onchange = () => {
  const m = $('mode').value;
  $('res').value = m === 'sheet' ? '10,50,71,100,141,200' : m === 'drag' ? '0.00864,0.0061' : '0.0122,0.00864,0.0061,0.00432';
  $('frames').value = m === 'sheet' ? '1200' : '900';
};

await init();
status.textContent = 'ready' + (self.crossOriginIsolated ? '' : ' (not cross-origin isolated: coarse timers)');

// Automation: ?auto=1&mode=tshirt|drag|sheet|bake&res=..&substeps=..&frames=..&seeds=..&gentle=1&ts=1&record=0
// &sc=1 (self-collision) &rebuild=k &nopins=1 &garment=tshirt|trousers|hoodie (res = vertex count)
// &cap=A (contact accel cap, m/s²) &ut=N (untangle every N substeps, 0 = off)
// &post=1&name=X also sends the JSON to the dev server (saved as bench-out/browser-check/X.json).
if (q.has('mode')) { $('mode').value = q.get('mode'); $('mode').onchange(); }
for (const k of ['res', 'substeps', 'frames', 'seeds', 'rebuild', 'garment', 'cap', 'ut']) if (q.has(k)) $(k).value = q.get(k);
if (q.get('sc') === '1') $('selfc').checked = true;
if (q.get('nopins') === '1') $('nopins').checked = true;
if (q.get('ts') === '1') $('ts').checked = true;
if (q.get('gentle') === '1') $('gentle').checked = true;
if (q.get('record') === '0') $('record').checked = false;
if (q.get('auto') === '1') run();
