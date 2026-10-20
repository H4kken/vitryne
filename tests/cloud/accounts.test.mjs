// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts, against a running Supabase whose email goes to Mailpit (the local stack's does; see
// instance.mjs): a project saved by an anonymous user is still theirs after they create an
// account (email and password, confirmed by the link emailed); a fresh session signs in with the
// password and sees it; a wrong password and an email already taken are refused; a forgotten
// password is reset by a link. The browser half is browser.mjs.
//
//   node --test 'tests/cloud/*.test.mjs'   (the local stack: `pnpm run supabase start` in app/)

import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY, MAILPIT, URL_ } from './instance.mjs';

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(URL_ + path, {
    method,
    headers: { apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null, text };
}

/** The newest email to `to` sent after `after` (Mailpit's JSON), waiting for it to arrive. */
async function mailFor(to, after) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const m = s.messages?.find((x) => Date.parse(x.Created) >= after);
    if (m) return await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no email to ${to}`);
}

/** The link in that email to Auth's verify endpoint. */
async function linkFor(to, after) {
  const full = await mailFor(to, after);
  const link = /https?:\/\/[^\s"<>()]+\/auth\/v1\/verify\?[^\s"<>()]+/.exec(full.HTML ?? full.Text)?.[0];
  assert.ok(link, `no link in: ${full.Text}`);
  return link.replace(/&amp;/g, '&');
}

const anonymous = async () => {
  const r = await call('/auth/v1/signup', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  return r.json;
};
const signIn = (email, password) => call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });

test('an anonymous user becomes an account with the same projects, and signs in elsewhere with a password', async () => {
  const anon = await anonymous();
  assert.equal(anon.user.is_anonymous, true);
  const ins = await call('/rest/v1/projects', {
    token: anon.access_token,
    method: 'POST',
    body: { name: 'Saved anonymously', manifest: { parts: [] }, bytes: 0 },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(ins.status, 201, ins.text);

  // Create the account: the email and the password at once; not an account until the link
  // emailed is opened, then the same user, which the page that asked sees with its own session.
  const email = `test-${randomBytes(4).toString('hex')}@example.test`;
  const password = `pw-${randomBytes(6).toString('hex')}`;
  let t = Date.now() - 1000;
  const upd = await call('/auth/v1/user', { token: anon.access_token, method: 'PUT', body: { email, password } });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(upd.json.is_anonymous, true);
  assert.equal((await signIn(email, password)).status, 400);
  const v = await fetch(await linkFor(email, t), { redirect: 'manual' });
  assert.equal(v.status, 303);
  assert.ok(!/error/.test(v.headers.get('location')), v.headers.get('location'));
  const me = await call('/auth/v1/user', { token: anon.access_token });
  assert.equal(me.json.id, anon.user.id);
  assert.equal(me.json.is_anonymous, false);
  const fresh = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: anon.refresh_token } });
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.json.user.is_anonymous, false);

  // Another browser: email and password.
  const s = await signIn(email, password);
  assert.equal(s.status, 200, s.text);
  assert.equal(s.json.user.id, anon.user.id);
  const list = await call('/rest/v1/projects?select=name', { token: s.json.access_token });
  assert.deepEqual(list.json, [{ name: 'Saved anonymously' }]);

  // A wrong password is refused; so is the same email for another user.
  const wrong = await signIn(email, 'not-the-password');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error_code ?? wrong.json.code, 'invalid_credentials');
  const other = await anonymous();
  const taken = await call('/auth/v1/user', { token: other.access_token, method: 'PUT', body: { email } });
  assert.ok(taken.status >= 400, taken.text);
  assert.equal(taken.json.error_code ?? taken.json.code, 'email_exists');

  // Forgotten password: a link (no PKCE, like the editor's) that brings a session back in the URL,
  // then a new password.
  t = Date.now() - 1000;
  const rec = await call('/auth/v1/recover', { method: 'POST', body: { email } });
  assert.equal(rec.status, 200, rec.text);
  const rv = await fetch(await linkFor(email, t), { redirect: 'manual' });
  assert.equal(rv.status, 303);
  const back = new URLSearchParams(new URL(rv.headers.get('location')).hash.slice(1));
  assert.equal(back.get('type'), 'recovery', rv.headers.get('location'));
  const newPassword = `pw-${randomBytes(6).toString('hex')}`;
  assert.equal((await call('/auth/v1/user', { token: back.get('access_token'), method: 'PUT', body: { password: newPassword } })).status, 200);
  assert.equal((await signIn(email, password)).status, 400);
  const again = await signIn(email, newPassword);
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.user.id, anon.user.id);

  // Clean up.
  for (const token of [again.json.access_token, other.access_token]) {
    const del = await call('/rest/v1/rpc/delete_my_account', { token, method: 'POST', body: {} });
    assert.equal(del.status, 204, del.text);
  }
});

test('passwords shorter than 8 characters are refused', async () => {
  const anon = await anonymous();
  const r = await call('/auth/v1/user', { token: anon.access_token, method: 'PUT', body: { password: 'short1' } });
  assert.ok(r.status >= 400, r.text);
  await call('/rest/v1/rpc/delete_my_account', { token: anon.access_token, method: 'POST', body: {} });
});
