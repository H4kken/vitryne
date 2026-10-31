// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Cross-origin isolation (packages/vitryne-docs/content/docs/self-hosting/static-hosting.mdx): performance.now() at its fine resolution (Chrome
// coarsens it to 100 µs otherwise), which the frame timings and the bench need, and
// SharedArrayBuffer for later. Production hosting must send the same two headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Dev only: bench.html?post=1&name=X POSTs its JSON here, saved to bench-out/browser-check/X.json
// (or bench-out/<dir>/X.json with &dir=). Lets a browser we can't automate (Safari without
// remote automation) hand results back.
const benchSink: Plugin = {
  name: "bench-sink",
  configureServer(server) {
    server.middlewares.use("/__bench-result", (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const name = (url.searchParams.get("name") || "unnamed").replace(
        /[^a-z0-9_.-]/gi,
        "",
      );
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const dir = resolve(
          import.meta.dirname,
          "../../bench-out",
          (url.searchParams.get("dir") || "browser-check").replace(
            /[^a-z0-9_-]/gi,
            "",
          ),
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${name}.json`), body);
        res.end("ok");
      });
    });
  },
};

// The backend in development (packages/vitryne-docs/content/docs/developers/cloud.md): SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (and, if
// set, PRIVACY_POLICY_URL and TERMS_URL for the help menu's links), from the environment (`pnpm run dev` sets them for the local stack) or packages/vitryne-web/.env.local, are served as
// /config.json, like the web image does in production. Never in a build: dist/ has no
// config.json.
const cloudDev: Plugin = {
  name: "cloud-dev",
  configureServer(server) {
    const file = loadEnv(
      server.config.mode,
      server.config.envDir || import.meta.dirname,
      ["SUPABASE_", "PRIVACY_POLICY_", "TERMS_"],
    );
    const url = process.env.SUPABASE_URL || file.SUPABASE_URL;
    const publishableKey =
      process.env.SUPABASE_PUBLISHABLE_KEY || file.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) {
      server.config.logger.info(
        "  backend: none (the bench page works; the editor says it has no backend). Run pnpm run dev, or set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in packages/vitryne-web/.env.local",
      );
      return;
    }
    const privacyPolicy =
      process.env.PRIVACY_POLICY_URL || file.PRIVACY_POLICY_URL || null;
    const termsOfService = process.env.TERMS_URL || file.TERMS_URL || null;
    server.config.logger.info(`  backend: ${url}`);
    server.middlewares.use("/config.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          backend: { url, publishableKey },
          privacyPolicy,
          termsOfService,
        }),
      );
    });
  },
};

// TUNNEL=1 pnpm run dev: serve through a Cloudflare quick tunnel (https://*.trycloudflare.com) so
// another machine can run the bench with WebGPU (it needs https or localhost). Hot reload is off
// then, because its websocket doesn't go through the tunnel.
const tunnel = process.env.TUNNEL === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), benchSink, cloudDev],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: {
    headers: isolation,
    ...(tunnel ? { allowedHosts: [".trycloudflare.com"], hmr: false } : {}),
  },
  preview: { headers: isolation },
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        bench: resolve(import.meta.dirname, "bench.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The property tests run the real Rust validation (pkg-node) many times.
    testTimeout: 120_000,
  },
});
