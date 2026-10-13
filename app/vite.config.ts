// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Cross-origin isolation (docs/HOSTING.md): SharedArrayBuffer-ready, and performance.now() at
// its fine resolution (Chrome coarsens it to 100 µs otherwise), which the frame timings need.
// Production hosting must send the same two headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
});
