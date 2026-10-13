// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a body's SDF comes from, by key (Rust `SdfParams::cache_key`): the SDFs bundled with
// the app for the examples (`drape export-app-assets`), then this browser's own cache (the
// origin private file system, never sent anywhere), else nothing and the worker bakes it.

const MAGIC = 'DSDF0001';

/** The worker-only part of the file system API (the app's types use the DOM library). */
interface SyncAccessHandle {
  truncate(size: number): void;
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}
type WorkerFileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };

function isSdf(b: Uint8Array): boolean {
  return b.length > MAGIC.length && new TextDecoder().decode(b.subarray(0, MAGIC.length)) === MAGIC;
}

async function cacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('sdf-cache', { create: true });
}

export async function loadSdf(key: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}sdf/${key}.bin`);
    // A dev server answers a missing file with the app's HTML, hence the magic check.
    if (r.ok) {
      const b = new Uint8Array(await r.arrayBuffer());
      if (isSdf(b)) return b;
    }
  } catch {
    // Offline or not bundled: try the cache.
  }
  try {
    const h = await (await cacheDir()).getFileHandle(`${key}.bin`);
    const b = new Uint8Array(await (await h.getFile()).arrayBuffer());
    if (isSdf(b)) return b;
  } catch {
    // Not cached (or no storage in this browser).
  }
  return null;
}

/** Best effort: a full or unavailable storage only means baking again next time. */
export async function storeSdf(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const h = await (await cacheDir()).getFileHandle(`${key}.bin`, { create: true });
    const access = await (h as WorkerFileHandle).createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(bytes, { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  } catch (e) {
    console.warn('SDF not cached:', e);
  }
}

export async function dropSdf(key: string): Promise<void> {
  try {
    await (await cacheDir()).removeEntry(`${key}.bin`);
  } catch {
    // Not there.
  }
}
