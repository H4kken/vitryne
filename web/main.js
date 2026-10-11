import init, { start } from './pkg/drape_web.js';

const status = document.getElementById('status');
const report = document.getElementById('report');

async function main() {
  if (!navigator.gpu) throw new Error('navigator.gpu missing: this browser has no WebGPU (WebGL fallback is disabled by design)');
  await init();
  const json = await start('gfx');
  report.textContent = json;
  status.textContent = 'ok: triangle rendered via WebGPU';
  window.__drapeReport = JSON.parse(json);
}

main().catch((e) => {
  status.textContent = 'error: ' + (e?.message ?? e);
  status.className = 'err';
  console.error(e);
});
