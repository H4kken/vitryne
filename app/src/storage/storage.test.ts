// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { writeFolder } from './storage';

/** An in-memory FileSystemDirectoryHandle, enough for writeFolder. */
class MemDir {
  kind = 'directory' as const;
  dirs = new Map<string, MemDir>();
  files = new Map<string, Uint8Array>();
  log: string[];
  constructor(log: string[] = []) {
    this.log = log;
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!o?.create) throw new DOMException('missing', 'NotFoundError');
      d = new MemDir(this.log);
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name) && !o?.create) throw new DOMException('missing', 'NotFoundError');
    const { files, log } = this;
    return {
      kind: 'file' as const,
      name,
      async createWritable() {
        let buf = new Uint8Array();
        return {
          async write(b: ArrayBuffer) {
            buf = new Uint8Array(b.slice(0));
          },
          async close() {
            files.set(name, buf);
            log.push(`write ${name}`);
          },
        };
      },
      async getFile() {
        const b = files.get(name) ?? new Uint8Array();
        return { arrayBuffer: async () => b.buffer.slice(0), text: async () => new TextDecoder().decode(b) };
      },
    };
  }
  async removeEntry(name: string) {
    this.files.delete(name);
    this.log.push(`remove ${name}`);
  }
}

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const manifest = (parts: string[]) => enc(JSON.stringify({ parts: parts.map((path) => ({ path })) }));

describe('writeFolder', () => {
  it('writes parts, then the manifest, then removes parts that are gone', async () => {
    const dir = new MemDir();
    dir.files.set('manifest.json', new Uint8Array(manifest(['project.json', 'old.json'])));
    dir.files.set('old.json', new Uint8Array(enc('{}')));
    dir.files.set('notes.txt', new Uint8Array(enc('mine')));
    await writeFolder(dir as unknown as FileSystemDirectoryHandle, [
      ['mimetype', enc('application/vnd.vitryne.project+zip')],
      ['manifest.json', manifest(['project.json', 'garments/a.json'])],
      ['project.json', enc('{"a":1}')],
      ['garments/a.json', enc('{}')],
    ]);
    expect(dir.log).toEqual(['write mimetype', 'write project.json', 'write a.json', 'write manifest.json', 'remove old.json']);
    expect(dir.files.has('notes.txt')).toBe(true);
    expect(dir.dirs.get('garments')?.files.has('a.json')).toBe(true);
  });

  it('refuses a folder that is not a Vitryne project', async () => {
    const dir = new MemDir();
    dir.files.set('photo.jpg', new Uint8Array(1));
    await expect(writeFolder(dir as unknown as FileSystemDirectoryHandle, [['manifest.json', manifest([])]])).rejects.toThrow(/not a Vitryne/);
    expect(dir.log).toEqual([]);
  });
});
