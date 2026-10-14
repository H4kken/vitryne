// SPDX-License-Identifier: AGPL-3.0-or-later
// The recovery copy: while a document has unsaved changes, its last state Rust accepted is
// kept in this browser (IndexedDB, never sent anywhere), so a crash or a closed tab loses
// nothing. Opened again, the editor offers it back. One record per tab; a clean document or a
// save removes the tab's record.

import type { CloudRef } from '@/cloud/projects';
import type { FileData } from '@/worker/protocol';

export interface Recovery {
  tab: string;
  fileName: string;
  /** The file as opened or last saved (the worker reopens it). */
  data: FileData;
  /** The entities of that file, and the unsaved ones (JSON). */
  saved: string;
  current: string;
  /** Never saved to a file (an imported pattern): recovered, it still needs saving. */
  unsaved?: boolean;
  /** Opened from the cloud: recovered, it still saves back to that project. */
  cloud?: CloudRef;
  at: number;
}

const DB = 'vitryne-recovery';
const STORE = 'documents';

/** This tab's id (survives a reload of the tab, not a new tab). */
export const TAB_ID = (() => {
  try {
    const id = sessionStorage.getItem('vitryne-tab') ?? crypto.randomUUID();
    sessionStorage.setItem('vitryne-tab', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'tab' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB unavailable'));
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = f(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    d.close();
  }
}

/** Best effort: without storage there is just no recovery copy. */
export async function keepRecovery(r: Omit<Recovery, 'tab' | 'at'>): Promise<void> {
  try {
    await run('readwrite', (s) => s.put({ ...r, tab: TAB_ID, at: Date.now() }));
  } catch (e) {
    console.warn('no recovery copy:', e);
  }
}

export async function dropRecovery(tab = TAB_ID): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(tab));
  } catch {
    // Nothing kept.
  }
}

/** The newest copy left by a tab that isn't this one (or this one before a reload). */
export async function findRecovery(): Promise<Recovery | null> {
  try {
    const all = (await run('readonly', (s) => s.getAll())) as Recovery[];
    return all.sort((a, b) => b.at - a.at)[0] ?? null;
  } catch {
    return null;
  }
}
