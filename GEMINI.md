# Vitryne

Open-source (AGPL-3.0-or-later) garment design in the browser: a GPU cloth solver (Rust, WGSL,
WebGPU, native and wasm) and a beginner-friendly editor (`packages/vitryne-web/`, early). See
[README.md](README.md) for what works today, [docs/PROGRESS.md](docs/PROGRESS.md) for milestones
with their numbers, [CONTRIBUTING.md](CONTRIBUTING.md) for build and check commands,
[Algorithms](packages/vitryne-docs/content/docs/developers/algorithms.md) for every solver component and its paper, and
[Architecture](packages/vitryne-docs/content/docs/developers/architecture.mdx) for how the editor is built and its guardrails.

## Patents: read before touching joins, placement, measuring or grading

CLO Virtual Fashion (a competitor, **not us**) holds and enforces patents on free-sewing UIs, 2D
pattern measuring and automatic grading, and has pending applications on automatic sewing-line
detection and ML placement. `packages/vitryne-docs/content/docs/developers/patents.md` lists those patents so we **avoid the designs they
claim**; its design rules are binding (e.g. seams are whole edges, not notch-to-notch
segments). Before designing or building any feature that joins pattern pieces, places pieces
around a body, measures a pattern, or resizes a garment, read
[Patent warnings](packages/vitryne-docs/content/docs/developers/patents.md) and follow its design rules. Do not add such features
without checking them against that file, and say so when a request conflicts with it.

## Where things are

`Makefile` is the entry point (`make` lists the targets); each package has a short README.

