// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine worker: the wasm build of vitryne-wasm, its WebGPU device on the transferred
// canvas, the drape, and the file (see protocol.ts). Requests run one at a time, in order;
// inputs and frames run between them.

import init, {
  type PreparedScene,
  Viewport,
  VtryFile,
} from "../../pkg/vitryne_wasm.js";
import {
  type DrapeInfo,
  type FromWorker,
  fileDataBuffers,
  type GizmoView,
  type Input,
  type Requests,
  type RequestMessage,
  type ToWorker,
} from "./protocol";
import { dropSdf, loadSdf, storeSdf } from "./sdf-cache";

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  self.postMessage(m, { transfer });

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
    post({ kind: "crashed", reason });
  }
  throw new Error(`worker crashed: ${reason}`);
}

/** Rust errors arrive as strings; anything else is a panic or a bug. */
function rethrow(e: unknown): never {
  if (typeof e === "string") throw new Error(e);
  if (e instanceof WebAssembly.RuntimeError)
    crash(`engine panic: ${e.message}`);
  throw e;
}

// ---- requests ------------------------------------------------------------------------------

type Handlers = {
  [K in keyof Requests]: (
    a: Requests[K]["args"],
  ) => Promise<Requests[K]["reply"]>;
};

const handlers: Handlers = {
  async open({ data }) {
    const next =
      data.form === "zip"
        ? VtryFile.open(new Uint8Array(data.bytes))
        : VtryFile.open_folder(
            data.files.map(([p]) => p),
            data.files.map(([, b]) => new Uint8Array(b)),
          );
    file?.free();
    file = next;
    viewport?.clear();
    return {
      entities: file.entities(),
      warnings: JSON.parse(file.warnings()) as string[],
    };
  },

  async update({ rev, entities }) {
    const f = needFile();
    const warnings = JSON.parse(f.set_entities(entities)) as string[];
    // Colours apply to the drape shown at once: an appearance edit doesn't re-drape.
    viewport?.set_looks(f);
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
        post({ kind: "progress", task: "Loading the body", fraction: 0 });
        sdf = (await loadSdf(key)) ?? new Uint8Array();
        // Another drape may have been asked for while the SDF loaded.
        if (rev < newestDrape) return { rev, stale: true };
      }
      const prepared = scene;
      const load = (bytes: Uint8Array) => {
        const task = bytes.length
          ? "Loading the body"
          : "Preparing the body (once per avatar)";
        const progress = (f: number) =>
          post({ kind: "progress", task, fraction: f });
        const baked = v.load(prepared, bytes, progress, frameCamera);
        post({ kind: "progress", task, fraction: 1 });
        return baked;
      };
      let baked: Uint8Array | undefined;
      try {
        baked = load(sdf);
      } catch (e) {
        // A damaged cached SDF (an interrupted write): forget it and bake.
        if (!sdf.length || typeof e !== "string") throw e;
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

  async save({ rev, form }) {
    const f = needFile();
    if (form === "zip")
      return { rev, data: { form, bytes: f.save().buffer as ArrayBuffer } };
    const files = (f.save_folder() as [string, Uint8Array][]).map(
      ([p, b]): [string, ArrayBuffer] => [p, b.buffer as ArrayBuffer],
    );
    return { rev, data: { form, files } };
  },

  async patternNeeds({ text }) {
    return { needs: VtryFile.pattern_needs(text) };
  },

  async inspectImport({ source }) {
    return { preview: VtryFile.inspect_import(source) };
  },

  async importNew({ source, choices, avatar, seed }) {
    const next = VtryFile.import_new(
      source,
      choices,
      new Uint8Array(avatar),
      Date.now(),
      new Uint8Array(seed),
    );
    file?.free();
    file = next;
    viewport?.clear();
    return {
      entities: file.entities(),
      notes: JSON.parse(file.warnings()) as string[],
      zip: file.save().buffer as ArrayBuffer,
    };
  },

  async newEmpty({ avatar, seed }) {
    const next = VtryFile.new_empty(
      new Uint8Array(avatar),
      Date.now(),
      new Uint8Array(seed),
    );
    file?.free();
    file = next;
    viewport?.clear();
    return {
      entities: file.entities(),
      notes: [],
      zip: file.save().buffer as ArrayBuffer,
    };
  },

  async importAddition({ source, choices, seed }) {
    return {
      addition: needFile().import_addition(
        source,
        choices,
        Date.now(),
        new Uint8Array(seed),
      ),
    };
  },

  async rewrap({ cut, place }) {
    return { rewrapped: needFile().rewrap(cut, place) };
  },

  async placePiece({ piece, places }) {
    return { placed: needFile().place_piece(piece, JSON.stringify(places)) };
  },

  async sewingEdges() {
    return { edges: needFile().sewing_edges() };
  },

  async suggestSeams() {
    return { proposals: needFile().suggest_seams() };
  },

  async joinEdges({ a, b }) {
    return { proposal: needFile().join_edges(a, b) };
  },

  async seamDifferences() {
    return { differences: needFile().seam_differences() };
  },

  async thumbnail({ width, height }) {
    const rgba: Uint8Array = await needViewport().thumbnail(width, height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas in the worker");
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
    // Safari encodes PNG when asked for WebP: JPEG is much smaller then.
    let blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: 0.85,
    });
    if (blob.type !== "image/webp")
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { image: await blob.arrayBuffer(), type: blob.type };
  },

  async exportGlb({ includeAvatar }) {
    const v = needViewport();
    const bytes: Uint8Array = await v.export_glb(includeAvatar);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return { glb: buffer };
  },

  async exportObj({ includeAvatar }) {
    const v = needViewport();
    const res: { obj: string; mtl: string } = JSON.parse(
      await v.export_obj(includeAvatar),
    );
    return res;
  },
};

