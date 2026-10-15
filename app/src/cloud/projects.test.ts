// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { exampleZip, EXAMPLES, wasm } from '@/test/rust';
import { type CloudBackend, CloudError, type CloudUser, type Manifest, type ProjectRow } from './backend';
import { collectUnused, copyName, deleteAccount, duplicateProject, exportAll, fileName, moveProjects, openProject, projectZip, saveProject, sha256Hex } from './projects';
import { crc32 } from './zip';

/** A backend in memory, shaped like the real one (RLS: each user sees only their own; an anonymous user keeps one draft). */
class MemBackend implements CloudBackend {
  static objects = new Map<string, ArrayBuffer>();
  static rows = new Map<string, ProjectRow>();
  uploads: string[] = [];
  constructor(public me: CloudUser | null = null) {}
  user() {
    return this.me;
  }
  async ensureUser() {
    this.me ??= { id: crypto.randomUUID(), email: null, anonymous: true };
    return this.me;
  }
  private mine() {
    return [...MemBackend.rows.values()].filter((r) => r.owner === this.me?.id);
  }
  async listProjects() {
    return this.mine().map(({ id, name, bytes, revision, updatedAt }) => ({ id, name, bytes, revision, updatedAt }));
  }
  async getProject(id: string) {
    const r = this.mine().find((x) => x.id === id);
    if (!r) throw new CloudError('gone');
    return structuredClone(r);
  }
  async insertProject(p: { name: string; manifest: Manifest; bytes: number }) {
    if (this.me?.anonymous && this.mine().length >= 1) throw new CloudError('an account is needed', 'account');
    const r: ProjectRow = { ...structuredClone(p), id: crypto.randomUUID(), owner: this.me!.id, revision: 1, updatedAt: new Date().toISOString() };
    MemBackend.rows.set(r.id, r);
    return structuredClone(r);
  }
  async updateProject(id: string, revision: number, p: { name: string; manifest: Manifest; bytes: number }) {
    const r = this.mine().find((x) => x.id === id);
    if (!r || r.revision !== revision) return null;
    Object.assign(r, structuredClone(p), { revision: r.revision + 1 });
    return structuredClone(r);
  }
  async deleteProject(id: string) {
    if (this.mine().some((r) => r.id === id)) MemBackend.rows.delete(id);
  }
  private own(name: string) {
    return name.startsWith(`${this.me?.id}/`);
  }
  async hasPart(name: string) {
    return this.own(name) && MemBackend.objects.has(name);
  }
  async uploadPart(name: string, bytes: ArrayBuffer) {
    if (!this.own(name) || !/^[^/]+\/[0-9a-f]{64}$/.test(name)) throw new CloudError('refused');
    this.uploads.push(name);
    if (!MemBackend.objects.has(name)) MemBackend.objects.set(name, bytes.slice(0));
  }
  async downloadPart(name: string) {
    const b = this.own(name) ? MemBackend.objects.get(name) : undefined;
    if (!b) throw new CloudError('missing');
    return b.slice(0);
  }
  async listParts() {
    return [...MemBackend.objects.keys()].filter((k) => this.own(k));
  }
  async removeParts(names: string[]) {
    for (const n of names) if (this.own(n)) MemBackend.objects.delete(n);
  }
  async unusedParts() {
    const used = new Set(this.mine().flatMap((r) => r.manifest.parts.map((p) => `${r.owner}/${p.sha256}`)));
    return (await this.listParts()).filter((n) => !used.has(n));
  }
  async usage() {
    return { usedBytes: 0, quotaBytes: 1, projects: this.mine().length, maxProjects: 1 };
  }
  async deleteUser() {
    if ((await this.listParts()).length) throw new CloudError('parts first');
    for (const r of this.mine()) MemBackend.rows.delete(r.id);
    this.me = null;
  }
}

/** A backend signed in to an account (several projects). */
const account = () => new MemBackend({ id: crypto.randomUUID(), email: 'a@b.c', anonymous: false });

/** The folder form of an example, as the worker's save gives it. */
function folder(name: string): [string, ArrayBuffer][] {
  const f = wasm.VtryFile.open(exampleZip(name));
  return (f.save_folder() as [string, Uint8Array][]).map(([p, b]) => [p, b.slice().buffer as ArrayBuffer]);
}

function rustOpensFolder(files: [string, ArrayBuffer][]) {
  return wasm.VtryFile.open_folder(
    files.map(([p]) => p),
    files.map(([, b]) => new Uint8Array(b)),
  );
}

