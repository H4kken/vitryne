# Vitryne

Open-source (AGPL-3.0-or-later) garment design in the browser: a GPU cloth solver (Rust, WGSL,
WebGPU, native and wasm) and a beginner-friendly editor (`packages/vitryne-web/`, early). See
[README.md](README.md) for what works today, [docs/PROGRESS.md](docs/PROGRESS.md) for milestones
with their numbers, [CONTRIBUTING.md](CONTRIBUTING.md) for build and check commands,
[docs/ALGORITHMS.md](docs/ALGORITHMS.md) for every solver component and its paper, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the editor is built and its guardrails.

## Patents: read before touching joins, placement, measuring or grading

CLO Virtual Fashion (a competitor, **not us**) holds and enforces patents on free-sewing UIs, 2D
pattern measuring and automatic grading, and has pending applications on automatic sewing-line
detection and ML placement. `docs/PATENTS.md` lists those patents so we **avoid the designs they
claim**; its design rules are binding and **override `VITRYNE_MVP_PLAN.md`** where they differ
(e.g. seams are whole edges, not notch-to-notch segments). Before designing or building any feature that joins pattern pieces, places pieces
around a body, measures a pattern, or resizes a garment, read
[docs/PATENTS.md](docs/PATENTS.md) and follow its design rules. Do not add such features
without checking them against that file, and say so when a request or the plan conflicts with it.

## Where things are

`Makefile` is the entry point (`make` lists the targets); each package has a short README.

