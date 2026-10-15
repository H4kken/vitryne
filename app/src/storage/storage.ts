// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening project files from disk (docs/ARCHITECTURE.md, Storage). Projects live in the cloud
// (src/cloud/) and save there by themselves; a .vtry file, or a project folder, from disk opens as a
// new cloud project. Nothing is written to disk. The File System Access API where the browser has
// it (Chrome, Edge: folders too), else a file input (Firefox, Safari).

import type { CloudRef } from '@/cloud/projects';
import type { FileData } from '@/worker/protocol';

/** The open document: its name, its form, and the cloud project it saves to (once it has one). */
export interface FileRef {
  name: string;
  form: FileData['form'];
  /** A cloud project (always the folder form): saves go back to it. */
  cloud?: CloudRef;
}

export interface Opened {
  ref: FileRef;
  data: FileData;
}

export interface FileOpener {
  readonly opensFolders: boolean;
  /** Null when the user cancels. */
  openFile(): Promise<Opened | null>;
  openFolder(): Promise<Opened | null>;
}

const VTRY_TYPES = [{ description: 'Vitryne project', accept: { 'application/vnd.vitryne.project+zip': ['.vtry'] } }];

// The File System Access API isn't in TypeScript's DOM library yet.
interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?(o: unknown): Promise<FileSystemDirectoryHandle>;
}
type IterableDirectory = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

// `globalThis`: this module also loads in tests (Node), where there is no window.
const picker = globalThis as unknown as PickerWindow;

function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
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

export class DiskFiles implements FileOpener {
  readonly opensFolders = typeof picker.showDirectoryPicker === 'function';

  async openFile(): Promise<Opened | null> {
    const show = picker.showOpenFilePicker;
    if (typeof show !== 'function') {
      const f = await pickWithInput();
      return f ? { ref: { name: f.name, form: 'zip' }, data: { form: 'zip', bytes: await f.arrayBuffer() } } : null;
    }
    try {
      const [handle] = await show.call(globalThis, { types: VTRY_TYPES, excludeAcceptAllOption: false });
      if (!handle) return null;
      const f = await handle.getFile();
      return { ref: { name: f.name, form: 'zip' }, data: { form: 'zip', bytes: await f.arrayBuffer() } };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }

  async openFolder(): Promise<Opened | null> {
    const show = picker.showDirectoryPicker;
    if (!show) return null;
    try {
      const dir = await show.call(globalThis, { mode: 'read' });
      return { ref: { name: dir.name, form: 'folder' }, data: { form: 'folder', files: await readFolder(dir) } };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }

}