describe('cloud projects', () => {
  it('saves each example and opens it back to the same entities', async () => {
    for (const ex of EXAMPLES) {
      const b = new MemBackend();
      const files = folder(ex);
      const ref = await saveProject(b, ex, files, null);
      const o = await openProject(b, ref.id);
      expect(o.data.form).toBe('folder');
      if (o.data.form !== 'folder') return;
      const back = rustOpensFolder(o.data.files);
      expect(back.entities()).toBe(rustOpensFolder(files).entities());
      // Every part is byte for byte what was saved.
      const saved = new Map(files);
      for (const [p, bytes] of o.data.files) if (p !== 'manifest.json') expect(new Uint8Array(bytes)).toEqual(new Uint8Array(saved.get(p)!));
    }
  });

  it('uploads only the parts the backend does not have', async () => {
    const b = account();
    const files = folder('tshirt');
    const first = await saveProject(b, 'one', files, null);
    expect(b.uploads.length).toBe(first.parts.length);
    // A second project with the same avatar uploads nothing new.
    b.uploads = [];
    await saveProject(b, 'two', files, null);
    expect(b.uploads).toEqual([]);
    // A fabric change uploads one part.
    const f = wasm.VtryFile.open(exampleZip('tshirt'));
    const e = JSON.parse(f.entities()) as { fabrics: { name: string }[] };
    e.fabrics[0]!.name = 'Changed';
    f.set_entities(JSON.stringify(e));
    const changed = (f.save_folder() as [string, Uint8Array][]).map(([p, x]) => [p, x.slice().buffer as ArrayBuffer] as [string, ArrayBuffer]);
    const again = await saveProject(b, 'one', changed, first);
    expect(b.uploads.length).toBe(1);
    expect(again.revision).toBe(2);
  });

  it('refuses a save over a newer revision and changes nothing', async () => {
    const b = new MemBackend();
    const files = folder('trousers');
    const ref = await saveProject(b, 'p', files, null);
    await saveProject(b, 'p', files, ref);
    await expect(saveProject(b, 'stale', files, ref)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await b.getProject(ref.id)).name).toBe('p');
  });

  it('refuses a part whose bytes do not match its hash, before uploading anything', async () => {
    const b = new MemBackend();
    const files = folder('tshirt').map(([p, x]): [string, ArrayBuffer] => [p, p === 'project.json' ? new TextEncoder().encode('{}').buffer : x]);
    await expect(saveProject(b, 'x', files, null)).rejects.toThrow(/hash/);
    expect(b.uploads).toEqual([]);
  });

  it('notices a damaged part on open', async () => {
    const b = new MemBackend();
    const ref = await saveProject(b, 'x', folder('tshirt'), null);
    const key = `${b.me!.id}/${ref.parts[0]}`;
    MemBackend.objects.set(key, new TextEncoder().encode('garbage').buffer);
    await expect(openProject(b, ref.id)).rejects.toMatchObject({ kind: 'damaged' });
  });

  it('downloads a project as a .vtry Rust opens, mimetype first and stored', async () => {
    const b = new MemBackend();
    const ref = await saveProject(b, 'T-shirt', folder('tshirt'), null);
    const z = await projectZip(b, ref.id);
    const bytes = new Uint8Array(z.bytes);
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype');
    expect(new TextDecoder().decode(bytes.slice(38, 38 + 35))).toBe('application/vnd.vitryne.project+zip');
    expect(wasm.VtryFile.open(bytes).entities()).toBe(wasm.VtryFile.open(exampleZip('tshirt')).entities());
  });

  it('exports every project and the account', async () => {
    const b = account();
    await saveProject(b, 'Same', folder('tshirt'), null);
    await saveProject(b, 'Same', folder('trousers'), null);
    const z = new Uint8Array(await exportAll(b, { email: 'a@b.c' }));
    const text = new TextDecoder('latin1').decode(z);
    expect(text).toContain('account.json');
    expect(text).toContain('projects/Same.vtry');
    expect(text).toContain('projects/Same (2).vtry');
  });

  it('collects parts no project uses, and deletes an account with everything in it', async () => {
    const b = account();
    const t = await saveProject(b, 't', folder('tshirt'), null);
    await saveProject(b, 'h', folder('hoodie'), null);
    await b.deleteProject(t.id);
    const before = (await b.listParts()).length;
    const n = await collectUnused(b);
    expect(n).toBeGreaterThan(0);
    // The avatar is shared with the hoodie: kept.
    expect((await b.listParts()).length).toBe(before - n);
    const other = new MemBackend();
    await saveProject(other, 'kept', folder('tshirt'), null);
    await deleteAccount(b);
    expect(b.me).toBeNull();
    expect((await other.listProjects()).length).toBe(1);
    expect((await other.listParts()).length).toBeGreaterThan(0);
  });

  it("moves an anonymous user's projects to the account they sign in to", async () => {
    const anon = new MemBackend();
    await saveProject(anon, 'mine', folder('tshirt'), null);
    const to = account();
    const r = await moveProjects(anon, to);
    expect(r).toEqual({ moved: 1, failed: [] });
    expect((await to.listProjects()).map((p) => p.name)).toEqual(['mine']);
    expect(anon.me).toBeNull();
  });

  it('keeps one draft for an anonymous user', async () => {
    const anon = new MemBackend();
    await saveProject(anon, 'draft', folder('tshirt'), null);
    await expect(saveProject(anon, 'second', folder('trousers'), null)).rejects.toMatchObject({ kind: 'account' });
    expect((await anon.listProjects()).map((p) => p.name)).toEqual(['draft']);
  });

  it('duplicates a project as one new row, uploading nothing', async () => {
    const b = account();
    const ref = await saveProject(b, 'T-shirt', folder('tshirt'), null);
    b.uploads = [];
    const copy = await duplicateProject(b, ref.id);
    expect(copy.name).toBe('T-shirt (copy)');
    expect(copy.id).not.toBe(ref.id);
    expect(b.uploads).toEqual([]);
    const [a, c] = await Promise.all([openProject(b, ref.id), openProject(b, copy.id)]);
    expect(c.data).toEqual(a.data);
    // An anonymous user's draft can't be duplicated.
    const anon = new MemBackend();
    const draft = await saveProject(anon, 'draft', folder('tshirt'), null);
    await expect(duplicateProject(anon, draft.id)).rejects.toMatchObject({ kind: 'account' });
  });

  it('keeps copy names within the backend limit', () => {
    expect(copyName('x'.repeat(200))).toHaveLength(200);
    expect(copyName('x'.repeat(200)).endsWith(' (copy)')).toBe(true);
  });

  it('names files safely and uniquely', () => {
    const taken = new Set<string>();
    expect(fileName('a/b: c', taken)).toBe('a_b_ c.vtry');
    expect(fileName('a/b: c', taken)).toBe('a_b_ c (2).vtry');
    expect(fileName('  ', taken)).toBe('project.vtry');
  });

  it('computes the standard CRC-32 and SHA-256', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
