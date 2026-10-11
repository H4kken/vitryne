import init, { start } from './pkg/drape_web.js';

const status = document.getElementById('status');
const report = document.getElementById('report');

async function main() {
  if (!navigator.gpu) throw new Error('navigator.gpu missing: this browser has no WebGPU (WebGL fallback is disabled by design)');
  // ?gpu-timestamps=1 turns on the opt-in profiling mode (never used for pass/fail numbers).
  const gpuTimestamps = new URLSearchParams(location.search).get('gpu-timestamps') === '1';
  await init();
  const json = await start('gfx', gpuTimestamps);
  report.textContent = json;
  status.textContent = 'ok: triangle rendered via WebGPU' + (gpuTimestamps ? ' (profiling: gpu-timestamps)' : '');
  window.__drapeReport = JSON.parse(json);
}

main().catch((e) => {
  status.textContent = 'error: ' + (e?.message ?? e);
  status.className = 'err';
  console.error(e);
});
