// SPDX-License-Identifier: AGPL-3.0-or-later
// Project thumbnails (supabase/migrations/20261016000000_thumbnails.sql), against a running
// Supabase with the schema (instance.mjs says which): naming a thumbnail isn't an edit (the
// revision and the clock stay), only a sha256 is accepted, nobody names another person's, and
// a part named as a thumbnail isn't collected as unused.
//
//   node --test 'tests/cloud/*.test.mjs'          (the local stack: `pnpm run supabase start` in app/)

import { createHash, randomBytes } from 'node:crypto';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, sql, URL_ } from './instance.mjs';

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const h = { apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) {
    h['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  }
  const r = await fetch(URL_ + path, { method, headers: h, body: b });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: r.status, json, text };
}

async function anonymousUser() {
  const r = await call('/auth/v1/signup', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  return { token: r.json.access_token, id: r.json.user.id };
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
const upload = (u, bytes) =>
  call(`/storage/v1/object/parts/${u.id}/${sha(bytes)}`, { token: u.token, method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
const row = async (u, id) => (await call(`/rest/v1/projects?select=revision,updated_at,thumbnail&id=eq.${id}`, { token: u.token })).json[0];
const patch = (u, id, body) => call(`/rest/v1/projects?id=eq.${id}`, { token: u.token, method: 'PATCH', body, headers: { Prefer: 'return=representation' } });

describe('thumbnails', () => {
  let A, B, project, image;

  before(async () => {
    A = await anonymousUser();
    B = await anonymousUser();
    const part = randomBytes(64);
    assert.equal((await upload(A, part)).status, 200);
    const manifest = { parts: [{ path: 'project.json', mediaType: 'application/json', sha256: sha(part) }] };
    const ins = await call('/rest/v1/projects', { token: A.token, method: 'POST', body: { name: 'Draft', manifest, bytes: part.length }, headers: { Prefer: 'return=representation' } });
    assert.equal(ins.status, 201, ins.text);
    project = ins.json[0];
    image = randomBytes(128);
    assert.equal((await upload(A, image)).status, 200);
  });

  test('naming a thumbnail keeps the revision and the clock', async () => {
    const before_ = await row(A, project.id);
    const r = await patch(A, project.id, { thumbnail: sha(image) });
    assert.equal(r.status, 200, r.text);
    const after_ = await row(A, project.id);
    assert.equal(after_.thumbnail, sha(image));
    assert.equal(after_.revision, before_.revision);
    assert.equal(after_.updated_at, before_.updated_at);
  });

  test('a real edit still counts', async () => {
    const before_ = await row(A, project.id);
    assert.equal((await patch(A, project.id, { name: 'Renamed' })).status, 200);
    const after_ = await row(A, project.id);
    assert.equal(after_.revision, before_.revision + 1);
    assert.notEqual(after_.updated_at, before_.updated_at);
    assert.equal(after_.thumbnail, sha(image), 'the thumbnail stays');
  });

  test('only a sha256 is accepted', async () => {
    const r = await patch(A, project.id, { thumbnail: '../someone-else/x' });
    assert.equal(r.status, 400, r.text);
  });

  test("nobody names another person's thumbnail", async () => {
    const r = await patch(B, project.id, { thumbnail: sha(randomBytes(8)) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, [], 'no row changed');
    assert.equal((await row(A, project.id)).thumbnail, sha(image));
  });

  test('a thumbnail part is used; it is unused once replaced', async () => {
    // Parts younger than a day are never unused (a save may be under way): make them older.
    const older = () =>
      sql(`set session_replication_role = replica; update storage.objects set created_at = now() - interval '2 days' where name like '${A.id}/%';`, 'supabase_admin');
    older();
    const unused = async () => (await call('/rest/v1/rpc/my_unused_parts', { token: A.token, method: 'POST', body: {} })).json;
    assert.deepEqual(await unused(), []);
    const next = randomBytes(128);
    assert.equal((await upload(A, next)).status, 200);
    assert.equal((await patch(A, project.id, { thumbnail: sha(next) })).status, 200);
    older();
    assert.deepEqual(await unused(), [`${A.id}/${sha(image)}`]);
  });
});
