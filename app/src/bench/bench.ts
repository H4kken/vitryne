// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine benchmark page (bench.html): the same headless runs as `drape bench` and
// `drape bench-drag`, in the browser. It runs on the main thread, as it always has, so its
// numbers stay comparable with the earlier milestones'. tools/bench/run.sh drives it.
import init, { bake_sdf_ms, run_bench, run_drag_bench } from '../../pkg/drape_web.js';
import { type BenchAssets, loadGarmentAssets, loadTshirtAssets } from './assets';

// The form's controls, by what the page uses of them.
type Control = HTMLElement & { value: string; checked: boolean; disabled: boolean };
const $ = (id: string): Control => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`bench.html has no #${id}`);
  return el as Control;
};
const q = new URLSearchParams(location.search);
// With &post=1, progress and errors also go to the dev server (bench-out/<dir>/<name>.log.json), so
// browsers we can't automate (Safari) still tell us what happened.
const report = (kind: string, text: string) => q.get('post') === '1' && fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent((q.get('name') ?? 'browser') + '.log')}`, { method: 'POST', body: JSON.stringify({ kind, text, t: performance.now(), ua: navigator.userAgent }) }).catch(() => {});
window.addEventListener('error', (e) => report('error', String(e.message)));
window.addEventListener('unhandledrejection', (e) => report('error', String((e.reason as Error | undefined)?.message ?? e.reason)));
const status = $('status');
// Bench JSON as the engine writes it (drape_core::bench / dragbench): read, not typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Run = any;
const results: Run[] = [];
let assets: BenchAssets | null = null;

const f2 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2));
type Cols = [string, (r: Run) => unknown][];
const DRAPE_COLS: Cols = [
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
const DRAG_COLS: Cols = [
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

function renderTable(cols: Cols) {
  const rows = results.filter((r) => (cols === DRAG_COLS) === 'episodes' in r);
  $('table').innerHTML = '<tr>' + cols.map(([h]) => `<th>${h}</th>`).join('') + '</tr>' +
    rows.map((r) => '<tr>' + cols.map(([, f]) => `<td>${f(r)}</td>`).join('') + '</tr>').join('');
}

const output = () => ({ user_agent: navigator.userAgent, cross_origin_isolated: self.crossOriginIsolated, date: new Date().toISOString(), runs: results });
const nums = (s: string, parse: (x: string) => number = parseFloat) => s.split(',').map((x) => parse(x.trim())).filter((x) => x > 0);
const tick = () => new Promise((r) => setTimeout(r, 0));

const NO_WEBGPU = 'This browser has no WebGPU (navigator.gpu is missing). Use an up-to-date Chrome, Edge, Safari or Firefox; ' +
  'in Firefox, check that dom.webgpu.enabled is true in about:config. The page must be opened over https or localhost.';

// Runs the configuration currently set in the form, appending to `results`.
async function runConfig() {
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
    ...(garment && assets ? { garment_toml: assets.toml, garment_dxf: assets.dxf } : {}),
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
}

// Shows the JSON so far and, with &post=1, sends it to the dev server.
async function publish(extra: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { ...output(), ...extra };
  if (assets) { out.asset_fetch_ms = assets.fetch_ms; out.sdf_download_bytes = assets.sdf_download_bytes; }
  $('report').textContent = JSON.stringify(out, null, 1);
  $('copy').disabled = false;
  if (q.get('post') === '1') {
    await fetch(`/__bench-result?dir=${q.get('dir') ?? 'browser-check'}&name=${encodeURIComponent(q.get('name') ?? defaultName())}`, { method: 'POST', body: JSON.stringify(out) });
  }
}

// "chrome-windows", "firefox-mac"…, for result file names.
function defaultName() {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua) ? 'firefox' : /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'browser';
  const os = /Windows/.test(ua) ? 'windows' : /Mac OS X/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'os';
  return `${browser}-${os}`;
}

// What the browser tells about the GPU (Chrome may leave it empty; record the machine by hand).
async function adapterInfo() {
  const i = (await navigator.gpu.requestAdapter())?.info;
  return { vendor: i?.vendor, architecture: i?.architecture, device: i?.device, description: i?.description };
}

async function run() {
  $('run').disabled = true;
  results.length = 0;
  try {
    if (!('gpu' in navigator)) throw new Error(NO_WEBGPU);
    await runConfig();
    await publish({ adapter_info: await adapterInfo() });
    status.textContent = `ok: ${results.length} runs done`;
    status.className = '';
  } catch (e) {
    status.textContent = 'error: ' + ((e as Error | undefined)?.message ?? String(e));
    status.className = 'err';
    report('error', status.textContent);
    console.error(e);
  } finally {
    $('run').disabled = false;
  }
}

// M1 low-end hardware check: one click runs everything, results go back after each step.
// Dispatch overhead (empty sheet), the three garments draped at 10k and 20k vertices with
// self-collision, and one 60 s drag test.
const M1_SUITE: { mode: string; res: string; frames?: string; seeds?: string; garment: string; selfc: boolean; rebuild: string }[] = [
  { mode: 'sheet', res: '10,100', frames: '1200', garment: '', selfc: false, rebuild: '' },
  { mode: 'tshirt', res: '10000,20000', frames: '900', garment: 'tshirt', selfc: true, rebuild: '4' },
  { mode: 'tshirt', res: '10000,20000', frames: '900', garment: 'trousers', selfc: true, rebuild: '4' },
  { mode: 'tshirt', res: '10000,20000', frames: '900', garment: 'hoodie', selfc: true, rebuild: '4' },
  { mode: 'drag', res: '10000', seeds: '1', garment: 'tshirt', selfc: true, rebuild: '4' },
];

async function runSuite() {
  $('run').disabled = $('suite').disabled = true;
  results.length = 0;
  try {
    if (!('gpu' in navigator)) throw new Error(NO_WEBGPU);
    const info = { suite: 'm1', adapter_info: await adapterInfo() };
    for (const [i, c] of M1_SUITE.entries()) {
      $('mode').value = c.mode;
      modeChanged();
      for (const k of ['res', 'frames', 'seeds', 'garment', 'rebuild'] as const) {
        const v = c[k];
        if (v !== undefined) $(k).value = v;
      }
      $('selfc').checked = c.selfc;
      $('substeps').value = '20';
      report('progress', `suite step ${i + 1}/${M1_SUITE.length}: ${c.mode} ${c.garment || 'sheet'}`);
      await runConfig();
      await publish({ ...info, suite_steps_done: i + 1, suite_steps: M1_SUITE.length });
    }
    status.textContent = `ok: M1 suite done, ${results.length} runs. Results sent; you can close this tab.`;
    status.className = '';
  } catch (e) {
    status.textContent = 'error: ' + ((e as Error | undefined)?.message ?? String(e));
    status.className = 'err';
    report('error', status.textContent);
    console.error(e);
  } finally {
    $('run').disabled = $('suite').disabled = false;
  }
}

$('run').onclick = () => void run();
$('suite').onclick = () => void runSuite();
$('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(output(), null, 1));
function modeChanged() {
  const m = $('mode').value;
  $('res').value = m === 'sheet' ? '10,50,71,100,141,200' : m === 'drag' ? '0.00864,0.0061' : '0.0122,0.00864,0.0061,0.00432';
  $('frames').value = m === 'sheet' ? '1200' : '900';
}
$('mode').onchange = modeChanged;

await init();
status.textContent = 'ready' + (self.crossOriginIsolated ? '' : ' (not cross-origin isolated: coarse timers)');

// Automation: ?auto=1&mode=tshirt|drag|sheet|bake&res=..&substeps=..&frames=..&seeds=..&gentle=1&ts=1&record=0
// &sc=1 (self-collision) &rebuild=k &nopins=1 &garment=tshirt|trousers|hoodie (res = vertex count)
// &cap=A (contact accel cap, m/s²) &ut=N (untangle every N substeps, 0 = off)
// &post=1[&name=X][&dir=D] also sends the JSON to the dev server (bench-out/D/X.json; default
// dir browser-check, default name e.g. chrome-windows).
// ?suite=m1&post=1&dir=m1 runs the M1 suite (see M1_SUITE) and sends results after every step.
const mode = q.get('mode');
if (mode) {
  $('mode').value = mode;
  modeChanged();
}
for (const k of ['res', 'substeps', 'frames', 'seeds', 'rebuild', 'garment', 'cap', 'ut']) {
  const v = q.get(k);
  if (v !== null) $(k).value = v;
}
if (q.get('sc') === '1') $('selfc').checked = true;
if (q.get('nopins') === '1') $('nopins').checked = true;
if (q.get('ts') === '1') $('ts').checked = true;
if (q.get('gentle') === '1') $('gentle').checked = true;
if (q.get('record') === '0') $('record').checked = false;
if (q.get('suite') === 'm1') void runSuite();
else if (q.get('auto') === '1') void run();
