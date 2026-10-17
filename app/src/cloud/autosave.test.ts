// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveStatus } from "./autosave";
import { CloudError } from "./backend";

const timing = { delayMs: 2000, retryMs: 5000, maxRetryMs: 20000 };

/** A document whose `edits` are saved by `save`, which can be made to fail. */
function setup() {
  const doc = { rev: 0, saved: 0, fail: null as Error | null, saves: 0 };
  const statuses: SaveStatus["kind"][] = [];
  let release: (() => void) | null = null;
  const slow = { on: false };
  const a = new Autosaver((s) => statuses.push(s.kind), timing);
  a.connect(
    async () => {
      doc.saves++;
      const rev = doc.rev;
      if (slow.on) await new Promise<void>((r) => (release = r));
      if (doc.fail) throw doc.fail;
      doc.saved = rev;
    },
    () => doc.rev !== doc.saved,
  );
  const edit = () => {
    doc.rev++;
    a.changed();
  };
  return { a, doc, statuses, edit, slow, release: () => release?.() };
}

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once the document has been still, once for a burst of edits", async () => {
    const { a, doc, edit } = setup();
    edit();
    await vi.advanceTimersByTimeAsync(1500);
    edit();
    await vi.advanceTimersByTimeAsync(1500);
    expect(doc.saves).toBe(0);
    expect(a.status.kind).toBe("waiting");
    await vi.advanceTimersByTimeAsync(600);
    expect(doc.saves).toBe(1);
    expect(doc.saved).toBe(2);
    expect(a.status.kind).toBe("saved");
  });

  it("saves edits made during a save after it", async () => {
    const { a, doc, edit, slow, release } = setup();
    slow.on = true;
    edit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.status.kind).toBe("saving");
    edit();
    slow.on = false;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.saved).toBe(1);
    expect(a.status.kind).toBe("waiting");
    await vi.advanceTimersByTimeAsync(2000);
    expect(doc.saved).toBe(2);
    expect(doc.saves).toBe(2);
    expect(a.status.kind).toBe("saved");
  });

  it("retries a network failure with a growing delay, then saves", async () => {
    const { a, doc, edit } = setup();
    doc.fail = new TypeError("Failed to fetch");
    edit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.status).toMatchObject({
      kind: "offline",
      text: "Failed to fetch",
    });
    // Edits while offline don't restart the wait.
    edit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(doc.saves).toBe(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(doc.saves).toBe(2);
    doc.fail = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(doc.saves).toBe(3);
    expect(doc.saved).toBe(2);
    expect(a.status.kind).toBe("saved");
  });

  it("is saved again when edits made offline go back to the saved state", async () => {
    const { a, doc, edit } = setup();
    doc.fail = new TypeError("Failed to fetch");
    edit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.status.kind).toBe("offline");
    // Undone: nothing differs from the cloud any more.
    doc.rev = doc.saved;
    a.changed();
    expect(a.status.kind).toBe("saved");
    await vi.advanceTimersByTimeAsync(60000);
    expect(doc.saves).toBe(1);
  });

  it("stops on a conflict or a refusal that needs an account, until resumed", async () => {
    for (const kind of ["conflict", "account"] as const) {
      const { a, doc, edit } = setup();
      doc.fail = new CloudError("no", kind);
      edit();
      await vi.advanceTimersByTimeAsync(2000);
      expect(a.status).toMatchObject({ kind: "stopped", reason: kind });
      edit();
      await vi.advanceTimersByTimeAsync(60000);
      expect(doc.saves).toBe(1);
      expect(await a.flush()).toBe(false);
      doc.fail = null;
      a.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(doc.saved).toBe(2);
      expect(a.status.kind).toBe("saved");
    }
  });

  it("flushes at once, and says whether everything is saved", async () => {
    const { a, doc, edit } = setup();
    expect(await a.flush()).toBe(true);
    edit();
    expect(await a.flush()).toBe(true);
    expect(doc.saves).toBe(1);
    doc.fail = new TypeError("offline");
    edit();
    expect(await a.flush()).toBe(false);
  });

  it("forgets a failed document on reset", async () => {
    const { a, doc, edit } = setup();
    doc.fail = new CloudError("gone", "conflict");
    edit();
    await vi.advanceTimersByTimeAsync(2000);
    a.reset();
    expect(a.status.kind).toBe("saved");
    doc.saved = doc.rev;
    doc.fail = null;
    edit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.status.kind).toBe("saved");
    expect(doc.saved).toBe(doc.rev);
  });
});
