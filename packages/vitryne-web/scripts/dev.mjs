// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm run dev`: the editor against its backend (docs/CLOUD.md). With SUPABASE_URL and
// SUPABASE_PUBLISHABLE_KEY (the environment or packages/vitryne-web/.env.local) that one; otherwise, or with
// `--local` (tests: never a real project), the local Supabase stack, started if it isn't running (Docker; the first start downloads ~4 GB). Then the
// dev server (`pnpm run dev:app`, which alone serves the bench page and no backend). Studio:
// http://127.0.0.1:54323, emails: http://127.0.0.1:54324.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(import.meta.dirname, "..");
const cli = resolve(app, "node_modules/.bin/supabase");
const workdir = ["--workdir", resolve(app, "../vitryne-cloud")];

function status() {
  try {
    const out = execFileSync(cli, ["status", "-o", "json", ...workdir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

/** A backend named in the environment or packages/vitryne-web/.env.local (vite.config.ts serves it). */
function named() {
  if (process.env.SUPABASE_URL) return true;
  const local = resolve(app, ".env.local");
  return (
    existsSync(local) &&
    /^\s*SUPABASE_URL\s*=\s*\S/m.test(readFileSync(local, "utf8"))
  );
}

let env = process.env;
if (process.argv.includes("--local") || !named()) {
  let s = status();
  if (!s?.API_URL) {
    console.log("dev: starting the local Supabase stack…");
    // Services the editor doesn't use stay off (Realtime and analytics are off in
    // packages/vitryne-cloud/supabase/config.toml; Edge Functions are on, for the cleanup of stale anonymous users).
    execFileSync(
      cli,
      ["start", ...workdir, "-x", "imgproxy,supavisor,vector,logflare"],
      { stdio: "inherit" },
    );
    s = status();
  }
  console.log(
    `dev: backend ${s.API_URL} · Studio ${s.STUDIO_URL} · emails ${s.MAILPIT_URL ?? s.INBUCKET_URL}`,
  );
  env = {
    ...process.env,
    SUPABASE_URL: s.API_URL,
    SUPABASE_PUBLISHABLE_KEY: s.PUBLISHABLE_KEY,
  };
}
// The environment wins over packages/vitryne-web/.env.local (vite.config.ts).
const dev = spawn("pnpm", ["run", "dev:app"], {
  cwd: app,
  stdio: "inherit",
  env,
});
dev.on("exit", (code) => process.exit(code ?? 0));
