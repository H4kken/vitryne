// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Cross-origin isolation (docs/HOSTING.md): performance.now() at its fine resolution (Chrome
// coarsens it to 100 µs otherwise), which the frame timings and the bench need, and
// SharedArrayBuffer for later. Production hosting must send the same two headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Dev only: bench.html?post=1&name=X POSTs its JSON here, saved to bench-out/browser-check/X.json
// (or bench-out/<dir>/X.json with &dir=). Lets a browser we can't automate (Safari without
// remote automation) hand results back.
const benchSink: Plugin = {
  name: 'bench-sink',
  configureServer(server) {
    server.middlewares.use('/__bench-result', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const name = (url.searchParams.get('name') || 'unnamed').replace(/[^a-z0-9_.-]/gi, '');
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        const dir = resolve(import.meta.dirname, '../bench-out', (url.searchParams.get('dir') || 'browser-check').replace(/[^a-z0-9_-]/gi, ''));
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${name}.json`), body);
        res.end('ok');
      });
    });
  },
};

// TUNNEL=1 pnpm run dev: serve through a Cloudflare quick tunnel (https://*.trycloudflare.com) so
// another machine can run the bench with WebGPU (it needs https or localhost). Hot reload is off
// then, because its websocket doesn't go through the tunnel.
const tunnel = process.env.TUNNEL === '1';

export default defineConfig({
  plugins: [react(), tailwindcss(), benchSink],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { headers: isolation, ...(tunnel ? { allowedHosts: ['.trycloudflare.com'], hmr: false } : {}) },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), bench: resolve(import.meta.dirname, 'bench.html') },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The property tests run the real Rust validation (pkg-node) many times.
    testTimeout: 120_000,
  },
});
