// SPDX-License-Identifier: AGPL-3.0-or-later
// The messages between the UI and the engine worker (docs/ARCHITECTURE.md, Worker protocol).
// The worker owns the GPU, the drape and the file's binary parts; the UI owns the document's
// JSON. Three kinds of message:
//  - inputs (UI -> worker, no answer): canvas, size, pointer, controls, a cut being placed,
//    which cut's handles to report, frame ticks;
//  - requests (UI -> worker, one reply each, matched by `id`): open, update, drape, save, and
//    the import and placement helpers;
//  - events (worker -> UI, unasked): ready, stats, progress, picked, gizmo, crashed.

/** What the engine reports about a drape (Rust `PreparedInfo`). */
export interface DrapeInfo {
  sdf_key: string;
  vertices: number;
  self_collision: boolean;
  warnings: string[];
  /** The cut ids in the drape's panel order: picks and gizmos name cuts by this index. */
  cuts: string[];
}

/** A cut's handles on screen (Rust `GizmoView`), in normalized device coordinates. */
export interface GizmoView {
  centre: [number, number];
  /** Each handle's line, and how far its point moves per unit of what it changes. */
  along: GizmoHandle;
  around: GizmoHandle;
  out: GizmoHandle;
  /** The turning ring; rotation grows from `around` towards `along`. */
  ring: [number, number][];
}

export interface GizmoHandle {
  line: [number, number][];
  /** Per mm of `top` (along), radian of `angle` (around), mm of `radius` (out). */
  per: [number, number];
}

/** A file's content: the zip, or the folder form's files by relative path. */
export type FileData = { form: 'zip'; bytes: ArrayBuffer } | { form: 'folder'; files: [string, ArrayBuffer][] };

export function fileDataBuffers(d: FileData): ArrayBuffer[] {
  return d.form === 'zip' ? [d.bytes] : d.files.map(([, b]) => b);
}

export function copyFileData(d: FileData): FileData {
  return d.form === 'zip' ? { form: 'zip', bytes: d.bytes.slice(0) } : { form: 'folder', files: d.files.map(([p, b]) => [p, b.slice(0)]) };
}

/** select: pick a cut (placing pieces); turn: orbit; pinch: pull the cloth. */
export type PointerTool = 'select' | 'turn' | 'pinch';

export type Input =
  | { kind: 'init'; canvas: OffscreenCanvas; width: number; height: number }
  | { kind: 'resize'; width: number; height: number }
  /**
   * `x`, `y`: normalized device coordinates (-1..1, y up); `px`, `py`: CSS pixels. `tool`
   * (on down): `turn` always orbits; `pinch` pulls the cloth under the pointer, or orbits when
   * there is none; `select` picks the cut under it (a `picked` event), or orbits when dragged.
   */
  | { kind: 'pointer'; phase: 'down' | 'move' | 'up'; x: number; y: number; px: number; py: number; tool?: PointerTool }
  /** The scene's colours (`Viewport::set_style`): background, cloth front, cloth back, body. */
  | { kind: 'style'; rgb: number[] }
  | { kind: 'wheel'; steps: number }
  /** `placing`: the cloth stays where it starts while pieces are placed. */
  | { kind: 'controls'; fast?: boolean; paused?: boolean; placing?: boolean; reset?: true }
  /** Shows cut `cut` (panel index) at `placement` (JSON), while placing: a handle being dragged. */
  | { kind: 'place'; cut: number; placement: string }
  /** Report cut `cut`'s handles (panel index) in `gizmo` events, or none. */
  | { kind: 'gizmo'; cut: number | null }
  /** One display frame, sent by the UI where workers have no requestAnimationFrame. */
  | { kind: 'tick' };

export interface Requests {
  /** Opens a `.vtry` (zip or folder). The UI keeps a copy, to reopen after a restart. */
  open: { args: { data: FileData }; reply: { entities: string; warnings: string[] } };
  /**
   * Validates the document's new JSON (Rust, the same checks as reading a file) and, if
   * valid, makes it the worker's document. If not, the worker's document is unchanged and
   * the request fails with the reasons; the UI then reverts the command.
   */
  update: { args: { rev: number; entities: string }; reply: { rev: number; warnings: string[] } };
  /**
   * Re-drapes the worker's current document. `rev` is the revision it was asked for; a drape
   * request overtaken by a newer one before it starts is skipped (`stale`).
   */
  drape: {
    args: { rev: number; frameCamera: boolean };
    reply: { rev: number; stale: true } | { rev: number; stale: false; info: DrapeInfo };
  };
  /** The worker's document in the given form, already read back and checked in Rust. */
  save: { args: { rev: number; form: FileData['form'] }; reply: { rev: number; data: FileData } };
  /** What importing a DXF would give (Rust `import::Preview`, JSON). `sidecar`: a garment.toml or "". */
  inspectDxf: { args: { name: string; dxf: string; sidecar: string }; reply: { preview: string } };
  /**
   * A new project from a DXF, its pieces placed as `choices` (JSON) say; it becomes the
   * worker's document, like `open`. `avatar`: the test avatar's mesh. The reply has its
   * entities, the import's notes, and the file (kept by the UI, to reopen after a restart).
   */
  importNew: {
    args: { name: string; dxf: string; sidecar: string; choices: string; avatar: ArrayBuffer; seed: number[] };
    reply: { entities: string; notes: string[]; zip: ArrayBuffer };
  };
  /** Pieces from a DXF to add to the open project (Rust `import::Addition`, JSON); nothing changes. */
  importAddition: { args: { name: string; dxf: string; sidecar: string; choices: string; seed: number[] }; reply: { addition: string } };
  /** Cut `cut` started again at `place` (Rust `project::Rewrapped`, JSON); nothing changes. */
  rewrap: { args: { cut: string; place: string }; reply: { rewrapped: string } };
}

export type Op = keyof Requests;

export type RequestMessage = {
  [K in Op]: { kind: 'request'; id: number; op: K; args: Requests[K]['args'] };
}[Op];

export type Reply =
  | { kind: 'reply'; id: number; ok: true; value: unknown }
  | { kind: 'reply'; id: number; ok: false; error: string };

export interface Stats {
  fps: number;
  vertices: number;
  simTime: number;
  /** GPU cost of one frame's work (sim + render), ms; NaN when unknown. */
  frameMs: number;
}

export type WorkerEvent =
  | { kind: 'ready'; adapter: string; needsTicks: boolean }
  | { kind: 'stats'; stats: Stats }
  | { kind: 'progress'; task: string; fraction: number }
  /** The select tool's pick: a panel index (see `DrapeInfo.cuts`), or -1 for none. */
  | { kind: 'picked'; cut: number }
  /** The handles asked for with a `gizmo` input, whenever they move; null: none to show. */
  | { kind: 'gizmo'; gizmo: GizmoView | null }
  /** The worker can't go on (panic, lost GPU device): the UI restarts it. */
  | { kind: 'crashed'; reason: string };

export type ToWorker = Input | RequestMessage;
export type FromWorker = Reply | WorkerEvent;
