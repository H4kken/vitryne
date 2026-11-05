// SPDX-License-Identifier: AGPL-3.0-or-later
// Share links against a running Supabase with the schema (instance.mjs says which): a project is
// private until its owner (an account) shares it; then anyone, signed in or not, can fetch that one
// project and the parts it names, and nothing else; turning it off ends that at once.
//
//   node --test 'packages/vitryne-cloud/tests/*.test.mjs'          (the local stack: `pnpm run supabase start` in packages/vitryne-web/)

import { createHash, randomBytes } from 'node:crypto';
import { before, describe, test } from 'node:test';
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
const upload = (u, bytes) =>
  call(`/storage/v1/object/parts/${u.id}/${sha(bytes)}`, { token: u.token, method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
// `token` left out: the publishable key alone, like a visitor with no session.
const fetchPart = (token, owner, bytes) => call(`/storage/v1/object/authenticated/parts/${owner}/${sha(bytes)}`, { token });
const shared = (token, id) => call('/rest/v1/rpc/shared_project', { token, method: 'POST', body: { pid: id } });
const patch = (u, id, body) => call(`/rest/v1/projects?id=eq.${id}`, { token: u.token, method: 'PATCH', body, headers: { Prefer: 'return=representation' } });

describe('share links', () => {
  let A, B, project, named, other, thumb;

  before(async () => {
    A = await anonymousUser();
    B = await anonymousUser();
    // A is an account: only an account may share.
    sql(`update auth.users set is_anonymous = false, email = 'a-${A.id}@example.test' where id = '${A.id}'`);
    named = randomBytes(64);
    other = randomBytes(64);
    thumb = randomBytes(64);
    for (const part of [named, other, thumb]) assert.equal((await upload(A, part)).status, 200);
    const manifest = { parts: [{ path: 'project.json', mediaType: 'application/json', sha256: sha(named) }] };
    const ins = await call('/rest/v1/projects', { token: A.token, method: 'POST', body: { name: 'Shirt', manifest, bytes: named.length, thumbnail: sha(thumb) }, headers: { Prefer: 'return=representation' } });
    assert.equal(ins.status, 201, ins.text);
    project = ins.json[0];
  });

  test('a new project is private', async () => {
    assert.equal(project.shared, false);
    assert.deepEqual((await shared(undefined, project.id)).json, [], 'a visitor gets no row');
    assert.deepEqual((await shared(B.token, project.id)).json, [], 'nor does another user');
    assert.ok((await fetchPart(undefined, A.id, named)).status >= 400, 'nor its parts');
    assert.ok((await fetchPart(B.token, A.id, named)).status >= 400);
  });

  test('a new project cannot start shared', async () => {
    const manifest = { parts: [] };
    const ins = await call('/rest/v1/projects', { token: A.token, method: 'POST', body: { name: 'Sneaky', manifest, bytes: 0, shared: true }, headers: { Prefer: 'return=representation' } });
    assert.equal(ins.status, 201, ins.text);
    assert.equal(ins.json[0].shared, false);
  });

  test("nobody turns on another person's link", async () => {
    const r = await patch(B, project.id, { shared: true });
    assert.deepEqual(r.json, [], 'no row changed');
    assert.deepEqual((await shared(undefined, project.id)).json, []);
  });

  test('an anonymous user cannot share', async () => {
    const draft = await anonymousUser();
    const ins = await call('/rest/v1/projects', { token: draft.token, method: 'POST', body: { name: 'Draft', manifest: { parts: [] }, bytes: 0 }, headers: { Prefer: 'return=representation' } });
    assert.equal(ins.status, 201, ins.text);
    const r = await patch(draft, ins.json[0].id, { shared: true });
    assert.equal(r.status, 400, r.text);
    assert.deepEqual((await shared(undefined, ins.json[0].id)).json, []);
  });

  test('sharing keeps the revision and the clock', async () => {
    const before_ = (await call(`/rest/v1/projects?select=revision,updated_at&id=eq.${project.id}`, { token: A.token })).json[0];
    const r = await patch(A, project.id, { shared: true });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json[0].shared, true);
    assert.equal(r.json[0].revision, before_.revision);
    assert.equal(r.json[0].updated_at, before_.updated_at);
  });

  test('once shared, anyone gets the project and the parts it names, and nothing else', async () => {
    for (const token of [undefined, B.token]) {
      const row = (await shared(token, project.id)).json;
      assert.equal(row.length, 1);
      assert.equal(row[0].name, 'Shirt');
      assert.equal(row[0].owner, A.id);
      const got = await fetchPart(token, A.id, named);
      assert.equal(got.status, 200, got.text);
      assert.deepEqual(got.bytes, named);
      assert.equal((await fetchPart(token, A.id, thumb)).status, 200, 'the thumbnail too');
      assert.ok((await fetchPart(token, A.id, other)).status >= 400, 'a part no shared project names');
    }
  });

  test('sharing does not open the table, other projects or the list of parts', async () => {
    const rows = await call('/rest/v1/projects?select=id', { token: B.token });
    assert.deepEqual(rows.json, [], "B's own list does not show A's shared project");
    assert.ok([401, 403].includes((await call('/rest/v1/projects?select=id')).status), 'a visitor reads no table');
    const ls = await call('/storage/v1/object/list/parts', { method: 'POST', body: { prefix: A.id, limit: 100 } });
    const names = Array.isArray(ls.json) ? ls.json.map((o) => o.name) : [];
    assert.ok(!names.includes(sha(other)), 'an unnamed part is not listed');
  });

  test('a visitor cannot write', async () => {
    assert.ok([401, 403].includes((await patch({ token: undefined }, project.id, { name: 'x' })).status));
    const bytes = randomBytes(16);
    const up = await call(`/storage/v1/object/parts/${A.id}/${sha(bytes)}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
    assert.ok(up.status >= 400);
    const del = await call('/storage/v1/object/parts', { token: B.token, method: 'DELETE', body: { prefixes: [`${A.id}/${sha(named)}`] } });
    assert.equal((await fetchPart(undefined, A.id, named)).status, 200, `still there after ${del.status}`);
  });

  test('turning it off ends it at once', async () => {
    assert.equal((await patch(A, project.id, { shared: false })).status, 200);
    assert.deepEqual((await shared(undefined, project.id)).json, []);
    assert.ok((await fetchPart(undefined, A.id, named)).status >= 400);
    assert.ok((await fetchPart(B.token, A.id, thumb)).status >= 400);
  });
});
