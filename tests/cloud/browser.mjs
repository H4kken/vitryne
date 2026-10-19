// SPDX-License-Identifier: AGPL-3.0-or-later
// M12's done-when in real Chrome (with its GPU), over CDP like tools/bench/chrome-check.mjs:
//
//   cloud  <url>   browser A opens the T-shirt example and makes a denim with no account:
//                  it is autosaved as A's draft (this tab holds its lock); an edit while offline
//                  is kept and saved once back online; after a reload the draft is listed; A
//                  creates an account (email, password, the code from Mailpit: instance.mjs).
//                  Export and Duplicate ask for an account first, and a second example asks
//                  before replacing the draft; with the account, Duplicate makes "(copy)".
//                  Browser B (a fresh profile) signs in and opens the project, its navy denim
//                  (recoloured offline) the garment's fabric.
//   none   <url>   the same build with no config.json: the editor says it has no backend.
//   draw   <url>   M14's done-when: a project from scratch, two rectangles from "Add a shape"
//                  (front and back, lowered to the hips by their Height), the two side seams
//                  sewn from the suggestions (told apart by their wording), the drape in 3D; an
//                  ellipse (curves) added, and after the autosave and a reload the project
//                  opens with its three pieces and two seams.
//
//   node tests/cloud/browser.mjs cloud http://localhost:8000 [shots-dir]   (the local stack)
//   node tests/cloud/browser.mjs none http://localhost:5174 [shots-dir]    (`pnpm run dev:app`)
//   node tests/cloud/browser.mjs draw http://localhost:5173 [shots-dir]    (`pnpm run dev --local`)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAILPIT } from './instance.mjs';

const [mode, url, shots = join(tmpdir(), 'vitryne-browser-check')] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(shots, { recursive: true });

async function browser(label) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vitryne-chrome-'))}`, '--no-first-run', '--enable-unsafe-webgpu', '--window-size=1400,900', 'about:blank'],
    { stdio: 'ignore' },
  );
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      // not up yet
    }
  }
  const b = await connect(target, label);
  /** Another tab of the same browser (same profile). */
  b.tab = async (name) => {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const tab = await connect(t, `${label}-${name}`);
    const closeWs = tab.close;
    // Closes the tab itself, so the first one is in front again.
    tab.close = async () => {
      closeWs();
      await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
      await sleep(300);
    };
    return tab;
  };
  const close = b.close;
  b.close = () => {
    close();
    chrome.kill();
  };
  return b;
}

async function connect(target, label) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  const requests = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`${label}: ${r.result.exceptionDetails.exception?.description}`);
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');

  const b = {
    send,
    logs,
    requests,
    async goto(u) {
      await send('Page.navigate', { url: u });
      await sleep(1500);
    },
    evaluate,
    /** Waits for `expr` to be truthy. */
    async until(what, expr, ms = 60000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const v = await evaluate(expr).catch(() => null);
        if (v) return v;
        await sleep(250);
      }
      await b.shot(`timeout-${what.replace(/\W+/g, '-')}`);
      throw new Error(`${label}: timed out waiting for ${what}\nconsole: ${logs.join('\n')}`);
    },
    text: () => evaluate('document.body.innerText'),
    /** Clicks the visible button, link or menu item whose text matches, with real input events. */
    async click(text, { exact = false } = {}) {
      const box = await b.until(
        `"${text}"`,
        `(() => {
          const want = ${JSON.stringify(text)};
          const els = [...document.querySelectorAll('button, a, [role=menuitem], [role=button]')].filter((e) => {
            const t = (e.innerText || e.getAttribute('aria-label') || '').trim();
            return ${exact} ? t === want : t.includes(want);
          });
          // The one on top: the editor's bar is still there under the start screen.
          const e = els.find((x) => {
            const r = x.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !x.disabled && x.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          });
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        20000,
      );
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
      await sleep(400);
    },
    /** Clicks the element matching `selector`, with real input events. */
    async clickAt(selector) {
      const box = await b.until(selector, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
      await sleep(400);
    },
    /** Clicks the visible element matching `selector` whose text is exactly `text`. */
    async clickText(selector, text) {
      const box = await b.until(
        `${selector} "${text}"`,
        `(() => {
          const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.trim() === ${JSON.stringify(text)} && x.getBoundingClientRect().width > 0);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        20000,
      );
      await b.clickBox(box);
    },
    async clickBox({ x, y }) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
      await sleep(400);
    },
    /** Replaces the text of the input labelled `label` (a <label for>) inside `scope`, then Enter. */
    async fill(label, value, scope = 'document') {
      await b.until(
        `the field ${label}`,
        `(() => {
          const l = [...${scope}.querySelectorAll('label')].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
          const i = l && document.getElementById(l.htmlFor);
          if (!i) return false;
          i.focus();
          i.select();
          return document.activeElement === i;
        })()`,
        20000,
      );
      await send('Input.insertText', { text: String(value) });
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(300);
    },
    async type(selector, value) {
      await b.until(selector, `!!document.querySelector(${JSON.stringify(selector)})`);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await send('Input.insertText', { text: value });
      await sleep(200);
    },
    /** Cuts the network off (true) or back on. */
    async network(offline) {
      await send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    },
    async shot(name) {
      const png = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
      writeFileSync(join(shots, `${label}-${name}.png`), Buffer.from(png, 'base64'));
    },
    close() {
      ws.close();
    },
  };
  return b;
}

