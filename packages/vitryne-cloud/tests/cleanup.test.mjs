// SPDX-License-Identifier: AGPL-3.0-or-later
// The `clean-anonymous` Edge Function (packages/vitryne-cloud/supabase/functions/), against a running Supabase with Edge
// Functions on (the local stack has them): an anonymous user idle for longer than
// `anonymous_days` goes with their draft and parts; a recent anonymous user and an idle account
// stay; without the secret nothing happens. The dates are faked in SQL (instance.mjs).
//
//   node --test 'packages/vitryne-cloud/tests/*.test.mjs'   (the local stack: `pnpm run supabase start` in packages/vitryne-web/)

import { createHash, randomBytes } from 'node:crypto';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEANUP_SECRET, FUNCTIONS, KEY, sql, URL_ } from './instance.mjs';

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const h = { apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers };
  let b = body;
  if (body !== undefined && !(body instanceof Uint8Array)) {
    h['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  }
  const r = await fetch(URL_ + path, { method, headers: h, body: b });
  const text = await r.text();
  return { status: r.status, text };
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** An anonymous user with a draft and one part. */
async function withDraft() {
  const s = await call('/auth/v1/signup', { method: 'POST', body: {} });
  assert.equal(s.status, 200, s.text);
  const { access_token: token, user } = JSON.parse(s.text);
  const part = randomBytes(64);
  const up = await call(`/storage/v1/object/parts/${user.id}/${sha(part)}`, {
    token,
    method: 'POST',
    body: part,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  assert.equal(up.status, 200, up.text);
  const manifest = { parts: [{ path: 'project.json', mediaType: 'application/json', sha256: sha(part) }] };
  const ins = await call('/rest/v1/projects', { token, method: 'POST', body: { name: 'Draft', manifest, bytes: part.length } });
  assert.equal(ins.status, 201, ins.text);
  return user.id;
}

/** Every date that counts as activity, `days` ago (triggers off, or the project's would reset). */
function idle(id, days) {
  const t = `now() - interval '${days} days'`;
  sql(
    `set session_replication_role = replica;
     update auth.users set created_at = ${t}, updated_at = ${t}, last_sign_in_at = ${t} where id = '${id}';
     update auth.sessions set created_at = ${t}, updated_at = ${t}, refreshed_at = (${t}) at time zone 'UTC' where user_id = '${id}';
     update public.projects set created_at = ${t}, updated_at = ${t} where owner = '${id}';`,
    'supabase_admin',
  );
}

const users = (id) => sql(`select count(*) from auth.users where id = '${id}'`);
const projects = (id) => sql(`select count(*) from public.projects where owner = '${id}'`);
const parts = (id) => sql(`select count(*) from storage.objects where bucket_id = 'parts' and name like '${id}/%'`);
const clean = (secret) => fetch(`${FUNCTIONS}/clean-anonymous`, { method: 'POST', headers: secret ? { 'x-cleanup-secret': secret } : {} });

describe('clean-anonymous', () => {
  let stale, recent, account;

  before(async () => {
    [stale, recent, account] = await Promise.all([withDraft(), withDraft(), withDraft()]);
    idle(stale, 31);
    idle(recent, 29);
    idle(account, 31);
    sql(`update auth.users set is_anonymous = false, email = 'idle-${account}@example.test' where id = '${account}'`);
  });

  test('refuses a call without the secret', async () => {
    assert.equal((await clean(null)).status, 403);
    assert.equal((await clean('wrong')).status, 403);
    assert.equal(users(stale), '1');
  });

  test('deletes the idle anonymous user, their draft and parts; keeps the others', async () => {
    const r = await clean(CLEANUP_SECRET);
    const text = await r.text();
    assert.equal(r.status, 200, text);
    assert.deepEqual(JSON.parse(text).failed, []);
    assert.deepEqual([users(stale), projects(stale), parts(stale)], ['0', '0', '0']);
    for (const id of [recent, account]) assert.deepEqual([users(id), projects(id), parts(id)], ['1', '1', '1']);
  });
});
