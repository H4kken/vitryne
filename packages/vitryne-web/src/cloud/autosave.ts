// SPDX-License-Identifier: AGPL-3.0-or-later
// Autosave (packages/vitryne-docs/content/docs/developers/cloud.md, Storage): once the document has been still for a moment, what Rust
// accepted is saved to the cloud. One save at a time; edits made during a save are saved after
// it. A network failure retries with a growing delay (the recovery copy keeps the changes
// meanwhile); a conflict, a refusal that needs an account, or another refusal stops until the
// person decides (`resume`).

import { CloudError } from "./backend";

export type SaveStatus =
  /** Nothing waiting to be saved. */
  | { kind: "saved" }
  /** Changes, saved once the document is still. */
  | { kind: "waiting" }
  | { kind: "saving" }
  /** The last save failed; another is tried at `retryAt` (ms since the epoch). */
  | { kind: "offline"; text: string; retryAt: number }
  /** No more saves until `resume`. */
  | { kind: "stopped"; reason: "conflict" | "account" | "error"; text: string };

export interface AutosaveTiming {
  /** How long the document must be still before a save. */
  delayMs: number;
  /** The first retry after a failure; each next one waits twice as long, up to `maxRetryMs`. */
  retryMs: number;
  maxRetryMs: number;
}

export const AUTOSAVE: AutosaveTiming = {
  delayMs: 2000,
  retryMs: 5000,
  maxRetryMs: 60000,
};

/** What stops autosave, or null for a failure worth retrying (the network, a busy server). */
function stopReason(
  e: unknown,
): { reason: "conflict" | "account" | "error"; text: string } | null {
  if (!(e instanceof CloudError)) return null;
  if (e.kind === "conflict") return { reason: "conflict", text: e.message };
  if (e.kind === "account") return { reason: "account", text: e.message };
  if (e.kind === "quota" || e.kind === "auth" || e.kind === "damaged")
    return { reason: "error", text: e.message };
  return null;
}

export class Autosaver {
  status: SaveStatus = { kind: "saved" };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private failures = 0;
  private save: () => Promise<void> = async () => undefined;
  private pending: () => boolean = () => false;

  /** `onStatus` hears every change of `status`. */
  constructor(
    private readonly onStatus: (s: SaveStatus) => void,
    private readonly timing: AutosaveTiming = AUTOSAVE,
  ) {}

  /**
   * `save` saves the document as Rust confirmed it; `pending` says whether there is anything to
   * save (and that saving is allowed). Nothing is saved before this is called.
   */
  connect(save: () => Promise<void>, pending: () => boolean) {
    this.save = save;
    this.pending = pending;
  }

  private set(s: SaveStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  /** The document changed: save once it has been still for a moment. */
  changed() {
    if (this.status.kind === "stopped") return;
    // Offline, the retry already waits; it finds nothing to do if the edits went back to the saved state.
    if (this.status.kind === "offline" && this.pending()) return;
    if (!this.pending()) {
      if (!this.running) {
        clearTimeout(this.timer);
        if (this.status.kind !== "saved") this.set({ kind: "saved" });
      }
      return;
    }
    this.schedule(this.timing.delayMs);
    if (!this.running && this.status.kind !== "waiting")
      this.set({ kind: "waiting" });
  }

  /** Saves what is waiting now (the tab is hidden, a project is about to close). True once nothing waits. */
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    if (this.status.kind !== "stopped" && this.pending()) await this.run();
    return !this.pending();
  }

  /** After a stop or a failure: try again (the person decided, or signed in). */
  resume() {
    this.failures = 0;
    clearTimeout(this.timer);
    if (this.running) return;
    this.set(this.pending() ? { kind: "waiting" } : { kind: "saved" });
    if (this.pending()) this.schedule(0);
  }

  /** Another document: forget this one's state. */
  reset() {
    clearTimeout(this.timer);
    this.failures = 0;
    if (this.status.kind !== "saved") this.set({ kind: "saved" });
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private run(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.status.kind === "stopped") return Promise.resolve();
    if (!this.pending()) {
      this.failures = 0;
      if (this.status.kind !== "saved") this.set({ kind: "saved" });
      return Promise.resolve();
    }
    this.set({ kind: "saving" });
    this.running = (async () => {
      let next: number | null = null;
      try {
        await this.save();
        this.failures = 0;
        if (this.pending()) {
          this.set({ kind: "waiting" });
          next = this.timing.delayMs;
        } else {
          this.set({ kind: "saved" });
        }
      } catch (e) {
        const stop = stopReason(e);
        if (stop) {
          this.set({ kind: "stopped", ...stop });
        } else {
          next = Math.min(
            this.timing.retryMs * 2 ** this.failures,
            this.timing.maxRetryMs,
          );
          this.failures++;
          this.set({
            kind: "offline",
            text: (e as Error).message ?? String(e),
            retryAt: Date.now() + next,
          });
        }
      } finally {
        this.running = null;
      }
      if (next !== null) this.schedule(next);
    })();
    return this.running;
  }
}
