// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine worker: the wasm build of drape-web, its WebGPU device on the transferred
// canvas, the drape, and the file (see protocol.ts). Requests run one at a time, in order;
// inputs and frames run between them.

import init, { type PreparedScene, Viewport, VtryFile } from '../../pkg/drape_web.js';
import type { DrapeInfo, FromWorker, Input, Requests, RequestMessage, ToWorker } from './protocol';
import { dropSdf, loadSdf, storeSdf } from './sdf-cache';

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

let viewport: Viewport | null = null;
let canvas: OffscreenCanvas | null = null;
let file: VtryFile | null = null;
/** The newest drape revision asked for: an older drape request still queued is skipped. */
let newestDrape = -1;
let crashed = false;

/** A Rust panic (or a wasm trap) leaves the module unusable: give up, the UI restarts us. */
function crash(reason: string): never {
  if (!crashed) {
    crashed = true;
    post({ kind: 'crashed', reason });
  }
  throw new Error(`worker crashed: ${reason}`);
}

/** Rust errors arrive as strings; anything else is a panic or a bug. */
function rethrow(e: unknown): never {
  if (typeof e === 'string') throw new Error(e);
  if (e instanceof WebAssembly.RuntimeError) crash(`engine panic: ${e.message}`);
  throw e;
}

// ---- requests ------------------------------------------------------------------------------

type Handlers = { [K in keyof Requests]: (a: Requests[K]['args']) => Promise<Requests[K]['reply']> };

const handlers: Handlers = {
  async open({ bytes }) {
    const next = VtryFile.open(new Uint8Array(bytes));
    file?.free();
    file = next;
    viewport?.clear();
    return { entities: file.entities(), warnings: JSON.parse(file.warnings()) as string[] };
  },

  async update({ rev, entities }) {
    const f = needFile();
    const warnings = JSON.parse(f.set_entities(entities)) as string[];
    return { rev, warnings };
  },

  async drape({ rev, frameCamera }) {
    if (rev < newestDrape) return { rev, stale: true };
    const f = needFile();
    const v = needViewport();
    let scene: PreparedScene | null = null;
    try {
      scene = f.prepare();
      const info = JSON.parse(scene.info()) as DrapeInfo;
      const key = info.sdf_key;
      let sdf: Uint8Array = new Uint8Array();
      if (!v.has_body(key)) {
        post({ kind: 'progress', task: 'Loading the body', fraction: 0 });
        sdf = (await loadSdf(key)) ?? new Uint8Array();
        // Another drape may have been asked for while the SDF loaded.
        if (rev < newestDrape) return { rev, stale: true };
      }
      const prepared = scene;
      const load = (bytes: Uint8Array) => {
        const task = bytes.length ? 'Loading the body' : 'Preparing the body (once per avatar)';
        const progress = (f: number) => post({ kind: 'progress', task, fraction: f });
        const baked = v.load(prepared, bytes, progress, frameCamera);
        post({ kind: 'progress', task, fraction: 1 });
        return baked;
      };
      let baked: Uint8Array | undefined;
      try {
        baked = load(sdf);
      } catch (e) {
        // A damaged cached SDF (an interrupted write): forget it and bake.
        if (!sdf.length || typeof e !== 'string') throw e;
        console.warn(`SDF ${key} unusable (${e}), baking it`);
        await dropSdf(key);
        baked = load(new Uint8Array());
      }
      if (baked) void storeSdf(key, baked);
      return { rev, stale: false, info };
    } finally {
      scene?.free();
    }
  },

  async save({ rev }) {
    const bytes = needFile().save();
    return { rev, bytes: bytes.buffer as ArrayBuffer };
  },
};

function needFile(): VtryFile {
  if (!file) throw new Error('no file is open');
  return file;
}

function needViewport(): Viewport {
  if (!viewport) throw new Error('the viewport is not ready');
  return viewport;
}

let queue: Promise<void> = Promise.resolve();

