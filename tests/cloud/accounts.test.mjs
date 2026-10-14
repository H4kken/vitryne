// SPDX-License-Identifier: AGPL-3.0-or-later
// Accounts, against a running Supabase whose email goes to Mailpit (the local stack's does; see
// instance.mjs): a project saved by an anonymous user is still theirs after they create an
// account (email confirmed by a code, then a password); a fresh session signs in with the
// password and sees it; a wrong password and an email already taken are refused; a forgotten
// password is reset with a code. The browser half is browser.mjs.
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

/** The 6-digit code in the newest email to `to` sent after `after`, waiting for it to arrive. */
async function codeFor(to, after) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const m = s.messages?.find((x) => Date.parse(x.Created) >= after);
    if (m) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(full.Text ?? full.HTML)?.[1];
      assert.ok(code, `no code in: ${full.Text}`);
      return code;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no email to ${to}`);
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

  // Create the account: the email, confirmed by a code sent to it, then the password.
  const email = `test-${randomBytes(4).toString('hex')}@example.test`;
  const password = `pw-${randomBytes(6).toString('hex')}`;
  let t = Date.now() - 1000;
  const upd = await call('/auth/v1/user', { token: anon.access_token, method: 'PUT', body: { email } });
  assert.equal(upd.status, 200, upd.text);
  const v = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email_change', email, token: await codeFor(email, t) } });
  assert.equal(v.status, 200, v.text);
  assert.equal(v.json.user.id, anon.user.id);
  assert.equal(v.json.user.is_anonymous, false);
  const pw = await call('/auth/v1/user', { token: v.json.access_token, method: 'PUT', body: { password } });
  assert.equal(pw.status, 200, pw.text);

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

  // Forgotten password: a code, then a new password.
  t = Date.now() - 1000;
  const rec = await call('/auth/v1/recover', { method: 'POST', body: { email } });
  assert.equal(rec.status, 200, rec.text);
  const rv = await call('/auth/v1/verify', { method: 'POST', body: { type: 'recovery', email, token: await codeFor(email, t) } });
  assert.equal(rv.status, 200, rv.text);
  const newPassword = `pw-${randomBytes(6).toString('hex')}`;
  assert.equal((await call('/auth/v1/user', { token: rv.json.access_token, method: 'PUT', body: { password: newPassword } })).status, 200);
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
