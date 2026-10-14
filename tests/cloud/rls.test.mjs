// SPDX-License-Identifier: AGPL-3.0-or-later
// Row-level security and quotas, against a running Supabase with the schema (instance.mjs says
// which): two anonymous users, A and B, and everything B tries on A's projects and parts must
// fail. Needs Node 20+ and nothing else. Changes the limits for a moment (`sql` in instance.mjs).
//
//   node --test 'tests/cloud/*.test.mjs'          (the local stack: `pnpm run supabase start` in app/)

import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, sql, URL_ } from './instance.mjs';

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const h = { apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string') {
    h['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  }
  const r = await fetch(URL_ + path, { method, headers: h, body: b });
  const bytes = Buffer.from(await r.arrayBuffer());
  const text = bytes.toString('utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: r.status, json, text, bytes };
}

async function anonymousUser() {
  const r = await call('/auth/v1/signup', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  return { token: r.json.access_token, id: r.json.user.id };
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const upload = (u, name, bytes, upsert = false) =>
  call(`/storage/v1/object/parts/${name}`, {
    token: u.token,
    method: 'POST',
    body: bytes,
    headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': String(upsert) },
  });
const download = (u, name) => call(`/storage/v1/object/authenticated/parts/${name}`, { token: u.token });
const list = (u, prefix) => call('/storage/v1/object/list/parts', { token: u.token, method: 'POST', body: { prefix, limit: 100 } });
const remove = (u, names) => call('/storage/v1/object/parts', { token: u.token, method: 'DELETE', body: { prefixes: names } });
const insertProject = (u, row) =>
  call('/rest/v1/projects', { token: u.token, method: 'POST', body: row, headers: { Prefer: 'return=representation' } });
const projects = (u, query = '') => call(`/rest/v1/projects?select=*${query}`, { token: u.token });

const manifest = (h) => ({ format: 'vitryne', kind: 'project', formatVersion: 1, parts: [{ path: 'project.json', mediaType: 'application/json', sha256: h }] });

describe('row-level security', () => {
  let A, B, partA, nameA, projectA;

  before(async () => {
    A = await anonymousUser();
    B = await anonymousUser();
    partA = randomBytes(256);
    nameA = `${A.id}/${sha(partA)}`;
    const up = await upload(A, nameA, partA);
    assert.equal(up.status, 200, up.text);
    const ins = await insertProject(A, { name: 'A project', manifest: manifest(sha(partA)), bytes: partA.length });
    assert.equal(ins.status, 201, ins.text);
    projectA = ins.json[0];
  });

  test('without a user, the publishable key reaches nothing', async () => {
    const sel = await call('/rest/v1/projects?select=*');
    assert.ok(sel.status === 401 || sel.status === 403, `select: ${sel.status} ${sel.text}`);
    const ins = await call('/rest/v1/projects', { method: 'POST', body: { name: 'x', manifest: {}, bytes: 0 } });
    assert.ok(ins.status === 401 || ins.status === 403, `insert: ${ins.status}`);
    const get = await call(`/storage/v1/object/authenticated/parts/${nameA}`);
    assert.ok(get.status >= 400, `download: ${get.status}`);
    const rpc = await call('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
    assert.ok(rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `rpc: ${rpc.status} ${rpc.text}`);
  });

  test('A sees its own project, owned by A, at revision 1', async () => {
    assert.equal(projectA.owner, A.id);
    assert.equal(projectA.revision, 1);
    const r = await projects(A);
    assert.deepEqual(
      r.json.map((p) => p.id),
      [projectA.id],
    );
    const d = await download(A, nameA);
    assert.equal(d.status, 200);
    assert.equal(sha(d.bytes), sha(partA));
  });

  test("B can't read or list A's projects", async () => {
    assert.deepEqual((await projects(B)).json, []);
    assert.deepEqual((await projects(B, `&id=eq.${projectA.id}`)).json, []);
  });

  test("B can't change or delete A's project", async () => {
    const p = await call(`/rest/v1/projects?id=eq.${projectA.id}`, {
      token: B.token,
      method: 'PATCH',
      body: { name: 'taken' },
      headers: { Prefer: 'return=representation' },
    });
    assert.deepEqual(p.json, []);
    const d = await call(`/rest/v1/projects?id=eq.${projectA.id}`, { token: B.token, method: 'DELETE', headers: { Prefer: 'return=representation' } });
    assert.deepEqual(d.json, []);
    const still = (await projects(A, `&id=eq.${projectA.id}`)).json[0];
    assert.equal(still.name, 'A project');
    assert.equal(still.revision, 1);
  });

  test("B can't create a project owned by A", async () => {
    const r = await insertProject(B, { owner: A.id, name: 'forged', manifest: manifest(sha(partA)), bytes: 1 });
    assert.equal(r.status, 403, r.text);
    assert.equal((await projects(A)).json.length, 1);
  });

  test("B can't read, list, overwrite or delete A's parts", async () => {
    assert.ok((await download(B, nameA)).status >= 400);
    const l = await list(B, `${A.id}/`);
    assert.ok(l.status !== 200 || l.json.length === 0, l.text);
    const other = randomBytes(64);
    assert.ok((await upload(B, `${A.id}/${sha(other)}`, other)).status >= 400, 'upload into A');
    assert.ok((await upload(B, nameA, other, true)).status >= 400, 'overwrite A');
    const del = await remove(B, [nameA]);
    assert.ok(del.status !== 200 || del.json.length === 0, del.text);
    assert.equal((await download(A, nameA)).status, 200);
  });

  test("A's parts are immutable and must be named by their hash", async () => {
    assert.ok((await upload(A, nameA, randomBytes(256), true)).status >= 400, 'overwrite');
    assert.ok((await upload(A, `${A.id}/not-a-hash`, randomBytes(8))).status >= 400, 'bad name');
    assert.ok((await upload(A, `${A.id}/x/${sha(partA)}`, partA)).status >= 400, 'nested name');
  });

  test('the server keeps the owner, the dates and the revision', async () => {
    const p = await call(`/rest/v1/projects?id=eq.${projectA.id}`, {
      token: A.token,
      method: 'PATCH',
      body: { name: 'renamed' },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json[0].revision, 2);
    assert.equal(p.json[0].created_at, projectA.created_at);
    for (const body of [{ owner: B.id }, { revision: 1 }, { created_at: '2000-01-01T00:00:00Z' }]) {
      const r = await call(`/rest/v1/projects?id=eq.${projectA.id}`, { token: A.token, method: 'PATCH', body });
      assert.ok(r.status >= 400, `${JSON.stringify(body)}: ${r.status}`);
    }
    // A save that started from an old revision changes nothing.
    const stale = await call(`/rest/v1/projects?id=eq.${projectA.id}&revision=eq.1`, {
      token: A.token,
      method: 'PATCH',
      body: { name: 'stale' },
      headers: { Prefer: 'return=representation' },
    });
    assert.deepEqual(stale.json, []);
  });

  test('my_usage and my_unused_parts only see the caller', async () => {
    const ua = (await call('/rest/v1/rpc/my_usage', { token: A.token, method: 'POST', body: {} })).json[0];
    assert.equal(ua.used_bytes, partA.length);
    assert.equal(ua.projects, 1);
    const ub = (await call('/rest/v1/rpc/my_usage', { token: B.token, method: 'POST', body: {} })).json[0];
    assert.equal(ub.used_bytes, 0);
    assert.equal(ub.projects, 0);
    // A's part is in use and new: never offered for deletion.
    assert.deepEqual((await call('/rest/v1/rpc/my_unused_parts', { token: A.token, method: 'POST', body: {} })).json, []);
  });

  describe('limits', () => {
    after(() => sql('update vitryne_private.limits set quota_bytes = 1073741824, max_projects = 500'));

    test('a new part is refused once the quota is used', async () => {
      sql(`update vitryne_private.limits set quota_bytes = ${partA.length}`);
      const more = randomBytes(16);
      const r = await upload(A, `${A.id}/${sha(more)}`, more);
      assert.ok(r.status >= 400, r.text);
      // B has used nothing yet.
      const b = randomBytes(16);
      assert.equal((await upload(B, `${B.id}/${sha(b)}`, b)).status, 200);
    });

    test('a new project is refused at the project limit', async () => {
      sql('update vitryne_private.limits set max_projects = 1');
      const r = await insertProject(A, { name: 'second', manifest: manifest(sha(partA)), bytes: 1 });
      assert.ok(r.status >= 400, r.text);
      assert.match(r.text, /project limit/);
    });
  });

  describe('account deletion', () => {
    test('refused while parts remain, then removes the user and their projects', async () => {
      const early = await call('/rest/v1/rpc/delete_my_account', { token: A.token, method: 'POST', body: {} });
      assert.ok(early.status >= 400, early.text);
      assert.match(early.text, /parts/);
      const del = await remove(A, [nameA]);
      assert.equal(del.status, 200, del.text);
      const ok = await call('/rest/v1/rpc/delete_my_account', { token: A.token, method: 'POST', body: {} });
      assert.equal(ok.status, 204, ok.text);
      assert.equal(sql(`select count(*) from auth.users where id = '${A.id}'`), '0');
      assert.equal(sql(`select count(*) from public.projects where owner = '${A.id}'`), '0');
      assert.equal(sql(`select count(*) from storage.objects where name like '${A.id}/%'`), '0');
      // B is untouched.
      assert.equal(sql(`select count(*) from auth.users where id = '${B.id}'`), '1');
    });
  });
});
