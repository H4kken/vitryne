// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { WorkerCrashed } from '@/worker/client';
import { openExample } from '@/test/rust';
import { setFabricValue, renameProject } from './commands';
import { DocumentStore, type Engine } from './store';

/** An engine whose answers the test controls. */
function fakeEngine() {
  const calls: { rev: number; entities: string; resolve: (w: { warnings: string[] }) => void; reject: (e: Error) => void }[] = [];
  const drapes: number[] = [];
  let reopened: () => void = () => {};
  const engine: Engine = {
    update: (rev, entities) => new Promise((resolve, reject) => calls.push({ rev, entities, resolve, reject })),
    drape: (rev) => drapes.push(rev),
    onReopened: (cb) => (reopened = cb),
  };
  return { engine, calls, drapes, reopen: () => reopened() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const fake = fakeEngine();
  const store = new DocumentStore(fake.engine, { freeze: true, drapeDelayMs: 5 });
  const { entities } = openExample('tshirt');
  store.load('tshirt.vtry', entities, [], 0);
  return { ...fake, store, entities, fabric: entities.fabrics[0]!.id };
}

describe('DocumentStore', () => {
  it('undoes and redoes, and is clean again after undoing everything', async () => {
    const { store, calls, fabric } = setup();
    store.execute((e) => setFabricValue(e, fabric, 'friction', 0.5));
    store.execute((e) => renameProject(e, 'Mine'));
    expect(store.state.dirty).toBe(true);
    expect(store.state.undoLabel).toBe('Rename the project');
    store.undo();
    store.undo();
    expect(store.state.dirty).toBe(false);
    expect(store.state.redoLabel).toBe('Change the fabric');
    store.redo();
    expect(store.state.entities.fabrics[0]!.friction).toBe(0.5);
    expect(store.state.rev).toBe(5);
    // One request at a time; the newest state is sent once the first is answered.
    expect(calls).toHaveLength(1);
    calls[0]!.resolve({ warnings: [] });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.rev).toBe(5);
  });

  it('merges a slider gesture into one undo step', () => {
    const { store, fabric } = setup();
    store.beginGesture(`fabric:${fabric}:density`);
    for (const d of [0.16, 0.17, 0.18]) store.execute((e) => setFabricValue(e, fabric, 'density', d));
    store.endGesture();
    store.execute((e) => setFabricValue(e, fabric, 'density', 0.2));
    store.undo();
    expect(store.state.entities.fabrics[0]!.density).toBe(0.18);
    store.undo();
    expect(store.state.entities.fabrics[0]!.density).toBe(0.15);
    expect(store.state.undoLabel).toBeNull();
  });

  it('rolls back to the last state Rust accepted when Rust refuses', async () => {
    const { store, calls, fabric, entities } = setup();
    store.execute((e) => setFabricValue(e, fabric, 'friction', 0.5));
    calls[0]!.resolve({ warnings: [] });
    await flush();
    store.execute((e) => setFabricValue(e, fabric, 'friction', 0.6));
    store.execute((e) => setFabricValue(e, fabric, 'friction', 0.7));
    calls[1]!.reject(new Error('no'));
    await flush();
    expect(store.state.entities.fabrics[0]!.friction).toBe(0.5);
    expect(store.state.refused).toMatch(/undone: no/);
    expect(store.state.undoLabel).toBe('Change the fabric');
    store.undo();
    expect(store.state.entities).toEqual(entities);
  });

  it('keeps an edit the worker lost in a crash and sends it again after the restart', async () => {
    const { store, calls, fabric, reopen } = setup();
    store.execute((e) => setFabricValue(e, fabric, 'friction', 0.5));
    calls[0]!.reject(new WorkerCrashed('gone'));
    await flush();
    expect(store.state.entities.fabrics[0]!.friction).toBe(0.5);
    expect(store.state.refused).toBeNull();
    reopen();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.entities).fabrics[0].friction).toBe(0.5);
  });

  it('re-drapes once after a burst of drape-relevant edits, and not for a rename', async () => {
    vi.useFakeTimers();
    try {
      const { store, calls, drapes, fabric } = setup();
      store.execute((e) => renameProject(e, 'Mine'));
      calls[0]!.resolve({ warnings: [] });
      await vi.runAllTimersAsync();
      expect(drapes).toEqual([]);
      store.execute((e) => setFabricValue(e, fabric, 'friction', 0.5));
      store.execute((e) => setFabricValue(e, fabric, 'friction', 0.6));
      calls[1]!.resolve({ warnings: [] });
      await vi.runAllTimersAsync();
      calls[2]!.resolve({ warnings: [] });
      await vi.runAllTimersAsync();
      expect(drapes).toEqual([3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a bad value without changing anything, and says why', () => {
    const { store, calls, fabric, entities } = setup();
    expect(store.execute((e) => setFabricValue(e, fabric, 'density', -1))).toBe(false);
    expect(store.state.entities).toBe(entities);
    expect(store.state.refused).toMatch(/density/);
    expect(calls).toHaveLength(0);
  });

  it('freezes the document, so a stray mutation throws', () => {
    const { store } = setup();
    expect(() => {
      (store.state.entities.fabrics[0] as { friction: number }).friction = 1;
    }).toThrow();
  });
});
