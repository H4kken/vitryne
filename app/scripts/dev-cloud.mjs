// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm run dev:cloud`: the editor in cloud mode against the local Supabase stack (docs/CLOUD.md).
// Starts the stack if it isn't running (Docker; the first start downloads ~4 GB), then the dev
// server with its URL and anon key. Studio: http://127.0.0.1:54323, emails: http://127.0.0.1:54324.
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const app = resolve(import.meta.dirname, '..');
const cli = resolve(app, 'node_modules/.bin/supabase');
const workdir = ['--workdir', resolve(app, '..')];

function status() {
  try {
    const out = execFileSync(cli, ['status', '-o', 'json', ...workdir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

let s = status();
if (!s?.API_URL) {
  console.log('dev:cloud: starting the local Supabase stack…');
  // Services the editor doesn't use stay off (Realtime, Edge Functions and analytics are off in
  // supabase/config.toml).
  execFileSync(cli, ['start', ...workdir, '-x', 'imgproxy,supavisor,vector,logflare'], { stdio: 'inherit' });
  s = status();
}
console.log(`dev:cloud: backend ${s.API_URL} · Studio ${s.STUDIO_URL} · emails ${s.MAILPIT_URL ?? s.INBUCKET_URL}`);
const dev = spawn('pnpm', ['run', 'dev'], { cwd: app, stdio: 'inherit', env: { ...process.env, SUPABASE_URL: s.API_URL, SUPABASE_PUBLISHABLE_KEY: s.PUBLISHABLE_KEY } });
dev.on('exit', (code) => process.exit(code ?? 0));
