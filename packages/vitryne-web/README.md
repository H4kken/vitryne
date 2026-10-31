# vitryne-web

The Vitryne editor in the browser (TypeScript, React, Tailwind + shadcn/ui, Vite), and the
engine's benchmark page (`bench.html`). The engine runs in a Web Worker as wasm (`pkg/`, built
from [vitryne-engine](../vitryne-engine/)'s `vitryne-wasm`) and draws into an OffscreenCanvas;
projects save to the backend in [vitryne-cloud](../vitryne-cloud/).

How it is built, its guardrails and where things are: [Architecture](../vitryne-docs/content/docs/developers/architecture.mdx).

## Build and run

From the repository root:

```sh
make setup      # first run: pnpm install, the wasm, the examples and their SDFs
make dev        # the editor at http://localhost:5173 with its backend (ARGS=--local: the local Supabase stack)
make dev-app    # the dev server alone, no backend: enough for /bench.html
make build      # production build in packages/vitryne-web/dist
make test       # cargo test, then this package's check: format types, tsc, eslint, vitest
```

The same scripts run from this folder with pnpm (`pnpm run dev`, `pnpm run check`, ...; see
`package.json`). After changing `docs/format/schema/`, run `pnpm run gen:format`. The app needs
cross-origin isolation: [Static hosting](../vitryne-docs/content/docs/self-hosting/static-hosting.mdx) has the two headers.

A backend other than the local stack goes in `.env.local` here (`SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`; git-ignored). Test against the local stack only.

## Who to ask

Mathis Grimberg, the maintainer; open an issue on [GitHub](https://github.com/H4kken/vitryne/issues).