function needFile(): VtryFile {
  if (!file) throw new Error("no file is open");
  return file;
}

function needViewport(): Viewport {
  if (!viewport) throw new Error("the viewport is not ready");
  return viewport;
}

let queue: Promise<void> = Promise.resolve();

function request(m: RequestMessage) {
  if (m.op === "drape") newestDrape = Math.max(newestDrape, m.args.rev);
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
      const transfer =
        m.op === "save"
          ? fileDataBuffers((value as Requests["save"]["reply"]).data)
          : m.op === "importNew" || m.op === "newEmpty"
            ? [(value as Requests["importNew"]["reply"]).zip]
            : m.op === "exportGlb"
              ? [(value as Requests["exportGlb"]["reply"]).glb]
              : m.op === "thumbnail"
                ? [(value as Requests["thumbnail"]["reply"]).image]
                : [];
      post({ kind: "reply", id: m.id, ok: true, value }, transfer);
    } catch (e) {
      if (crashed) return;
      post({
        kind: "reply",
        id: m.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

// ---- inputs and frames ---------------------------------------------------------------------

/** Pointer state: a press is undecided until the pick says cloth (drag) or not (orbit). */
let style: Float32Array | null = null;
/** select: a click picks a cut, a drag orbits. */
let press: {
  px: number;
  py: number;
  orbit: boolean;
  select: boolean;
  x: number;
  y: number;
  sx: number;
  sy: number;
  moved: boolean;
} | null = null;
/** The cut whose handles are reported, and the last report sent. */
let gizmoCut: number | null = null;
let gizmoSent = "";
let frames = 0;
let statsAt = performance.now();
let frameMs = NaN;
let lastFrame = 0;

function frame() {
  const v = viewport;
  if (!v || crashed) return;
  try {
    if (!v.frame()) crash("the GPU device was lost");
  } catch (e) {
    rethrow(e);
  }
  frames++;
  if (gizmoCut !== null) {
    // The handles move with the camera, the canvas size and the cut: send them when they do.
    const g = v.gizmo(gizmoCut);
    if (g !== gizmoSent) {
      gizmoSent = g;
      post({ kind: "gizmo", gizmo: g ? (JSON.parse(g) as GizmoView) : null });
    }
  }
  const now = performance.now();
  lastFrame = now;
  if (now - statsAt >= 1000) {
    const fps = (frames * 1000) / (now - statsAt);
    frames = 0;
    statsAt = now;
    v.measure_frame().then(
      (ms: number) => (frameMs = ms),
      () => {},
    );
    post({
      kind: "stats",
      stats: { fps, vertices: v.vertices(), simTime: v.sim_time(), frameMs },
    });
  }
}

const workerRaf = (
  self as unknown as { requestAnimationFrame?: (cb: () => void) => number }
).requestAnimationFrame;

function loop() {
  frame();
  if (!crashed) workerRaf?.call(self, loop);
}

async function start(m: Extract<Input, { kind: "init" }>) {
  try {
    await init();
    canvas = m.canvas;
    canvas.width = m.width;
    canvas.height = m.height;
    viewport = await Viewport.create(canvas);
    if (style) viewport.set_style(style);
  } catch (e) {
    crash(
      `could not start WebGPU in the worker: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  post({
    kind: "ready",
    adapter: viewport.adapter_report(),
    needsTicks: !workerRaf,
  });
  if (workerRaf) workerRaf.call(self, loop);
}

function input(m: Input) {
  const v = viewport;
  switch (m.kind) {
    case "init":
      // Requests wait for the device.
      queue = queue.then(() => start(m));
      return;
    case "style":
      // May come before the device is up: kept and applied then.
      style = new Float32Array(m.rgb);
      viewport?.set_style(style);
      return;
    case "tick":
      // Ticks queued while a request ran (an SDF bake) arrive in a burst: draw one.
      if (performance.now() - lastFrame > 8) frame();
      return;
  }
  if (!v || !canvas) return;
  switch (m.kind) {
    case "resize":
      canvas.width = m.width;
      canvas.height = m.height;
      v.resize(m.width, m.height);
      return;
    case "pointer":
      if (m.phase === "down") {
        const select = m.tool === "select";
        const p = {
          px: m.px,
          py: m.py,
          orbit: m.tool !== "pinch",
          select,
          x: m.x,
          y: m.y,
          sx: m.px,
          sy: m.py,
          moved: false,
        };
        press = p;
        if (p.orbit) return;
        v.pointer_down(m.x, m.y).then(
          (grabbed: boolean) => {
            if (press === p && !grabbed) p.orbit = true;
          },
          () => {},
        );
      } else if (m.phase === "move") {
        if (v.dragging()) v.pointer_move(m.x, m.y);
        else if (press?.orbit) {
          if (Math.abs(m.px - press.sx) + Math.abs(m.py - press.sy) > 4)
            press.moved = true;
          v.orbit(m.px - press.px, m.py - press.py);
          press.px = m.px;
          press.py = m.py;
        }
      } else {
        const p = press;
        press = null;
        v.pointer_up();
        // A click (not a drag) with the select tool picks.
        if (p?.select && !p.moved) {
          v.pick_cut(p.x, p.y).then(
            (cut: number) => post({ kind: "picked", cut }),
            () => {},
          );
        }
      }
      return;
    case "place":
      try {
        v.place_cut(m.cut, m.placement);
      } catch (e) {
        // A placement Rust can't use (a cut that went away): the next drape shows the truth.
        if (typeof e !== "string") rethrow(e);
      }
      return;
    case "gizmo":
      gizmoCut = m.cut;
      gizmoSent = "";
      if (m.cut === null) post({ kind: "gizmo", gizmo: null });
      return;
    case "highlight":
      v.set_highlight(m.cut ?? undefined);
      return;
    case "highlightSeam":
      v.set_seam_highlight(m.seam ?? undefined);
      return;
    case "wheel":
      v.zoom(m.steps);
      return;
    case "orbit":
      v.orbit(m.dx, m.dy);
      return;

    case "controls":
      if (m.fast !== undefined) v.set_fast(m.fast);
      if (m.paused !== undefined) v.set_paused(m.paused);
      if (m.placing !== undefined) v.set_placing(m.placing);
      if (m.seams !== undefined) v.set_show_seams(m.seams);
      if (m.reset) v.reset();
      return;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (crashed) return;
  try {
    if (m.kind === "request") request(m);
    else input(m);
  } catch (err) {
    if (!crashed) rethrow(err);
  }
};
