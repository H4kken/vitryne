// SPDX-License-Identifier: AGPL-3.0-or-later
// Which Supabase the cloud tests run against: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and MAILPIT_URL
// from the environment, else the local stack (`supabase status`, started with
// `pnpm run supabase start` in packages/vitryne-web/). `sql()` changes the limits for a moment; it needs the local
// stack's database container (or SUPABASE_DB_CONTAINER). `sql(q, 'supabase_admin')` runs as the
// superuser, for what the tests fake (dates, with triggers off).
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../../..');

function local() {
  const out = execFileSync(resolve(root, 'packages/vitryne-web/node_modules/.bin/supabase'), ['status', '-o', 'json', '--workdir', resolve(root, 'packages/vitryne-cloud')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

const s = process.env.SUPABASE_URL ? null : local();
export const URL_ = (process.env.SUPABASE_URL ?? s.API_URL).replace(/\/$/, '');
// The publishable key goes in the apikey header only (it isn't a JWT); a user's token goes in
// Authorization.
export const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? s.PUBLISHABLE_KEY;
export const MAILPIT = process.env.MAILPIT_URL ?? s?.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_vitryne';

export const FUNCTIONS = `${URL_}/functions/v1`;
/** The local stack's (packages/vitryne-cloud/supabase/config.toml); another instance's from the environment. */
export const CLEANUP_SECRET = process.env.CLEANUP_SECRET ?? 'local-cleanup-secret';

export function sql(q, user = 'postgres') {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', user, '-d', 'postgres', '-tAc', q], { encoding: 'utf8' }).trim();
}