async function codeFor(to, after) {
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const m = s.messages?.find((x) => Date.parse(x.Created) >= after);
    if (m) return /\b(\d{6})\b/.exec((await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).Text)[1];
    await sleep(250);
  }
  throw new Error(`no email to ${to}`);
}

const loaded = `(() => { const t = document.body.innerText; return (t.includes('2D Pattern') || t.includes('Export') || t.includes('Show flat pieces')) && !t.includes('What do you want to make?'); })()`;

/** The open project's name, in the top bar's field. */
const projectName = `(document.querySelector('header input[aria-label="Project name"]')?.value ?? '')`;

async function cloud() {
  const email = `browser-${Date.now().toString(36)}@example.test`;
  const password = `pw-${Date.now().toString(36)}-x`;
  const a = await browser('A');
  await a.goto(url);
  await a.until('start screen', `document.body.innerText.includes('What do you want to make?')`);
  await a.until('cloud button', `document.body.innerText.includes('Sign in')`);
  await a.click('T-shirt');
  await a.until('the T-shirt open', loaded);
  const header = `document.querySelector('header')?.innerText ?? ''`;
  await a.until('not saved before an edit', `(${header}).includes('change something to keep it')`);
  await a.click('Fabric', { exact: true });
  await a.click('New fabric');
  await a.click('Denim');
  await a.click('Make this fabric');
  await a.until('the autosave', `(${header}).includes('Saved')`, 30000);
  await a.until('the project lock', `navigator.locks.query().then((q) => q.held.some((l) => l.name.startsWith('vitryne-project:')))`);
  await a.shot('autosaved');

  // Offline: the edit waits in this browser, then reaches the cloud.
  await a.network(true);
  await a.click('Navy', { exact: true });
  await a.until('offline', `(${header}).includes('changes kept in this browser')`, 30000);
  await a.shot('offline');
  await a.network(false);
  await a.click('Use it for the whole garment');
  await a.until('saved again', `(${header}).includes('Saved')`, 90000);

  // Another tab of the same browser can't edit it too, until it takes it over.
  const a2 = await a.tab('tab2');
  await a2.goto(url);
  await a2.click('Open T-shirt (Teagan)', { exact: true });
  await a2.until('the second tab blocked', `document.body.innerText.includes('is open in another tab of this browser')`);
  await a2.shot('blocked');
  await a2.click('Open here instead');
  await a2.until('the second tab editing', `(${header}).includes('Saved') && !document.body.innerText.includes('Open here instead')`);
  await a.until('the first tab told', `document.body.innerText.includes('was opened in another tab')`);
  await a.shot('taken');
  await a.click('Open here instead');
  await a.until('the first tab back', `!document.body.innerText.includes('was opened in another tab')`);
  await a2.close();

  // Without an account: Export asks for one, and a second project would replace the draft.
  await a.click('Export', { exact: true });
  await a.until('the account asked for', `document.body.innerText.includes('Create a free account to export.')`);
  await a.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);

  // A reload: the draft is in the list.
  await a.goto(url);
  await a.until('the draft listed', `document.body.innerText.toLowerCase().includes('your draft') && document.body.innerText.includes('T-shirt (Teagan)')`);
  await a.shot('reloaded');
  await a.click('Trousers');
  await a.until('the replace question', `document.body.innerText.includes('Replace your draft?')`);
  await a.shot('replace');
  await a.click('Cancel', { exact: true });
  await a.until('still the start screen', `!document.body.innerText.includes('Replace your draft?') && document.body.innerText.includes('What do you want to make?')`);
  await a.click('Cloud', { exact: true });
  await a.click('Create an account', { exact: true });
  await a.type('#cloud-email', email);
  await a.type('#cloud-password', password);
  const t = Date.now() - 1000;
  await a.click('Create the account');
  await a.type('#cloud-code', await codeFor(email, t));
  await a.click('Confirm', { exact: true });
  await a.until('the account created', `document.body.innerText.includes('Account created')`);
  await a.until('the email shown', `document.body.innerText.includes(${JSON.stringify(email)})`);
  await a.shot('upgraded');
  await a.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);

  // With the account: the draft is a project like any other, and can be duplicated.
  await a.until('the project listed', `document.body.innerText.toLowerCase().includes('your projects')`);
  await a.click('Open T-shirt (Teagan)', { exact: true });
  await a.until('the project open', loaded);
  await a.click('More');
  await a.click('Duplicate', { exact: true });
  // The project's name is a field in the top bar (it renames in place).
  await a.until('the copy open', `${projectName} === 'T-shirt (Teagan) (copy)'`);
  await a.shot('duplicated');
  const aErrors = a.logs;
  a.close();

  const b = await browser('B');
  await b.goto(url);
  await b.until('start screen', `document.body.innerText.includes('What do you want to make?')`);
  if ((await b.text()).toLowerCase().includes('your cloud projects')) throw new Error('B: a fresh browser shows cloud projects before signing in');
  await b.click('Sign in', { exact: true });
  await b.click('Sign in', { exact: true });
  await b.type('#cloud-email', email);
  await b.type('#cloud-password', password);
  await b.click('Sign in', { exact: true });
  await b.until('B signed in', `document.body.innerText.includes(${JSON.stringify(email)})`);
  await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);
  await b.until('both projects listed', `document.body.innerText.toLowerCase().includes('your projects') && document.body.innerText.includes('T-shirt (Teagan) (copy)')`);
  await b.shot('listed');
  // The original, not the copy.
  await b.click('Open T-shirt (Teagan)', { exact: true });
  await b.until('the project open in B', loaded);
  await b.until('Navy denim kept', `[...document.querySelectorAll('button')].some((e) => e.innerText.includes('Navy denim') && e.innerText.includes('Default'))`);
  await b.until('B saved', `(document.querySelector('header')?.innerText ?? '').includes('Saved')`);
  await b.shot('opened');
  const title = await b.evaluate(projectName);
  if (title !== 'T-shirt (Teagan)') throw new Error(`B: unexpected title: ${title}`);
  const bErrors = b.logs;
  b.close();
  return { email, aErrors, bErrors, title };
}