| Path | What |
| --- | --- |
| `packages/vitryne-engine/` | The Rust workspace (`Cargo.toml`, `Cargo.lock`, `target/`); cargo runs here, the `vitryne` binary from the repo root. |
| `packages/vitryne-engine/solver` | `vitryne-solver`: the solver and the public API. `engine.rs` is the entry point (`Engine`, `Body`, `Garment`, `GarmentDesc`, `Simulation`); `sim.rs` has `SimSettings` (every tunable) and `Solver`; `shaders/*.wgsl` are the solver's shaders (native and browser share them). Also: `bench.rs`, `dragbench.rs`, `regress.rs`, `strain.rs`, `longrange.rs`, `selfcol.rs`, `untangle.rs`, `body.rs` (BVH, SDF). |
| `packages/vitryne-engine/render` | `vitryne-render`: viewport rendering, out of the solver: `Renderer` (GPU normals, lit cloth and collider), `OrbitCamera`, `pick`/`drag_target` for cloth drags, the M0 triangle; its own `shaders/`. |
| `packages/vitryne-engine/format` | `vitryne-format`: the project file format (`.vtry` family): types, read/write (zip or folder), validation, migrations, unknown data kept. No engine dependency. |
| `packages/vitryne-engine/pattern` | `vitryne-pattern`: DXF-AAMA import and export (`aama.rs`, `aama_export.rs`), `garment.toml` sidecar, meshing, placement (`placement.rs`, regions from `assets/body/avatar.json`); `project.rs` turns a `.vtry` into a `GarmentDesc`, `convert.rs` a sidecar into a `.vtry`; `suggest.rs` + `seams.rs` are sewing in the editor (whole edges only, docs/PATENTS.md). Its `garment::Garment` is the DXF garment, not the engine's (`vitryne_solver::engine::Garment`); alias one of them on import. |
| `packages/vitryne-engine/cli` | `vitryne-cli`: the `vitryne` CLI and the winit viewer (`view`, `bench`, `bench-drag`, `regress`, `frames`, `convert`, `export-app-assets`, `export-bench-assets`, ...). Default paths are relative to the repo root. |
| `packages/vitryne-engine/wasm` | `vitryne-wasm`: the wasm build: the editor worker's API (`project.rs`: `VtryFile` open/validate/save, `PreparedScene`; `viewport.rs`: `Viewport` on an OffscreenCanvas) and the bench page's (`run_bench`, ...). |
| `packages/vitryne-engine/tests/` | Golden results for `vitryne regress`, and `skirt.vtry`: a skirt drawn with the editor's commands (`packages/vitryne-web/src/document/skirt.test.ts` makes it and fails if it differs). |
| `packages/vitryne-web/` | The editor (TypeScript, React, Tailwind + shadcn/ui, Vite) and `bench.html`. `src/routes/` (one screen per URL: `/`, `/design/$id`, `/example/$name`, `/new`), `src/editor/` (`layout/` the frame, which owns the engine and stays mounted across URLs; `hooks/`, `dialogs/`, `start/`, `viewport/`, `icons/`), `src/worker/` (protocol, worker, session with restarts), `src/document/` (the file's JSON, commands, store; tests), `src/format/*.gen.*` (generated from the schemas: `pnpm run gen:format`), `src/pattern/` (2D SVG; `panel/` the flat view, one hook per tool), `src/properties/`, `src/storage/` (files from disk, recovery copy), `src/cloud/` (backend config, autosave, one tab per project, content-addressed projects, dialogs), `src/bench/`. One component or hook per file (docs/ARCHITECTURE.md, Files). |
| `packages/vitryne-docs/` | The documentation website (Astro + Fumadocs UI as React islands, static): two tabs (`content/docs/(guide)/` for people designing garments, `developers/`: copies of `docs/*.md` plus `docker-stack.mdx`), one sidebar and search tag each (`src/lib/tabs.ts`), the editor's colours and fonts in `src/styles/global.css`; `make docs-dev`, `make docs` (in `check-ci`). |
| `packages/vitryne-cloud/supabase/` | The backend schema and local stack: `migrations/` (projects, parts bucket, RLS, limits, anonymous drafts), `functions/clean-anonymous` (deletes stale anonymous users, daily via pg_cron), `templates/` (emails), `config.toml` (the Supabase CLI's `--workdir` is `packages/vitryne-cloud`). |
| `packages/vitryne-cloud/deploy/` | The web image and plug-and-go compose ([docs/CLOUD.md](docs/CLOUD.md)): `docker-compose.yml` (one `web` service, the release image `ghcr.io/h4kken/vitryne-web:${VITRYNE_VERSION:-latest}`, its backend from `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`, required), `docker-compose.build.yml` (override: build from the checkout), `web/` (Caddyfile, Dockerfile with `from-source`/`from-dist`, `entrypoint.sh` running migrations when `SUPABASE_DB_URL` is set, privacy page), `smoke.sh`. `deploy/.env` is git-ignored. |
| `packages/vitryne-cloud/dev/` | Everything in Docker for contributors (`make stack`, `make stack-test`, `make stack-down`): the editor built from the checkout (`deploy/web/Dockerfile` `from-source`) and a local Supabase with the CLI's images and settings; `gateway.Caddyfile` stands in for Kong (CORS, apikey as bearer), `db.sql` sets passwords and the cleanup's Vault secrets on first start. Supabase's public demo keys, ports on 127.0.0.1, the CLI stack's ports (one or the other). |
| `packages/vitryne-cloud/tests/` | Backend tests (RLS, accounts, cleanup, thumbnails) and `browser.mjs` (real Chrome). |
| `assets/` | Avatar (CC0 MakeHuman), three FreeSewing garments with their licences. `tools/patterns` re-drafts them (`./export-all.sh`; the T-shirt is at chest ease 18%, on purpose). |
| `assets/examples/` | The three sample projects in folder form (`tshirt.vtry/`, `trousers.vtry/`, `hoodie.vtry/`): `vitryne convert` output, regenerated by `make examples`. Don't edit them by hand; edit the sidecar or the converter. |
| `docs/FORMAT.md`, `docs/format/schema/` | The project file format (`.vtry` family): spec with rationale, and a JSON Schema per part. Approved in M4; `vitryne-format` implements it in M5. |
| `.github/` | CI (`workflows/ci.yml`: `make check-ci` and the DCO check on every PR), releases (`workflows/release.yml`, on a `vX.Y.Z` tag: GHCR image + GitHub release), the shared toolchain setup (`actions/setup`), rulesets to import, templates, CODEOWNERS. How PRs are merged and releases made: [docs/MAINTAINING.md](docs/MAINTAINING.md); release notes come from [CHANGELOG.md](CHANGELOG.md). |
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
  ([docs/MAINTAINING.md](docs/MAINTAINING.md#releasing)); the user tags and pushes.
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
  (synthetic DOM events can't capture pointers). Projects save to the backend: test against the
  local stack only (`make dev ARGS=--local`), never the hosted project
  `packages/vitryne-web/.env.local` names.
- Backend: `make dev ARGS=--local` (local Supabase stack: Studio on :54323, emails on :54324);
  `make cloud-test` (the web image's smoke test, then RLS, accounts, cleanup, thumbnails; Docker);
  `node packages/vitryne-cloud/tests/browser.mjs cloud|none <url>` (real Chrome). The Supabase
  CLI is pinned in `packages/vitryne-web/` (`pnpm run supabase …` there); the Homebrew one on
  this Mac has a broken signature.
- After changing the converter, the importer or a sidecar: `make examples` and commit
  `assets/examples/` (`make check` diffs them against `vitryne convert`).

## Rules (from the MVP plan, VITRYNE_MVP_PLAN.md, which is not committed; where it conflicts with docs/PATENTS.md, PATENTS.md wins)

1. WebGPU core only: `Features::empty()`, `Limits::default()`, one set of WGSL; only the profiling
   mode may request `timestamp-query`.
2. Engine and UI stay separate; the UI uses the public API and the worker protocol only.
3. Never loosen a quality criterion to make it pass; a target change is its own commit with the
   reasoning in docs/PROGRESS.md.
4. Published methods only for the solver; cite them in `docs/ALGORITHMS.md` and where implemented.
5. Design our own editor interactions (see the patents note).
6. Every commit is signed off (`git commit -s`, identity `Mathis Grimberg
<mathis.grimberg@protonmail.com>`); end a milestone with a commit, docs/PROGRESS.md numbers, and a
   stop for review. The only branch is `main` (remote `origin`); the user pushes (admins bypass
   the ruleset; contributors' PRs are squash-merged, docs/MAINTAINING.md).
7. Projects live in the backend, like Figma or Canva (changed in the MVP fixes, docs/PROGRESS.md): a
   backend is required, projects autosave there, nothing is saved to disk. Anyone can try the
   editor without an account (one draft); keeping more projects and exporting need a free
   account. Network calls only for the app, its assets and what the person does (save, open,
   sign in); never telemetry, and no identifier to count people (docs/CLOUD.md, Privacy).

## State and things that surprise

- **Done:** M0 repo, M1 low-end check (accepted qualitatively; no integrated-GPU or Firefox
  numbers), M2 stretch, M3 API + settings + regression, M4 file format design (`docs/FORMAT.md`),
  M5 format implementation (`vitryne-format`, `vitryne convert`, `.vtry` in the CLI and goldens),
  M6 editor shell (worker + OffscreenCanvas, document model with guardrails, 2D panel,
  properties, storage and save; accepted after a manual Safari check), M7 import and placement
  (DXF import dialog, placement by body place + automatic wrap + 3D gizmo, flat layout;
  waiting for review), M8 sewing in the UI (whole-edge seams: suggestions from geometry, two-click picking,
  seam list, seams in 2D and 3D; waiting for review), M9 fabric presets (5 physical presets in docs/FABRICS.md,
  multi-fabric solver support, per-piece and garment fabric picker with re-drape; waiting for review), M10 export (glTF 2.0 and OBJ export with 2D pattern UVs, multi-fabric PBR materials, avatar node, native CLI and editor UI; waiting for review), M11 demo readiness and report (start from example screen, first-load & SDF analysis, README with animated GIF & quickstart, benchmark & browser matrix in docs/PROGRESS.md; waiting for review), M12 cloud backend and self-hosting (plug-and-go `web` container + a Supabase project, schema in `packages/vitryne-cloud/supabase/`, anonymous-first accounts (email + password with emailed codes, or Google), content-addressed parts per person, RLS tests, local mode unchanged; waiting for review), M13 DXF-AAMA export (`aama_export.rs`: cut-on-fold pieces re-folded when exact, round trip through the sample sidecars in `tests/aama_round_trip.rs`, CLI `vitryne export x.vtry --out x.dxf`; the editor's *Export… → Pattern (.dxf)* is removed until seam allowance exists; waiting for review and your Seamly2D/LibreCAD check). MVP fixes in progress: projects in the cloud (autosave, anonymous drafts, an account to export or keep more projects, no local mode; 4 commits, waiting for review). M14 pattern tools (curved edges `VTRY_curves`, start from scratch, edit points, pen and ready shapes, lines/notches/folds/grain, the drawn-skirt golden; 6 commits, waiting for review). Repository layout (`packages/`, the Makefile, a README per package; 4 commits, waiting for review). **Next:** the remaining MVP fixes, then the rest of the architecture refactor.
- **The plan says `.vitryne`; the extension is `.vtry`** (`.vit` is taken by Seamly2D), with
  `.vtryg`/`.vtryf`/`.vtrya` for garment, fabric and avatar files.
- **The `.vtry` and `garment.toml` paths give bit-identical garments** (test
  `project_matches_sidecar`; `vitryne regress --toml` uses the same goldens). That relies on the
  DXF importer snapping to the format's 0.001 mm grid and the mesher's canonical triangle order;
  keep both.
- **The T-shirt's rest frame jumps under sub-micrometre input changes** (249/332/358/361 seen,
  shapes within 3 mm, docs/PROGRESS.md M5). A rest-frame change after touching the mesher or importer
  isn't necessarily a solver regression.
- **The editor's document is the file's JSON; Rust validates every state** (`VtryFile.set_entities`
  in the worker). Range checks live in both the schemas (TS, before a command exists) and
  `vitryne-format/src/validate.rs` (Rust). Edits only through `document/commands.ts`; never
  mutate the entities (frozen in dev/tests).
- **Sidecars take `[engine]` overrides** (written to `garment.simulation.engine`); the examples
  set `self_collision` and `self_rebuild_every = 4`, the regression setting.
- **Known and accepted for now** (docs/PROGRESS.md M2/M3): trousers p99 edge strain 5.4% against a 3%
  woven target; the hoodie is a basic placeholder (never rests, ~145 persistent
  self-intersections, 20 mm shape tolerance in the golden suite); the 20k T-shirt drape takes
  3.5 s against 3 s. Don't spend time on the hoodie's accuracy.
- Defaults that matter (`SimSettings::default()`): 20 substeps, 3 stretch sweeps, stretch
  damping 1e-4 s (Rayleigh, `gamma = beta / h`), long-range limits on, strain limiting off.
  Configured as M1 (`--stretch-iterations 1 --long-range 0 --long-range-cross 0`, damping
  `1e-5 * compliance / h^2`) the engine reproduces the M1 numbers.
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
