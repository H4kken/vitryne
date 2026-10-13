# Hosting the editor

`cd app && pnpm run build` writes a static site to `app/dist/`: no server code, nothing to run.
Any static host can serve it, as long as it sends two headers on every response.

## The two headers

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They make the page *cross-origin isolated*: browsers then give `performance.now()` its full
resolution (Chrome coarsens it to 100 µs otherwise; the frame timings and the bench need it),
and they allow `SharedArrayBuffer`, which a multi-threaded engine build will need. The cost:
the page can't embed resources from other origins that don't opt in. Vitryne loads nothing from
other origins.

Check with the browser console: `self.crossOriginIsolated` must be `true`. The bench page
(`/bench.html`) also says so when it is not.

## Other requirements

- **HTTPS** (or `localhost`): WebGPU and the File System Access API only work in secure
  contexts.
- **`.wasm` served as `application/wasm`** (most servers already do).
- **Compression:** the bundled body SDFs (`/sdf/*.bin`, 30 to 50 MB each) shrink to about a
  third with gzip or Brotli. Enable it for `application/octet-stream` too, or precompress them.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name vitryne.example;
    root /srv/vitryne/dist;

    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    types { application/wasm wasm; }
    gzip on;
    gzip_types application/octet-stream application/wasm application/javascript text/css application/json;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Caddy

```caddy
vitryne.example {
    root * /srv/vitryne/dist
    header Cross-Origin-Opener-Policy "same-origin"
    header Cross-Origin-Embedder-Policy "require-corp"
    encode zstd gzip
    file_server
}
```

## Static hosts

- **Netlify, Cloudflare Pages:** a `_headers` file in `app/public/` (copied into `dist/`):

  ```
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
  ```

- **Vercel:** in `vercel.json`, `"headers": [{ "source": "/(.*)", "headers": [{ "key":
  "Cross-Origin-Opener-Policy", "value": "same-origin" }, { "key":
  "Cross-Origin-Embedder-Policy", "value": "require-corp" }] }]`.
- **GitHub Pages** can't set headers, so the editor doesn't run there as is.
