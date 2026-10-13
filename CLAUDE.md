# Vitryne

Open-source (AGPL-3.0-or-later) garment design in the browser: a GPU cloth solver (Rust, WGSL,
WebGPU, native and wasm) plus, planned, a beginner-friendly editor. See [README.md](README.md)
for what works today, [PROGRESS.md](PROGRESS.md) for milestones with their numbers,
[CONTRIBUTING.md](CONTRIBUTING.md) for build and check commands, and
[docs/ALGORITHMS.md](docs/ALGORITHMS.md) for every solver component and its paper.

## Patents: read before touching joins, placement, measuring or grading

CLO Virtual Fashion holds and enforces patents on free-sewing UIs, 2D pattern measuring and
automatic grading, and has pending applications on automatic sewing-line detection and ML
placement. Before designing or building any feature that joins pattern pieces, places pieces
around a body, measures a pattern, or resizes a garment, read
[docs/PATENTS.md](docs/PATENTS.md) and follow its design rules. Do not add such features
without checking them against that file, and say so when a request conflicts with it.

## Where things are

| Path | What |
|---|---|
| `crates/drape-core` | The solver and the public API. `engine.rs` is the entry point (`Engine`, `Body`, `Garment`, `GarmentDesc`, `Simulation`); `sim.rs` has `SimSettings` (every tunable) and `Solver`; `shaders/*.wgsl` are the only shaders (native and browser share them). Also: `bench.rs`, `dragbench.rs`, `regress.rs`, `strain.rs`, `longrange.rs`, `selfcol.rs`, `untangle.rs`, `body.rs` (BVH, SDF). |
| `crates/drape-assets` | DXF-AAMA import, `garment.toml` sidecar, meshing, placement; produces `GarmentDesc`. Its `garment::Garment` is the DXF garment, not the engine's (`drape_core::engine::Garment`); alias one of them on import. |
| `crates/drape-native` | The `drape` CLI and the winit viewer (`view`, `bench`, `bench-drag`, `regress`, `frames`, `export-web-assets`, ...). |
| `crates/drape-web` + `web/` | wasm bindings, the plain-JS viewer (`index.html`, scenes `garment-<name>:<verts>`) and `bench.html`. The TypeScript editor (`app/`) arrives in M6. |
| `assets/` | Avatar (CC0 MakeHuman), three FreeSewing garments with their licences. `tools/patterns` re-drafts them (`./export-all.sh`; the T-shirt is at chest ease 18%, on purpose). |
| `docs/FORMAT.md`, `docs/format/schema/` | The project file format (`.vtry` family): spec with rationale, and a JSON Schema per part. Approved in M4; `vitryne-format` implements it in M5. |
| `examples/` | Sample projects in folder form (`tshirt.vtry/`); `tools/format/build-examples.sh` zips and validates them. |
| `tests/regression/` | Golden results for `drape regress`. |
| `tools/bench/` | `run.sh` (drape/drag matrices, native or Chrome), `summary.py`, `compare.py`, `strain.py`, `chrome-check.mjs`. Output goes to `bench-out/` (git-ignored). |

## Commands

- `./check` is the gate (fmt, clippy native + wasm32, tests, web build, golden drapes, ~1.5 min,
  needs a GPU); `./check --quick` is Rust only. Run `./check` before every milestone commit.
- `cargo` isn't on the shell `PATH` here: `export PATH="$HOME/.cargo/bin:$PATH"`, also for
  `npm run dev` (it rebuilds the wasm).
- After an intended change to solver behaviour: `target/release/drape regress --update`, and
  say why in the commit message. Compare builds with `tools/bench/compare.py <dir> <dir>`.
- Viewer: `cargo run --release -p drape-native -- view --scene garment --garment
  assets/garments/trousers/garment.toml --verts 10000 --self-collision --self-rebuild 4`, or
  `cd web && npm run dev` and open http://localhost:5173.

## Rules (from the MVP plan, VITRYNE_MVP_PLAN.md, which is not committed)

1. WebGPU core only: `Features::empty()`, `Limits::default()`, one set of WGSL; only the profiling
   mode may request `timestamp-query`.
2. Engine and UI stay separate; the UI uses the public API and the worker protocol only.
3. Never loosen a quality criterion to make it pass; a target change is its own commit with the
   reasoning in PROGRESS.md.
4. Published methods only for the solver; cite them in `docs/ALGORITHMS.md` and where implemented.
5. Design our own editor interactions (see the patents note).
6. Every commit is signed off (`git commit -s`, identity `Mathis Grimberg
   <mathis.grimberg@protonmail.com>`); end a milestone with a commit, PROGRESS.md numbers, and a
   stop for review. No remote yet: the user pushes.
7. Local-first: no accounts, telemetry or network calls beyond loading the app and its assets.

## State and things that surprise

- **Done:** M0 repo, M1 low-end check (accepted qualitatively; no integrated-GPU or Firefox
  numbers), M2 stretch, M3 API + settings + regression, M4 file format design (`docs/FORMAT.md`).
  **Next:** M5, implementing the format (`vitryne-format` crate, converter, the engine changes
  listed at the end of FORMAT.md), the samples as `examples/*.vtry`.
- **The plan says `.vitryne`; the extension is `.vtry`** (`.vit` is taken by Seamly2D), with
  `.vtryg`/`.vtryf`/`.vtrya` for garment, fabric and avatar files.
- **Known and accepted for now** (PROGRESS.md M2/M3): trousers p99 edge strain 5.4% against a 3%
  woven target; the hoodie is a basic placeholder (never rests, ~145 persistent
  self-intersections, 20 mm shape tolerance in the golden suite); the 20k T-shirt drape takes
  3.5 s against 3 s. Don't spend time on the hoodie's accuracy.
- Defaults that matter (`SimSettings::default()`): 20 substeps, 3 stretch sweeps, stretch
  damping 1e-4 s (Rayleigh, `gamma = beta / h`), long-range limits on, strain limiting off.
  Configured as M1 (`--stretch-iterations 1 --long-range 0 --long-range-cross 0`, damping
  `1e-5 * compliance / h^2`) the engine reproduces the M1 numbers.
- `Simulation` methods take `&self`; `encode_step` writes a frame into the caller's encoder,
  `step(n)` submits per frame (per-frame parameters are queue writes, which apply at submit).
- Garment SDF boxes are per garment (`garment.toml [sdf]`); the SDF bake takes seconds, so the
  native CLI caches it under `target/sdf-cache/`, the web build fetches pre-baked `sdf.bin`.
- One solver iteration per substep is why strain grows with vertex count; long-range limits and
  extra sweeps are what carry load across a panel.
- Chrome and native agree to ~0.1 mm on the trousers and ~1 mm on the T-shirt, but the hoodie
  is chaotic (up to 11 mm); don't read cross-target hoodie differences as bugs.
