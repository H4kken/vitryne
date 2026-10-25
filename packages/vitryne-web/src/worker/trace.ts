// SPDX-License-Identifier: AGPL-3.0-or-later
// A short memory of what the UI asked the engine and what it answered, dumped when the worker
// crashes, since the crashed worker's own console is gone with it. In development
// `window.__vitryne` reaches it (`trace.entries`, `trace.crashes`, `trace.dump()`).

const CAPACITY = 200;

export interface TraceEntry {
  /** Milliseconds since the page loaded. */
  t: number;
  what: string;
}

export interface CrashRecord {
  at: string;
  reason: string;
  entries: TraceEntry[];
}

export const trace = {
  entries: [] as TraceEntry[],
  crashes: [] as CrashRecord[],

  /** Remember one thing; frequent, uninteresting messages (ticks, inputs) stay out. */
  note(what: string) {
    this.entries.push({ t: Math.round(performance.now()), what });
    if (this.entries.length > CAPACITY) this.entries.shift();
  },

  /** Keep the entries leading to a crash and print them. */
  crash(reason: string) {
    const record = {
      at: new Date().toISOString(),
      reason,
      entries: [...this.entries],
    };
    this.crashes = [...this.crashes.slice(-4), record];
    console.groupCollapsed(`engine trace before the crash: ${reason}`);
    for (const e of record.entries) console.log(`${e.t} ms`, e.what);
    console.groupEnd();
    this.entries = [];
  },

  dump(): string {
    return JSON.stringify(
      {
        agent: navigator.userAgent,
        crashes: this.crashes,
        entries: this.entries,
      },
      null,
      2,
    );
  },
};

if (import.meta.env.DEV) {
  (window as unknown as { __vitryne: unknown }).__vitryne = { trace };
}
