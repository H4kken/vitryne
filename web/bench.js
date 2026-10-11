import init, { run_bench } from './pkg/drape_web.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const status = $('status');
const results = [];

const COLS = [
  ['vertices', (r) => r.mesh.vertices],
  ['scene', (r) => r.scene ?? 'sheet'],
  ['substeps', (r) => (r.sim ?? r.config.sim).substeps],
  ['dispatches', (r) => r.mesh.dispatches_per_frame],
  ['pipelined ms', (r) => r.frame_ms_pipelined.toFixed(2)],
  ['serial med ms', (r) => r.frame_ms_serial.median.toFixed(2)],
  ['serial p95 ms', (r) => r.frame_ms_serial.p95.toFixed(2)],
  ['rest frame', (r) => r.rest_frame ?? '—'],
  ['rest wall s (pipelined)', (r) => (r.rest_wall_s_pipelined == null ? '—' : r.rest_wall_s_pipelined.toFixed(2))],
  ['max v >1s', (r) => r.max_speed_after_1s.toFixed(2)],
  ['NaN frames', (r) => r.non_finite_frames],
  ['min dist mm', (r) => (r.min_collider_dist_mm_final ?? r.min_sphere_dist_mm_final).toFixed(2)],
];

function renderTable() {
  const t = $('table');
  t.innerHTML = '<tr>' + COLS.map(([h]) => `<th>${h}</th>`).join('') + '</tr>' +
    results.map((r) => '<tr>' + COLS.map(([, f]) => `<td>${f(r)}</td>`).join('') + '</tr>').join('');
}

function output() {
  return {
    user_agent: navigator.userAgent,
    cross_origin_isolated: self.crossOriginIsolated,
    date: new Date().toISOString(),
    runs: results,
  };
}

async function run({ grids, substeps, frames, ts }) {
  $('run').disabled = true;
  results.length = 0;
  try {
    if (!navigator.gpu) throw new Error('navigator.gpu missing: no WebGPU in this browser');
    for (const ss of substeps) {
      for (const g of grids) {
        status.textContent = `running grid ${g} (${g * g} verts), ${ss} substeps, ${frames} frames…`;
        await new Promise((r) => setTimeout(r, 0)); // let the status paint
        results.push(JSON.parse(await run_bench(g, ss, frames, ts)));
        renderTable();
      }
    }
    $('report').textContent = JSON.stringify(output(), null, 1);
    if (q.get('post') === '1') {
      await fetch(`/__bench-result?name=${encodeURIComponent(q.get('name') ?? 'browser')}`, { method: 'POST', body: JSON.stringify(output(), null, 1) });
    }
    $('copy').disabled = false;
    status.textContent = `ok: ${results.length} runs done`;
    status.className = '';
  } catch (e) {
    status.textContent = 'error: ' + (e?.message ?? e);
    status.className = 'err';
    console.error(e);
  } finally {
    $('run').disabled = false;
  }
}

const list = (s) => s.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0);
const fromInputs = () => ({
  grids: list($('grids').value),
  substeps: list($('substeps').value),
  frames: parseInt($('frames').value, 10),
  ts: $('ts').checked,
});

$('run').onclick = () => run(fromInputs());
$('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(output(), null, 1));

await init();
status.textContent = 'ready' + (self.crossOriginIsolated ? '' : ' (not cross-origin isolated: coarse timers)');

// Automation: ?auto=1&grids=..&substeps=..&frames=..&ts=1 fills the inputs and runs.
// &post=1&name=X also sends the JSON to the dev server (saved as bench/browser-check/X.json).
for (const k of ['grids', 'substeps', 'frames']) if (q.has(k)) $(k).value = q.get(k);
if (q.get('ts') === '1') $('ts').checked = true;
if (q.get('auto') === '1') run(fromInputs());
