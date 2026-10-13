// SPDX-License-Identifier: AGPL-3.0-or-later
// Where projects are opened from and saved to (docs/ARCHITECTURE.md, Storage). The editor only
// talks to `ProjectStorage`; this file has the local one (M12 adds a cloud one beside it):
// the File System Access API where the browser has it (Chrome, Edge: save in place, folders),
// else a file input to open and a download to save (Firefox, Safari).

import type { FileData } from '@/worker/protocol';

export interface FileRef {
  name: string;
  form: FileData['form'];
  /** Where to save in place, when the browser gave us one. */
  handle?: FileSystemFileHandle | FileSystemDirectoryHandle;
}

export interface Opened {
  ref: FileRef;
  data: FileData;
}

export interface Saved {
  ref: FileRef;
  /** Written and read back from disk, or handed to the browser as a download (not readable). */
  how: 'verified' | 'downloaded';
}

export interface ProjectStorage {
  /** Save writes over the opened file (otherwise every save is a download). */
  readonly savesInPlace: boolean;
  readonly opensFolders: boolean;
  /** Null when the user cancels. */
  openFile(): Promise<Opened | null>;
  openFolder(): Promise<Opened | null>;
  save(ref: FileRef, data: FileData): Promise<Saved>;
  /** Always the zip form. Null when the user cancels. */
  saveAs(suggestedName: string, data: Extract<FileData, { form: 'zip' }>): Promise<Saved | null>;
}

export class SaveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SaveError';
  }
}

const VTRY_TYPES = [{ description: 'Vitryne project', accept: { 'application/vnd.vitryne.project+zip': ['.vtry'] } }];

// The File System Access API isn't in TypeScript's DOM library yet.
interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o: unknown): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(o: unknown): Promise<FileSystemDirectoryHandle>;
}
interface Writable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}
type WritableHandle = FileSystemFileHandle & { createWritable(): Promise<Writable> };
type PermissionHandle = { requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState> };
type IterableDirectory = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

// `globalThis`: this module also loads in tests (Node), where there is no window.
const picker = globalThis as unknown as PickerWindow;

function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

async function writeFile(handle: FileSystemFileHandle, bytes: ArrayBuffer, what: string) {
  const w = await (handle as WritableHandle).createWritable();
  await w.write(bytes);
  await w.close();
  const back = await (await handle.getFile()).arrayBuffer();
  if (!sameBytes(back, bytes)) throw new SaveError(`${what} reads back differently from what was written`);
}

async function ensureWritable(h: FileSystemHandle) {
  const p = (h as unknown as PermissionHandle).requestPermission;
  if (p && (await p.call(h, { mode: 'readwrite' })) !== 'granted') throw new SaveError('permission to write there was not given');
}

/** Every file under `dir`, by relative path. */
async function readFolder(dir: FileSystemDirectoryHandle, prefix = ''): Promise<[string, ArrayBuffer][]> {
  const out: [string, ArrayBuffer][] = [];
  for await (const [name, h] of (dir as IterableDirectory).entries()) {
    if (name.startsWith('.')) continue; // .DS_Store and the like
    const path = prefix + name;
    if (h.kind === 'directory') out.push(...(await readFolder(h as FileSystemDirectoryHandle, `${path}/`)));
    else out.push([path, await (await (h as FileSystemFileHandle).getFile()).arrayBuffer()]);
  }
  return out;
}

async function fileAt(dir: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemFileHandle> {
  const segs = path.split('/');
  let d = dir;
  for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create });
  return d.getFileHandle(segs.at(-1) ?? path, { create });
}

/**
 * Writes the folder form like `container::write_dir`: parts first, the manifest last (a folder
 * interrupted mid-save still has its old manifest), then the parts the old manifest listed
 * that are gone. Every file is read back.
 */
export async function writeFolder(dir: FileSystemDirectoryHandle, files: [string, ArrayBuffer][]) {
  let oldParts: string[];
  try {
    const m = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()) as { parts?: { path?: string }[] };
    oldParts = (m.parts ?? []).flatMap((p) => (typeof p.path === 'string' ? [p.path] : []));
  } catch {
    throw new SaveError('this folder is not a Vitryne project folder (no manifest.json)');
  }
  const ordered = [...files.filter(([p]) => p !== 'manifest.json'), ...files.filter(([p]) => p === 'manifest.json')];
  for (const [path, bytes] of ordered) await writeFile(await fileAt(dir, path, true), bytes, path);
  const kept = new Set(files.map(([p]) => p));
  for (const path of oldParts.filter((p) => !kept.has(p) && !p.split('/').includes('..'))) {
    const segs = path.split('/');
    try {
      let d = dir;
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s);
      await d.removeEntry(segs.at(-1) ?? path);
    } catch {
      // Already gone.
    }
  }
}

function download(name: string, bytes: ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.vitryne.project+zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.vtry') ? name : `${name}.vtry`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vtry';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export class LocalStorage implements ProjectStorage {
  readonly savesInPlace = typeof picker.showOpenFilePicker === 'function' && typeof picker.showSaveFilePicker === 'function';
  readonly opensFolders = typeof picker.showDirectoryPicker === 'function';

  async openFile(): Promise<Opened | null> {
    if (!this.savesInPlace) {
      const f = await pickWithInput();
      return f ? { ref: { name: f.name, form: 'zip' }, data: { form: 'zip', bytes: await f.arrayBuffer() } } : null;
    }
    const show = picker.showOpenFilePicker;
    if (!show) return null;
    try {
      const [handle] = await show.call(globalThis, { types: VTRY_TYPES, excludeAcceptAllOption: false });
      if (!handle) return null;
      const f = await handle.getFile();
      return { ref: { name: f.name, form: 'zip', handle }, data: { form: 'zip', bytes: await f.arrayBuffer() } };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }

  async openFolder(): Promise<Opened | null> {
    const show = picker.showDirectoryPicker;
    if (!show) return null;
    try {
      const dir = await show.call(globalThis, { mode: 'readwrite' });
      return { ref: { name: dir.name, form: 'folder', handle: dir }, data: { form: 'folder', files: await readFolder(dir) } };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }

  async save(ref: FileRef, data: FileData): Promise<Saved> {
    if (data.form !== ref.form) throw new SaveError('internal: the save form does not match the file');
    if (!ref.handle) {
      if (data.form !== 'zip') throw new SaveError('this browser can only save a folder project as a .vtry file (use Save as)');
      download(ref.name, data.bytes);
      return { ref, how: 'downloaded' };
    }
    try {
      await ensureWritable(ref.handle);
      if (data.form === 'zip') await writeFile(ref.handle as FileSystemFileHandle, data.bytes, ref.name);
      else await writeFolder(ref.handle as FileSystemDirectoryHandle, data.files);
    } catch (e) {
      if (e instanceof SaveError) throw e;
      throw new SaveError(`could not write ${ref.name}: ${(e as Error).message}`, { cause: e });
    }
    return { ref, how: 'verified' };
  }

  async saveAs(suggestedName: string, data: Extract<FileData, { form: 'zip' }>): Promise<Saved | null> {
    const name = suggestedName.replace(/\.vtry$/, '') + '.vtry';
    const show = picker.showSaveFilePicker;
    if (!this.savesInPlace || !show) {
      download(name, data.bytes);
      return { ref: { name, form: 'zip' }, how: 'downloaded' };
    }
    let handle: FileSystemFileHandle;
    try {
      handle = await show.call(globalThis, { suggestedName: name, types: VTRY_TYPES });
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
    const ref: FileRef = { name: handle.name, form: 'zip', handle };
    return this.save(ref, data);
  }
}
