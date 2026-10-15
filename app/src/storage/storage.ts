// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening project folders from disk (docs/ARCHITECTURE.md, Storage). Projects live in the cloud
// (src/cloud/) and save there by themselves; a project folder from disk opens as a new cloud
// project (a .vtry file comes through the editor's file input, with DXF patterns). Nothing is
// written to disk. Folders need the File System Access API (Chrome, Edge).

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
  openFolder(): Promise<Opened | null>;
}

// The File System Access API isn't in TypeScript's DOM library yet.
interface PickerWindow {
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

export class DiskFiles implements FileOpener {
  readonly opensFolders = typeof picker.showDirectoryPicker === 'function';

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
