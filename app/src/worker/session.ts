// SPDX-License-Identifier: AGPL-3.0-or-later
// The engine as the UI sees it: one worker at a time, restarted after a crash (a panic, a
// lost GPU device) with the document put back, since the document lives in the UI. React
// reads `state` through `useEngine`.

import { useSyncExternalStore } from 'react';
import { WorkerClient } from './client';
import type { DrapeInfo, Requests, Stats, WorkerEvent } from './protocol';

export interface EngineState {
  /** Changes when the worker is replaced: the viewport makes a new canvas for it. */
  generation: number;
  phase: 'starting' | 'ready' | 'failed';
  /** Why the engine gave up (too many crashes). */
  failure: string | null;
  /** Shown once after a restart. */
  notice: string | null;
  adapter: string | null;
  stats: Stats | null;
  progress: { task: string; fraction: number } | null;
  /** The newest drape shown, and its document revision. */
  drape: { rev: number; info: DrapeInfo } | null;
  drapeError: string | null;
  controls: { fast: boolean; paused: boolean };
}

/** Crashes within this window count towards giving up. */
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES = 3;

export class EngineSession {
  private client: WorkerClient | null = null;
  private listeners = new Set<() => void>();
  private crashes: number[] = [];
  /** What a new worker needs to show the same thing: the file's bytes and the current JSON. */
  private restore: { bytes: ArrayBuffer; openedEntities: string; entities: string; rev: number } | null = null;
  private newestDrapeAsked = -1;
  private canvas: HTMLCanvasElement | null = null;
  private detachTimer: ReturnType<typeof setTimeout> | undefined;

  state: EngineState = {
    generation: 0,
    phase: 'starting',
    failure: null,
    notice: null,
    adapter: null,
    stats: null,
    progress: null,
    drape: null,
    drapeError: null,
    controls: { fast: false, paused: false },
  };

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  /**
   * Starts a worker on `canvas` (a new canvas per generation: control transfers once). A
   * detach followed at once by an attach of the same canvas (React's development double
   * mount) keeps the worker.
   */
  attach(canvas: HTMLCanvasElement, size: { width: number; height: number }) {
    clearTimeout(this.detachTimer);
    if (this.client && this.canvas === canvas) return;
    this.canvas = canvas;
    this.client?.terminate();
    const client = new WorkerClient(canvas, size, (e) => this.onEvent(client, e));
    this.client = client;
    this.set({ phase: 'starting' });
    const { fast, paused } = this.state.controls;
    if (fast || paused) client.send({ kind: 'controls', fast, paused });
    if (this.restore) void this.reopen(client, this.restore);
  }

  detach() {
    clearTimeout(this.detachTimer);
    this.detachTimer = setTimeout(() => {
      this.client?.terminate();
      this.client = null;
      this.canvas = null;
    }, 0);
  }

  private onEvent(client: WorkerClient, e: WorkerEvent) {
    if (client !== this.client) return;
    switch (e.kind) {
      case 'ready':
        this.set({ phase: 'ready', adapter: e.adapter });
        return;
      case 'stats':
        this.set({ stats: e.stats });
        return;
      case 'progress':
        this.set({ progress: e.fraction >= 1 ? null : { task: e.task, fraction: e.fraction } });
        return;
      case 'crashed':
        this.crashed(e.reason);
        return;
    }
  }

  private crashed(reason: string) {
    console.error('engine worker crashed:', reason);
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    this.client = null;
    if (this.crashes.length >= MAX_CRASHES) {
      this.set({ phase: 'failed', failure: reason, progress: null });
      return;
    }
    // A new canvas mounts for the new generation and calls `attach`.
    this.set({
      generation: this.state.generation + 1,
      phase: 'starting',
      progress: null,
      notice: `The 3D engine stopped (${reason}) and was restarted. Your document is unchanged.`,
    });
  }

  private async reopen(client: WorkerClient, r: NonNullable<EngineSession['restore']>) {
    try {
      await client.request('open', { bytes: r.bytes.slice(0) });
      if (r.entities !== r.openedEntities) await client.request('update', { rev: r.rev, entities: r.entities });
      this.drape(r.rev, true);
    } catch (e) {
      // A crash during the reopen is handled as a crash; other errors are shown.
      if (client.alive) this.set({ drapeError: String((e as Error).message) });
    }
  }

  private need(): WorkerClient {
    if (!this.client) throw new Error('the 3D engine is restarting; try again in a moment');
    return this.client;
  }

  clearNotice() {
    this.set({ notice: null });
  }

  // ---- the document ---------------------------------------------------------------------

  /** Opens `.vtry` bytes; the worker keeps the binary parts, the UI gets the JSON. */
  async open(bytes: ArrayBuffer, rev: number): Promise<Requests['open']['reply']> {
    const copy = bytes.slice(0);
    const reply = await this.need().request('open', { bytes: bytes.slice(0) });
    this.restore = { bytes: copy, openedEntities: reply.entities, entities: reply.entities, rev };
    this.set({ drape: null, drapeError: null });
    return reply;
  }

  /** Validates and takes the document's new JSON (see `Requests.update`). */
  async update(rev: number, entities: string): Promise<Requests['update']['reply']> {
    const reply = await this.need().request('update', { rev, entities });
    if (this.restore) this.restore = { ...this.restore, entities, rev };
    return reply;
  }

  /** Re-drapes; only the newest revision's result is shown. */
  drape(rev: number, frameCamera: boolean) {
    this.newestDrapeAsked = Math.max(this.newestDrapeAsked, rev);
    const client = this.client;
    if (!client) return;
    client.request('drape', { rev, frameCamera }).then(
      (r) => {
        if (r.stale || r.rev < this.newestDrapeAsked || client !== this.client) return;
        this.set({ drape: { rev: r.rev, info: r.info }, drapeError: null });
      },
      (e: Error) => {
        if (rev >= this.newestDrapeAsked && client === this.client && client.alive) {
          this.set({ drape: null, drapeError: e.message, progress: null });
        }
      },
    );
  }

  /** The `.vtry` bytes of the worker's document (validated and read back in Rust). */
  async save(rev: number): Promise<ArrayBuffer> {
    const { bytes } = await this.need().request('save', { rev });
    if (this.restore) {
      this.restore = { bytes: bytes.slice(0), openedEntities: this.restore.entities, entities: this.restore.entities, rev };
    }
    return bytes;
  }

  // ---- inputs ---------------------------------------------------------------------------

  resize(width: number, height: number) {
    this.client?.send({ kind: 'resize', width, height });
  }

  pointer(phase: 'down' | 'move' | 'up', x: number, y: number, px: number, py: number) {
    this.client?.send({ kind: 'pointer', phase, x, y, px, py });
  }

  wheel(steps: number) {
    this.client?.send({ kind: 'wheel', steps });
  }

  setControls(c: Partial<EngineState['controls']>) {
    this.set({ controls: { ...this.state.controls, ...c } });
    this.client?.send({ kind: 'controls', ...c });
  }

  resetDrape() {
    this.client?.send({ kind: 'controls', reset: true });
  }
}

export function useEngine(session: EngineSession): EngineState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