async function none() {
  const a = await browser('N');
  await a.goto(url);
  await a.until('the no-backend page', `document.body.innerText.includes('This Vitryne has no backend')`);
  await a.shot('none');
  const backend = a.requests.filter((r) => /\/(auth|rest|storage)\/v1\/|supabase/.test(r));
  a.close();
  if (backend.length) throw new Error(`requests to a backend: ${backend.join(', ')}`);
  return { errors: a.logs };
}

async function draw() {
  const a = await browser('D');
  const dialog = `document.querySelector('[role=dialog]')`;
  const pieces = `[...document.querySelectorAll('svg text')].map((t) => t.textContent.trim())`;
  const header = `document.querySelector('header')?.innerText ?? ''`;
  async function shape(kind, width, height, name, place) {
    await a.click('Add a shape');
    await a.until('the shape dialog', `${dialog}?.innerText.includes('Add a shape')`);
    await a.clickText('[role=dialog] [role=group] button', kind);
    await a.fill('Width', width, dialog);
    await a.fill('Height', height, dialog);
    await a.fill('Name', name, dialog);
    await a.clickAt('[role=dialog] [role=combobox]');
    await a.clickText('[role=option]', place);
    await a.click('Add piece');
    await a.until('the dialog closed', `!${dialog}`, 30000);
  }
  await a.goto(url);
  await a.until('start screen', `document.body.innerText.includes('What do you want to make?')`);
  await a.click('Start from scratch');
  await a.until('a blank project', `document.body.innerText.includes('Draw your first piece')`, 60000);
  await a.evaluate(`(() => { const i = document.querySelector('header input[aria-label="Project name"]'); i.focus(); i.select(); })()`);
  await a.send('Input.insertText', { text: 'Drawn skirt' });
  await a.evaluate(`document.activeElement.blur()`);
  await shape('Rectangle', 450, 400, 'Front', 'Body, front');
  await shape('Rectangle', 450, 400, 'Back', 'Body, back');
  // Body places start at the neck: both panels down to the hips (the last one added is picked).
  await a.click('Pieces');
  await a.fill('Height', 1000);
  const front = await a.evaluate(`(() => { const t = [...document.querySelectorAll('svg text')].find((x) => x.textContent.trim() === 'Front'); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y - 60 }; })()`);
  await a.clickBox(front);
  await a.until('the front picked', `[...document.querySelectorAll('input')].some((i) => i.value === 'Front')`);
  await a.fill('Height', 1000);
  await a.click('Seams');
  await a.click('Suggest seams');
  await a.until('the suggestions', `document.body.innerText.includes('Suggest again')`);
  await a.shot('suggestions');
  const suggested = await a.evaluate(`[...document.querySelectorAll('li')].map((l) => l.innerText.replace(/\\n/g, ' | '))`);
  // The side seams are the suggestions whose two sides are sides.
  for (let k = 0; k < 2; k++) {
    const sew = await a.until(
      'a side seam to sew',
      `(() => {
        const li = [...document.querySelectorAll('li')].find((l) => (l.innerText.match(/the (left|right) side/g) ?? []).length === 2);
        const b = li && [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Sew');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
    );
    await a.clickBox(sew);
    await sleep(1000);
  }
  await a.until('two seams', `document.body.innerText.includes('SEWN (2)') || document.body.innerText.includes('Sewn (2)')`);
  await a.click('Show 3D drape');
  await sleep(20000);
  await a.shot('draped');
  await shape('Ellipse', 200, 140, 'Patch', 'Body, front');
  await a.until('the autosave', `(${header}).includes('Saved')`, 30000);
  await a.goto(url);
  await a.until('the project listed', `document.body.innerText.includes('Drawn skirt')`, 30000);
  await a.click('Drawn skirt');
  await a.until('the project reopened', `${pieces}.includes('Patch')`, 60000);
  await a.click('Seams');
  await a.until('its seams', `/sewn \\(2\\)/i.test(document.body.innerText)`);
  const reopened = await a.evaluate(pieces);
  await a.shot('reopened');
  a.close();
  if (JSON.stringify(reopened) !== JSON.stringify(['Front', 'Back', 'Patch'])) throw new Error(`reopened with ${reopened}`);
  return { suggested, reopened, errors: a.logs };
}

const result = mode === 'none' ? await none() : mode === 'draw' ? await draw() : await cloud();
console.log(JSON.stringify({ mode, ok: true, ...result, shots }, null, 2));