| Path | What |
| --- | --- |
| `packages/vitryne-engine/` | The Rust workspace (`Cargo.toml`, `Cargo.lock`, `target/`); cargo runs here, the `vitryne` binary from the repo root. |
| `packages/vitryne-engine/solver` | `vitryne-solver`: the solver and the public API. `engine.rs` is the entry point (`Engine`, `Body`, `Garment`, `GarmentDesc`, `Simulation`); `sim.rs` has `SimSettings` (every tunable) and `Solver`; `shaders/*.wgsl` are the solver's shaders (native and browser share them). Also: `bench.rs`, `dragbench.rs`, `regress.rs`, `strain.rs`, `longrange.rs`, `selfcol.rs`, `untangle.rs`, `body.rs` (BVH, SDF). |
| `packages/vitryne-engine/render` | `vitryne-render`: viewport rendering, out of the solver: `Renderer` (GPU normals, lit cloth and collider), `OrbitCamera`, `pick`/`drag_target` for cloth drags, the smoke-test triangle; its own `shaders/`. |
| `packages/vitryne-engine/format` | `vitryne-format`: the project file format (`.vtry` family): types, read/write (zip or folder), validation, migrations, unknown data kept. No engine dependency. |
| `packages/vitryne-engine/pattern` | `vitryne-pattern`: DXF-AAMA import and export (`aama.rs`, `aama_export.rs`), `garment.toml` sidecar, meshing, placement (`placement.rs`, regions from `assets/body/avatar.json`); `project.rs` turns a `.vtry` into a `GarmentDesc`, `convert.rs` a sidecar into a `.vtry`; `suggest.rs` + `seams.rs` are sewing in the editor (whole edges only, packages/vitryne-docs/content/docs/developers/patents.md); `drafting/` reads Valentina and Seamly2D patterns (formulas, measurements, drafting tools, pieces) for `import.rs`. Its `garment::Garment` is the DXF garment, not the engine's (`vitryne_solver::engine::Garment`); alias one of them on import. |
| `packages/vitryne-engine/cli` | `vitryne-cli`: the `vitryne` CLI and the winit viewer (`view`, `bench`, `bench-drag`, `regress`, `frames`, `convert`, `export-app-assets`, `export-bench-assets`, ...). Default paths are relative to the repo root. |
| `packages/vitryne-engine/wasm` | `vitryne-wasm`: the wasm build: the editor worker's API (`project.rs`: `VtryFile` open/validate/save, `PreparedScene`; `viewport.rs`: `Viewport` on an OffscreenCanvas) and the bench page's (`run_bench`, ...). |
| `packages/vitryne-engine/tests/` | Golden results for `vitryne regress`, and `skirt.vtry`: a skirt drawn with the editor's commands (`packages/vitryne-web/src/document/skirt.test.ts` makes it and fails if it differs). |
| `packages/vitryne-web/` | The editor (TypeScript, React, Tailwind + shadcn/ui, Vite) and `bench.html`. `src/routes/` (one screen per URL: `/`, `/design/$id`, `/example/$name`, `/new`), `src/editor/` (`layout/` the frame, which owns the engine and stays mounted across URLs; `hooks/`, `dialogs/`, `start/`, `viewport/`, `icons/`), `src/worker/` (protocol, worker, session with restarts), `src/document/` (the file's JSON, commands, store; tests), `src/format/*.gen.*` (generated from the schemas: `pnpm run gen:format`), `src/pattern/` (2D SVG; `panel/` the flat view, one hook per tool), `src/properties/`, `src/storage/` (files from disk, recovery copy), `src/cloud/` (backend config, autosave, one tab per project, content-addressed projects, dialogs), `src/bench/`. One component or hook per file (packages/vitryne-docs/content/docs/developers/architecture.mdx, Files). |
| `packages/vitryne-docs/` | The documentation website (Astro + Fumadocs UI as React islands, static): one sidebar in sections (`content/docs/meta.json`): an introduction, guides for people designing garments (`guide/`, `imports_exports/`), and `developers/` (the architecture, algorithms, cloud, fabrics, file format and patents pages: the one copy, edit them there; `contributing.md` is generated from the root `CONTRIBUTING.md`; plus `docker-stack.mdx`); search covers every page, the editor's colours and fonts in `src/styles/global.css`; `make docs-dev`, `make docs` (in `check-ci`). |
| `packages/vitryne-cloud/supabase/` | The backend schema and local stack: `migrations/` (projects, parts bucket, RLS, limits, anonymous drafts), `functions/clean-anonymous` (deletes stale anonymous users, daily via pg_cron), `templates/` (emails), `config.toml` (the Supabase CLI's `--workdir` is `packages/vitryne-cloud`). |
| `packages/vitryne-cloud/deploy/` | The web image and plug-and-go compose ([Cloud backend](packages/vitryne-docs/content/docs/developers/cloud.md)): `docker-compose.yml` (one `web` service, the release image `ghcr.io/h4kken/vitryne-web:${VITRYNE_VERSION:-latest}`, its backend from `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`, required), `docker-compose.build.yml` (override: build from the checkout), `web/` (Caddyfile, Dockerfile with `from-source`/`from-dist`, `entrypoint.sh` running migrations when `SUPABASE_DB_URL` is set, privacy page), `smoke.sh`. `deploy/.env` is git-ignored. |
| `packages/vitryne-cloud/dev/` | Everything in Docker for contributors (`make stack`, `make stack-test`, `make stack-down`): the editor built from the checkout (`deploy/web/Dockerfile` `from-source`) and a local Supabase with the CLI's images and settings; `gateway.Caddyfile` stands in for Kong (CORS, apikey as bearer), `db.sql` sets passwords and the cleanup's Vault secrets on first start. Supabase's public demo keys, ports on 127.0.0.1, the CLI stack's ports (one or the other). |
| `packages/vitryne-cloud/tests/` | Backend tests (RLS, accounts, cleanup, thumbnails) and `browser.mjs` (real Chrome). |
| `assets/` | Avatar (CC0 MakeHuman), three FreeSewing garments with their licences. `tools/patterns` re-drafts them (`./export-all.sh`; the T-shirt is at chest ease 18%, on purpose). |
| `assets/examples/` | The three sample projects in folder form (`tshirt.vtry/`, `trousers.vtry/`, `hoodie.vtry/`): `vitryne convert` output, regenerated by `make examples`. Don't edit them by hand; edit the sidecar or the converter. |
| `packages/vitryne-docs/content/docs/developers/file-format.md` (the File format page), `docs/format/schema/` | The project file format (`.vtry` family): spec with rationale, and a JSON Schema per part. `vitryne-format` implements it. |
| `.github/` | CI (`workflows/ci.yml`: `make check-ci` and the DCO check on every PR), releases (`workflows/release.yml`, on a `vX.Y.Z` tag: GHCR image + GitHub release), the shared toolchain setup (`actions/setup`), rulesets to import, templates, CODEOWNERS. How PRs are merged and releases made: [Maintaining](packages/vitryne-docs/content/docs/developers/maintaining.md); release notes come from [CHANGELOG.md](CHANGELOG.md). |
| `tools/` | `check/` (the Makefile's hygiene, examples and DCO steps), `release/notes.sh`, `bench/` (`run.sh` drape/drag matrices, native or Chrome, `summary.py`, `compare.py`, `strain.py`, `chrome-check.mjs`; output in `bench-out/`, git-ignored), `format/` (`build-examples.sh`, `validate.py`), `patterns/`. |

## Commands

Run `make` targets from the repo root; the Makefile puts `~/.cargo/bin` on the `PATH` (a plain
shell here doesn't have it: `export PATH="$HOME/.cargo/bin:$PATH"` before calling `cargo` or
`pnpm run dev` directly).

- `make check` is the gate (hygiene, rustfmt + prettier, clippy native + wasm32, tests, web
  build, examples, golden drapes, ~1.5 min, needs a GPU); `make check-quick` is Rust only;
  `make check-ci` is everything but the drapes, what CI runs (GitHub's runners have no GPU). Run
  `make check` before every milestone commit.
- User-visible changes get a line under Unreleased in `CHANGELOG.md`; a release is a version bump
  in `packages/vitryne-engine/Cargo.toml` + the changelog + a `vX.Y.Z` tag
  ([Maintaining](packages/vitryne-docs/content/docs/developers/maintaining.md#releasing)); the user tags and pushes.
- After an intended change to solver behaviour: `make regress-update`, and say why in the commit
  message. Compare builds with `tools/bench/compare.py <dir> <dir>`.
- Viewer: `make cli`, then `packages/vitryne-engine/target/release/vitryne view --garment
  assets/examples/trousers.vtry` from the repo root (the examples carry self-collision; a
  `garment.toml` needs `--self-collision --self-rebuild 4`). Editor: `make dev` (it starts the
  local Supabase stack, or uses the backend in `packages/vitryne-web/.env.local`) and open
  http://localhost:5173; `make dev-app` is the dev server alone, enough for `/bench.html`.
  `make test` runs the TypeScript gate after `cargo test` (needs `make wasm assets` once).
- Editor in a real browser: a headless browser without a GPU only shows the no-WebGPU page. Drive
  real Chrome over CDP like `tools/bench/chrome-check.mjs` does; use `Input.dispatch*` events
  (synthetic DOM events can't capture pointers). Kill every Chrome you launch when you're done,
  and remove its temp profile (they stack up otherwise): a script's `finally` kills it, and
  afterwards `pkill -f "MacOS/Google Chrome --headless=new --remote-debugging-port"`; never kill
  the person's own Chrome. Projects save to the backend: test against the
  local stack only (`make dev ARGS=--local`), never the hosted project
  `packages/vitryne-web/.env.local` names.
- Backend: `make dev ARGS=--local` (local Supabase stack: Studio on :54323, emails on :54324);
  `make cloud-test` (the web image's smoke test, then RLS, accounts, cleanup, thumbnails; Docker);
  `node packages/vitryne-cloud/tests/browser.mjs cloud|none <url>` (real Chrome). The Supabase
  CLI is pinned in `packages/vitryne-web/` (`pnpm run supabase …` there); the Homebrew one on
  this Mac has a broken signature.
- After changing the converter, the importer or a sidecar: `make examples` and commit
  `assets/examples/` (`make check` diffs them against `vitryne convert`).

## Rules (from the MVP plan, now done; where one conflicts with packages/vitryne-docs/content/docs/developers/patents.md, patents.md wins)

1. WebGPU core only: `Features::empty()`, `Limits::default()`, one set of WGSL; only the profiling
   mode may request `timestamp-query`.
2. Engine and UI stay separate; the UI uses the public API and the worker protocol only.
3. Never loosen a quality criterion to make it pass; a target change is its own commit with the
   reasoning in docs/PROGRESS.md.
4. Published methods only for the solver; cite them in `packages/vitryne-docs/content/docs/developers/algorithms.md` and where implemented.
5. Design our own editor interactions (see the patents note).
6. Every commit is signed off (`git commit -s`, identity `Mathis Grimberg
<mathis.grimberg@protonmail.com>`); end a milestone with a commit, docs/PROGRESS.md numbers, and a
   stop for review. Work on `feature/<name>` (or `fix/<name>`), not `main`; the user pushes and
   merges (admins bypass the ruleset; PRs are merged with a `Merge(#n)` commit, packages/vitryne-docs/content/docs/developers/maintaining.md).
7. Projects live in the backend, like Figma or Canva (changed in the MVP fixes, docs/PROGRESS.md): a
   backend is required, projects autosave there, nothing is saved to disk. Anyone can try the
   editor without an account (one draft); keeping more projects and exporting need a free
   account. Network calls only for the app, its assets and what the person does (save, open,
   sign in); never telemetry, and no identifier to count people (packages/vitryne-docs/content/docs/developers/cloud.md, Privacy).

## State and things that surprise

- **Done:** M0 to M16, all merged (details and numbers in docs/PROGRESS.md; the entries still
  say "waiting for review" for M7 to M16, the history of how they were reviewed): the solver, the
  engine API and regression goldens, the `.vtry` format, the editor (worker + OffscreenCanvas,
  document model with guardrails, 2D pattern panel, properties), import and placement, whole-edge
  sewing, fabric presets, glTF/OBJ export, cloud backend and self-hosting, DXF-AAMA export in the
  CLI (the editor's *Pattern (.dxf)* export is removed until seam allowance exists), pattern
  tools, Valentina and Seamly2D import. Since then, released as v0.1.0 to v0.4.0 (CHANGELOG.md):
  the docs website, dark mode, layers (format v4), right-click menus, copy/paste/flip, the
  email-first account dialog, legal pages and the project right-click menu on the start screen
  (#12). M1 was accepted on a qualitative check (no integrated-GPU or Firefox numbers); M2 only
  partly met its targets (see Known and accepted below). The MVP is done; ask the user what is
  next.
- **The extension is `.vtry`, not `.vitryne`** (`.vit` is taken by Seamly2D), with
  `.vtryg`/`.vtryf`/`.vtrya` for garment, fabric and avatar files.
- **The `.vtry` and `garment.toml` paths give bit-identical garments** (test
  `project_matches_sidecar`; `vitryne regress --toml` uses the same goldens). That relies on the
  DXF importer snapping to the format's 0.001 mm grid and the mesher's canonical triangle order;
  keep both.
- **The T-shirt's rest frame jumps under sub-micrometre input changes** (249/332/358/361 seen,
  shapes within 3 mm, docs/PROGRESS.md, Project file format: implementation). A rest-frame change after touching the mesher or importer
  isn't necessarily a solver regression.
- **The editor's document is the file's JSON; Rust validates every state** (`VtryFile.set_entities`
  in the worker). Range checks live in both the schemas (TS, before a command exists) and
  `vitryne-format/src/validate.rs` (Rust). Edits only through `document/commands.ts`; never
  mutate the entities (frozen in dev/tests).
- **Sidecars take `[engine]` overrides** (written to `garment.simulation.engine`); the examples
  set `self_collision` and `self_rebuild_every = 4`, the regression setting.
- **Known and accepted for now** (docs/PROGRESS.md, Fabric stretch and Engine API): trousers p99 edge strain 5.4% against a 3%
  woven target; the hoodie is a basic placeholder (never rests, ~145 persistent
  self-intersections, 20 mm shape tolerance in the golden suite); the 20k T-shirt drape takes
  3.5 s against 3 s. Don't spend time on the hoodie's accuracy.
- Defaults that matter (`SimSettings::default()`): 20 substeps, 3 stretch sweeps, stretch
  damping 1e-4 s (Rayleigh, `gamma = beta / h`), long-range limits on, strain limiting off.
  Configured as in the spike (`--stretch-iterations 1 --long-range 0 --long-range-cross 0`, damping
  `1e-5 * compliance / h^2`) the engine reproduces the spike's numbers (packages/vitryne-docs/content/docs/developers/algorithms.md).
- `Simulation` methods take `&self`; `encode_step` writes a frame into the caller's encoder,
  `step(n)` submits per frame (per-frame parameters are queue writes, which apply at submit).
- Garment SDF boxes are per garment (`garment.toml [sdf]`); the SDF bake takes seconds, so it is
  cached by `SdfParams::cache_key`: natively under `packages/vitryne-engine/target/sdf-cache/`,
  in the editor bundled for the examples (`packages/vitryne-web/public/sdf/`) or in the
  browser's OPFS; the bench page fetches `bench-assets/`.
- One solver iteration per substep is why strain grows with vertex count; long-range limits and
  extra sweeps are what carry load across a panel.
- Chrome and native agree to ~0.1 mm on the trousers and ~1 mm on the T-shirt, but the hoodie
  is chaotic (up to 11 mm); don't read cross-target hoodie differences as bugs.
