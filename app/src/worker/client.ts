// SPDX-License-Identifier: AGPL-3.0-or-later
// The UI's end of the worker protocol: typed requests with promised replies, inputs, and the
// worker's events. One `WorkerClient` per worker; `EngineSession` replaces it after a crash.

import type {
  FromWorker,
  Input,
  Op,
  Requests,
  ToWorker,
  WorkerEvent,
} from "./protocol";

export class WorkerCrashed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WorkerCrashed";
  }
}

export class WorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private dead: string | null = null;
  private tickLoop = 0;

  constructor(
    canvas: HTMLCanvasElement,
    size: { width: number; height: number },
    private readonly onEvent: (e: WorkerEvent) => void,
  ) {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) =>
      this.receive(e.data);
    // An uncaught error in the worker (a failed import, a bug outside a request).
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.die(e.message || "the engine worker failed");
    };
    this.worker.onmessageerror = () =>
      this.die("a message from the engine worker could not be read");
    const offscreen = canvas.transferControlToOffscreen();
    (canvas as HTMLCanvasElement & { __transferred?: boolean }).__transferred =
      true;
    this.send({ kind: "init", canvas: offscreen, ...size }, [offscreen]);
  }

  private receive(m: FromWorker) {
    if (m.kind === "reply") {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error));
      return;
    }
    if (m.kind === "crashed") {
      this.die(m.reason);
      return;
    }
    if (m.kind === "ready" && m.needsTicks) this.startTicks();
    this.onEvent(m);
  }

  /** Frames from the UI's requestAnimationFrame, where workers don't have one. */
  private startTicks() {
    const tick = () => {
      if (this.dead) return;
      this.send({ kind: "tick" });
      this.tickLoop = requestAnimationFrame(tick);
    };
    this.tickLoop = requestAnimationFrame(tick);
  }

  private die(reason: string) {
    if (this.dead) return;
    this.dead = reason;
    cancelAnimationFrame(this.tickLoop);
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new WorkerCrashed(reason));
    this.pending.clear();
    this.onEvent({ kind: "crashed", reason });
  }

  get alive(): boolean {
    return this.dead === null;
  }

  send(m: Input, transfer: Transferable[] = []) {
    if (!this.dead) this.worker.postMessage(m satisfies ToWorker, transfer);
  }

  request<K extends Op>(
    op: K,
    args: Requests[K]["args"],
    transfer: Transferable[] = [],
  ): Promise<Requests[K]["reply"]> {
    if (this.dead) return Promise.reject(new WorkerCrashed(this.dead));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.worker.postMessage(
        { kind: "request", id, op, args } as ToWorker,
        transfer,
      );
    });
  }

  terminate() {
    this.dead ??= "closed";
    cancelAnimationFrame(this.tickLoop);
    this.worker.terminate();
    for (const p of this.pending.values())
      p.reject(new WorkerCrashed("closed"));
    this.pending.clear();
  }
}