function request(m: RequestMessage) {
  if (m.op === 'drape') newestDrape = Math.max(newestDrape, m.args.rev);
  queue = queue.then(async () => {
    if (crashed) return;
    try {
      // The handler matches the op (RequestMessage pairs them).
      const run = handlers[m.op] as (a: unknown) => Promise<unknown>;
      let value: unknown;
      try {
        value = await run(m.args);
      } catch (e) {
        rethrow(e);
      }
      const transfer = m.op === 'save' ? [(value as { bytes: ArrayBuffer }).bytes] : [];
      post({ kind: 'reply', id: m.id, ok: true, value }, transfer);
    } catch (e) {
      if (crashed) return;
      post({ kind: 'reply', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ---- inputs and frames ---------------------------------------------------------------------

/** Pointer state: a press is undecided until the pick says cloth (drag) or not (orbit). */
let press: { px: number; py: number; orbit: boolean } | null = null;
let frames = 0;
let statsAt = performance.now();
let frameMs = NaN;
let lastFrame = 0;

function frame() {
  const v = viewport;
  if (!v || crashed) return;
  try {
    if (!v.frame()) crash('the GPU device was lost');
  } catch (e) {
    rethrow(e);
  }
  frames++;
  const now = performance.now();
  lastFrame = now;
  if (now - statsAt >= 1000) {
    const fps = (frames * 1000) / (now - statsAt);
    frames = 0;
    statsAt = now;
    v.measure_frame().then((ms: number) => (frameMs = ms), () => {});
    post({ kind: 'stats', stats: { fps, vertices: v.vertices(), simTime: v.sim_time(), frameMs } });
  }
}

const workerRaf = (self as unknown as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;

function loop() {
  frame();
  if (!crashed) workerRaf?.call(self, loop);
}

async function start(m: Extract<Input, { kind: 'init' }>) {
  try {
    await init();
    canvas = m.canvas;
    canvas.width = m.width;
    canvas.height = m.height;
    viewport = await Viewport.create(canvas);
  } catch (e) {
    crash(`could not start WebGPU in the worker: ${e instanceof Error ? e.message : String(e)}`);
  }
  post({ kind: 'ready', adapter: viewport.adapter_report(), needsTicks: !workerRaf });
  if (workerRaf) workerRaf.call(self, loop);
}

function input(m: Input) {
  const v = viewport;
  switch (m.kind) {
    case 'init':
      // Requests wait for the device.
      queue = queue.then(() => start(m));
      return;
    case 'tick':
      // Ticks queued while a request ran (an SDF bake) arrive in a burst: draw one.
      if (performance.now() - lastFrame > 8) frame();
      return;
  }
  if (!v || !canvas) return;
  switch (m.kind) {
    case 'resize':
      canvas.width = m.width;
      canvas.height = m.height;
      v.resize(m.width, m.height);
      return;
    case 'pointer':
      if (m.phase === 'down') {
        const p = { px: m.px, py: m.py, orbit: false };
        press = p;
        v.pointer_down(m.x, m.y).then(
          (grabbed: boolean) => {
            if (press === p && !grabbed) p.orbit = true;
          },
          () => {},
        );
      } else if (m.phase === 'move') {
        if (v.dragging()) v.pointer_move(m.x, m.y);
        else if (press?.orbit) {
          v.orbit(m.px - press.px, m.py - press.py);
          press.px = m.px;
          press.py = m.py;
        }
      } else {
        press = null;
        v.pointer_up();
      }
      return;
    case 'wheel':
      v.zoom(m.steps);
      return;
    case 'controls':
      if (m.fast !== undefined) v.set_fast(m.fast);
      if (m.paused !== undefined) v.set_paused(m.paused);
      if (m.reset) v.reset();
      return;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (crashed) return;
  try {
    if (m.kind === 'request') request(m);
    else input(m);
  } catch (err) {
    if (!crashed) rethrow(err);
  }
};
