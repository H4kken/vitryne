// SPDX-License-Identifier: AGPL-3.0-or-later
// The messages between the UI and the engine worker (docs/ARCHITECTURE.md, Worker protocol).
// The worker owns the GPU, the drape and the file's binary parts; the UI owns the document's
// JSON. Three kinds of message:
//  - inputs (UI -> worker, no answer): canvas, size, pointer, controls, frame ticks;
//  - requests (UI -> worker, one reply each, matched by `id`): open, update, drape, save;
//  - events (worker -> UI, unasked): ready, stats, progress, crashed.

/** What the engine reports about a drape (Rust `PreparedInfo`). */
export interface DrapeInfo {
  sdf_key: string;
  vertices: number;
  self_collision: boolean;
  warnings: string[];
}

/** A file's content: the zip, or the folder form's files by relative path. */
export type FileData = { form: 'zip'; bytes: ArrayBuffer } | { form: 'folder'; files: [string, ArrayBuffer][] };

export function fileDataBuffers(d: FileData): ArrayBuffer[] {
  return d.form === 'zip' ? [d.bytes] : d.files.map(([, b]) => b);
}

export function copyFileData(d: FileData): FileData {
  return d.form === 'zip' ? { form: 'zip', bytes: d.bytes.slice(0) } : { form: 'folder', files: d.files.map(([p, b]) => [p, b.slice(0)]) };
}

export type Input =
  | { kind: 'init'; canvas: OffscreenCanvas; width: number; height: number }
  | { kind: 'resize'; width: number; height: number }
  /** `x`, `y`: normalized device coordinates (-1..1, y up); `px`, `py`: CSS pixels. */
  | { kind: 'pointer'; phase: 'down' | 'move' | 'up'; x: number; y: number; px: number; py: number }
  | { kind: 'wheel'; steps: number }
  | { kind: 'controls'; fast?: boolean; paused?: boolean; reset?: true }
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
  /** The worker can't go on (panic, lost GPU device): the UI restarts it. */
  | { kind: 'crashed'; reason: string };

export type ToWorker = Input | RequestMessage;
export type FromWorker = Reply | WorkerEvent;
