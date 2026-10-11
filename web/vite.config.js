import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Cross-origin isolation gives performance.now() its fine resolution (Chrome coarsens it to
// 100 µs otherwise), which matters for per-frame timing in the bench.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Dev only: bench.html?post=1&name=X POSTs its JSON here, saved to bench/browser-check/X.json.
// Lets a browser we can't automate (Safari without remote automation) hand results back.
const benchSink = {
  name: 'bench-sink',
  configureServer(server) {
    server.middlewares.use('/__bench-result', (req, res) => {
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'unnamed').replace(/[^a-z0-9_-]/gi, '');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const dir = resolve(import.meta.dirname, '../bench/browser-check');
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `${name}.json`), body);
        res.end('ok');
      });
    });
  },
};

export default defineConfig({
  plugins: [benchSink],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), bench: resolve(import.meta.dirname, 'bench.html') },
    },
  },
});
