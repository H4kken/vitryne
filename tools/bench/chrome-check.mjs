// SPDX-License-Identifier: AGPL-3.0-or-later
// Headless check against real Chrome with its GPU: loads a page, waits for #status, saves a screenshot.
// usage: node tools/bench/chrome-check.mjs <url> <screenshot.png> [timeoutMs] [report-out.json]
// Waits until #status starts with 'ok' or 'error', then prints #report (parsed if JSON).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, shot, timeoutMs = '20000', reportOut] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'drape-chrome-'))}`,
  '--no-first-run', '--enable-unsafe-webgpu', ...(process.env.CHROME_FLAGS ?? '').split(' ').filter(Boolean), '--window-size=560,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
const t0 = Date.now(); let status = '';
while (Date.now() - t0 < +timeoutMs) {
  status = (await evaluate("document.getElementById('status')?.textContent ?? ''")) ?? '';
  if (/^(ok|error)/.test(status)) break;
  await sleep(250);
}
await sleep(300);
const ua = await evaluate('navigator.userAgent');
const report = await evaluate("document.getElementById('report')?.textContent ?? ''");
const png = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
writeFileSync(shot, Buffer.from(png, 'base64'));
let parsed = null;
try { parsed = report ? JSON.parse(report) : null; } catch { parsed = report; }
if (reportOut) writeFileSync(reportOut, JSON.stringify(parsed, null, 1));
// No process.exit(): it can truncate piped stdout.
console.log(JSON.stringify({ status, ua, report: reportOut ? `written to ${reportOut}` : parsed, console: logs }, null, 2));
ws.close(); chrome.kill();
process.exitCode = /^ok/.test(status) ? 0 : 1;
