# Progress

Machine used so far: MacBook Air, Apple M2 (integrated GPU), macOS (Darwin 27). Rust 1.99.0, wgpu 30.0.1, wasm-bindgen 0.2.129, Vite 8.3.1, Chrome 150.

## How to run

```sh
# native
cargo run -p drape-native --release -- info              # adapter report JSON
cargo run -p drape-native --release -- snapshot out.ppm  # headless render check
cargo run -p drape-native --release                       # viewer: M1 sheet (drag orbit, wheel zoom, space pause, R reset)
cargo run -p drape-native --release -- bench --grid 100 --out bench/m1/grid100.json   # headless bench, JSON
cargo run -p drape-native --release -- frames --at 0,60,600 --out-dir /tmp/f          # render sim frames to PNG
# T-shirt on the avatar (M2): add --scene tshirt [--edge 0.00864] [--sdf-cell 0.004] to view/bench/frames
cargo run -p drape-native --release -- bench --scene tshirt --edge 0.00864 --out bench/m2/tshirt_10k.json
cargo run -p drape-native --release -- pattern-svg pattern.svg     # meshed pattern + seams
# scene/sim flags: --grid N --substeps S --damping D --friction MU --pin-spacing F --no-sphere
# add --gpu-timestamps to any native command for the opt-in profiling mode

# web (needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.129)
cd web && npm install && npm run dev                      # builds wasm, serves http://localhost:5173
node web/tools/chrome-check.mjs http://localhost:5173/ shot.png   # headless real-Chrome check (GPU on)
# web profiling mode: append ?gpu-timestamps=1 to the URL

# browser viewer (M3): http://localhost:5173/ (T-shirt 5k-40k or sheet; drag cloth, F = fast drape)
#   automation: /?auto=1&scene=tshirt:0.00864[&post=1&dir=m3&name=X]
# drag stability (M3): cargo run -p drape-native --release -- bench-drag --scene tshirt --seed 1
# browser bench (same code as `drape bench`): open http://localhost:5173/bench.html, press Run, Copy JSON
#   automation: bench.html?auto=1&grids=10,100&substeps=20&frames=1200[&ts=1][&post=1&name=X]
#   post=1 makes the page send its JSON to the dev server -> bench/browser-check/X.json
node web/tools/chrome-check.mjs "http://localhost:5173/bench.html?auto=1&grids=100" shot.png 590000 out.json
python3 bench/compare.py bench/browser-check/chrome-grids.json     # native vs browser table
```

## Measurement modes

- **Canonical (default):** `Features::empty()` + `Limits::default()`. Every pass/fail number comes from this mode.
- **Profiling (`--gpu-timestamps` native, `?gpu-timestamps=1` web):** additionally requests WebGPU `timestamp-query` and nothing else, and uses only pass-level `timestampWrites` (core WebGPU; the native-only `TIMESTAMP_QUERY_INSIDE_*` features stay off). Used only to find which pass dominates GPU time (M5). Every report has `"gpu_timestamps": true|false`; device creation asserts that no other feature is ever requested. If the adapter lacks timestamps, it logs a warning and falls back to canonical.

---

## M0 — Setup ✅ (2026-10-11)

**Done-when met:** a coloured triangle renders natively (Metal) and in Chrome via the WebGPU backend. Screenshots are in [docs/m0/](docs/m0/).

### What works
- Cargo workspace: `drape-core`, `drape-assets` (empty stub), `drape-native`, `drape-web`. The repo root is the `drape-spike/` from the plan.
- `drape_core::gpu::Gpu::new` is the **only** device-creation path, used by both targets:
  - requests `Features::empty()` + `Limits::default()` (checked: wgpu 30's `Limits::defaults()` equals the WebGPU spec defaults)
  - **asserts** after creation that `device.features() == empty` and `device.limits() == Limits::default()`
  - logs the adapter's real features/limits next to the device's, as JSON
- Backends: native allows Metal, Vulkan and DX12 only (no GL). Wasm builds wgpu with `default-features = false, features = ["webgpu", "wgsl", "std"]` and requests `Backends::BROWSER_WEBGPU` only. The wasm binary has no WebGL code (0 `webgl` strings), and the web entry errors out if the backend isn't `BrowserWebGpu`.
- One WGSL file (`crates/drape-core/shaders/triangle.wgsl`), loaded with `include_str!`, is used by both targets.
- Web: `wasm-bindgen-cli` + plain Vite page (`web/`); no framework.

### Numbers
| | Native (Metal, Apple M2) | Chrome 150 (WebGPU, Metal underneath) |
|---|---|---|
| Backend reported | `Metal` | `BrowserWebGpu` |
| Device features | none | none |
| Device `maxStorageBufferBindingSize` | 128 MiB | 128 MiB |
| Device `maxStorageBuffersPerShaderStage` | 8 | 8 |
| Device `maxComputeInvocationsPerWorkgroup` | 256 | 256 |
| Device `maxComputeWorkgroupStorageSize` | 16 KiB | 16 KiB |
| Adapter `maxStorageBufferBindingSize` (not used) | 4 GiB | 4 GiB |
| Adapter `maxStorageBuffersPerShaderStage` (not used) | 29 | 10 |
| Adapter offers `TIMESTAMP_QUERY` | yes | yes |
| wasm size (release, after wasm-bindgen) | — | 277 KB (70 KB gzip) |

### Open problems / notes
- **Timestamp queries vs. hard rule 1: resolved (you approved, 2026-10-11).** There is an opt-in profiling mode (see "Measurement modes"). Canonical numbers use CPU timing around `queue.submit` + `on_submitted_work_done`. `drape_core::timer::GpuTimer` gives per-pass GPU times on both targets and does nothing in canonical mode.
  - Triangle pass, 512² (web) / 256² (native): **native Metal 0.049 ms, Chrome 0.046 ms.** Chrome values have µs-level resolution even without `--enable-webgpu-developer-features` (0.044 ms with it). Safari and Firefox timestamp support/resolution are still to be checked in M3.
- Chrome doesn't reveal the adapter name or vendor to the page (empty strings, device_type `Other`). Machine identity for the report has to be recorded by hand.
- gstack's headless Chromium has no GPU adapter (`requestAdapter` returns null), so it can't run WebGPU tests. Browser checks go through `web/tools/chrome-check.mjs`, which drives the installed Google Chrome over CDP with the GPU on.
- Native viewer: launched and ran without errors. I couldn't screenshot the window from the CLI (no accessibility permission), so pixels were checked with the offscreen `snapshot` command, which uses the same renderer.
- Safari and Firefox are not tested yet (that's M3).
- Not tested yet on the Windows laptop.

## M1 — GPU cloth sheet ✅ (2026-10-11)

**Done-when met:** the sheet drapes stably on native, `drape bench` prints JSON, and the numbers are below. Raw JSON is in [bench/m1/](bench/m1/); frames are in [docs/m1/sheet-10k.png](docs/m1/sheet-10k.png).

![drape](docs/m1/sheet-10k.png)

### What works
- **Scene:** a 1 m square sheet, 1 m up, pinned at the two corners of one edge, falls onto a 30 cm sphere. The pins are 0.9 m apart (`pin_spacing`; see the taut-pins problem below).
- **Solver:** XPBD with small steps, 20 substeps per frame and 1 iteration per substep, entirely on the GPU in [sim.wgsl](crates/drape-core/shaders/sim.wgsl). Each substep runs: predict → stretch (one dispatch per colour) → bend (one dispatch per colour) → sphere collision with friction → velocity update. There is no CPU readback in the step.
  - **Stretch:** one distance constraint per mesh edge.
  - **Bending:** isometric bending (Bergou 2006). The curvature `C = Σ kᵢxᵢ`, with cotangent weights computed from the rest shape, is linear in positions. So the XPBD update is closed-form and doesn't blow up when the cloth is flat, unlike dihedral-angle bending. The weights come from the *rest* mesh, ready for M2's flat 2D pattern pieces.
  - **No float atomics:** constraints are greedy graph-coloured on the CPU. The grid needs 8 colours for stretch and 18 for bending, at every size. Unit tests check that no vertex appears twice in one colour, and that bending is zero when flat and nonzero when folded.
  - **Colour ranges:** each colour's range is picked with a **dynamic uniform offset**, so no push constants are needed (rule 1).
- **Material:** placeholder cotton (`Material::cotton()`): 0.15 kg/m², stretch stiffness 1e4 N/m, bending stiffness 5e-6 N·m. Damping is 1.0/s, collision thickness 2 mm, friction 0.3.
- **Metrics:** a GPU reduction ([metrics.wgsl](crates/drape-core/shaders/metrics.wgsl)) turns the mesh into 16 bytes: kinetic energy, max speed, min distance to the sphere, and a count of NaN/inf values (detected with a bit test, which compiler optimisations can't remove). The bench reads those 16 bytes once per frame, outside the timed region.
- **Rest rule:** the free vertices' RMS speed stays below 5 mm/s for 30 frames in a row. The rest frame is the first frame of that streak.
- **`drape bench`:** two timings. Serial = submit → GPU done, one frame at a time, which is pessimistic. Pipelined = 300 frames queued back to back, which is what an interactive loop gets. It also records the rest frame, max speeds, NaN frames, buffer sizes, a speed trace, the 10 fastest vertices at the end (to find jitter spots), and per-phase GPU ms in profiling mode. The bench code is async and also builds for wasm, ready for M3.
- **Viewer:** normals recomputed on the GPU by gathering each vertex's triangles (no atomics), two-sided lighting, orbit camera. It holds a steady **60 fps (vsync) at 10k vertices**.
- **Limits used:** at most 5 storage buffers per stage (limit 8) and workgroup size 64 everywhere. The largest storage binding at 40k vertices is 5.7 MB, against the 128 MiB limit. All simulation buffers at 40k total 9.5 MB.

### Numbers (native Metal, Apple M2, canonical mode, 20 substeps, 1200 frames)

| Vertices | Colours (stretch+bend) | Dispatches per frame | **Pipelined ms per frame** | Serial ms per frame, median / p95 | Rest frame (sim s) | **Wall time to rest, pipelined** | Max speed after 1 s | NaN frames |
|---|---|---|---|---|---|---|---|---|
| 100 | 8+18 | 580 | 0.84 | 1.28 / 1.79 | 452 (7.5 s) | 0.38 s | 1.24 m/s | 0 |
| 2,500 | 8+18 | 580 | 0.99 | 1.43 / 1.71 | 287 (4.8 s) | 0.28 s | 0.56 m/s | 0 |
| 5,041 | 8+19 | 600 | 1.12 | 1.54 / 1.76 | 440 (7.3 s) | 0.49 s | 0.74 m/s | 0 |
| **10,000** | 8+18 | 580 | **1.33** | 1.79 / 1.99 | 462 (7.7 s) | **0.61 s** | 1.43 m/s | 0 |
| 19,881 | 8+18 | 580 | 2.18 | 2.65 / 2.82 | 458 (7.6 s) | 1.00 s | 1.34 m/s | 0 |
| 40,000 | 8+18 | 580 | 4.15 | 4.75 / 4.90 | 582 (9.7 s) | 2.41 s | 2.08 m/s | 0 |

Min distance to the sphere at rest is 2.00 mm at every size, which equals the collision thickness: no penetration.

**10k vertices, varying substeps:**

| Substeps | Pipelined ms | Rest frame | Wall time to rest |
|---|---|---|---|
| 10 | 0.69 | 336 | 0.23 s |
| 15 | 1.00 | 401 | 0.40 s |
| 20 | 1.33 | 462 | 0.61 s |
| 30 | 1.98 | 731 | 1.45 s |

Fewer substeps rest sooner because they add numerical damping. More substeps make the cloth effectively stiffer and less damped.

**GPU time by phase (profiling mode, ms per frame, summed over 20 substeps):**

| Vertices | predict | stretch | **bend** | collide | update |
|---|---|---|---|---|---|
| 10k | 0.12 | 0.46 | **1.05** | 0.09 | 0.11 |
| 40k | 0.34 | 1.41 | **3.13** | 0.22 | 0.29 |

Bending is about 55% of GPU time and stretch about 25%. Profiling uses one pass per phase per substep, so these numbers include extra per-pass overhead and add up to more than the canonical frame time. Only the shares are meaningful.

### Findings
- **Dispatch overhead is the main cost at garment sizes.** The 100-vertex grid runs the same 580 dispatches as the 10k grid, with almost no work, and still costs 0.84 ms per frame. That's about **1.45 µs per dispatch** on native Metal, so roughly 60% of the 10k frame is fixed overhead, and 10k → 40k scales sub-linearly. This is the plan's "graph colouring → too many dispatches" risk, now measured. Browser dispatch overhead is likely higher, so M3 should check this first. Ways to cut it, if needed: fewer colours (each colour is a dispatch), fewer substeps with more iterations, or merging stretch and bend into one coloured pass.
- **Sim time vs wall time.** Reaching rest takes 5–10 s of *simulated* time at the current damping, but the sim runs 12× faster than real time at 10k, so wall time is 0.6 s. A viewer locked to vsync, running one sim frame per display frame, would show it as 7.7 s. **For the "< 3 s to rest" test, the drape has to run unlocked (several sim frames per display frame).** I'll do that in M2/M3.
- **The whip spike is physical.** The max speed of 9–16 m/s around frame 20 is the free edge whipping at the bottom of the first swing (the far edge falls about 1.4 m). It also happens without the sphere and at 40 substeps, and it decays. After 1 s, the max is ≤ 2.1 m/s at every size. The bench reports both: `max_speed_over_5ms` is the raw plan criterion and is true here; `exploded` means NaN or ≥ 5 m/s after 1 s, and is false at every size. The 5 m/s criterion was written for the T-shirt and drag tests, where nothing free-falls 1 m.

### Open problems / notes
- **Taut pins vibrate.** With the pins exactly at rest length (`--pin-spacing 1.0`), the nearly inextensible edge between them can't sag, so it vibrates like a taut string (46 mm/s at the edge midpoint, found through `final_fastest_vertices`). It still rests at frame 663 with damping 1.0, but at damping 0.5 it never did. Garments have no pins, so this matters less, but the stiff-constraint jitter mechanism may come back at seams.
- **Damping:** the default went from 0.5/s to 1.0/s. At 0.5/s the slack case rests at frame 723 instead of 462. Simple velocity damping is crude: it also slows the fall (terminal speed ≈ 9.8 m/s). A better damping model is in "Later".
- **No self-collision yet (M4).** Folds can pass through each other; the back face shows through on the left flap in the frames.
- The grid-of-100 run shows a 10.7 m/s spike at frame 0. That comes from the 10% initial compression being released on a very coarse mesh (11 cm edges), and it's irrelevant to the other sizes.
- Material values are placeholders, not calibrated (out of scope).
- Not tested on Windows yet. The web build still renders the M0 triangle; the cloth goes to the browser in M3.

## Browser check (pulled forward from M3) ✅ (2026-10-11)

**Question:** does the browser add enough cost per GPU job to break the "< 3 s to rest" test?
**Answer: no.** On this M2, Chrome is **1.10–1.19×** native and Safari **1.00–1.14×**. Both are well inside the plan's "browser ≤ 2× native". Raw JSON is in [bench/browser-check/](bench/browser-check/).

### How it was measured
- [bench.html](web/bench.html) calls `drape_web::run_bench`, which runs the **same `drape_core::bench::run`** as the native CLI, with the same scene, defaults and frame counts (1200 frames).
- Each run gets a fresh device, with no features and default limits. Both browsers report the `BrowserWebGpu` backend and empty features.
- The page is served cross-origin isolated (COOP/COEP in [vite.config.js](web/vite.config.js)), so `performance.now()` has fine resolution in both browsers.
- **Chrome 150:** headless with the real GPU, driven by `chrome-check.mjs` over CDP.
- **Safari 27.0.1:** opened normally (`open -a Safari …?auto=1&post=1`). The page POSTs its JSON to a dev-only endpoint on the Vite server, because Safari remote automation needs a sudo setting.

### Native vs Chrome (20 substeps)

| Vertices | Native ms per frame | Chrome ms per frame | Ratio | Rest frame (native / Chrome) | Wall time to rest (native / Chrome) | Chrome NaN frames |
|---|---|---|---|---|---|---|
| 100 | 0.84 | 0.98 | 1.16× | 452 / 451 | 0.38 / 0.44 s | 0 |
| 2,500 | 0.99 | 1.16 | 1.17× | 287 / 278 | 0.28 / 0.32 s | 0 |
| 5,041 | 1.12 | 1.31 | 1.17× | 440 / 466 | 0.49 / 0.61 s | 0 |
| **10,000** | 1.33 | **1.56** | 1.17× | 462 / 460 | 0.61 / **0.72 s** | 0 |
| 19,881 | 2.18 | 2.39 | 1.10× | 458 / 488 | 1.00 / 1.17 s | 0 |
| 40,000 | 4.15 | 4.94 | 1.19× | 582 / 541 | 2.41 / 2.67 s | 0 |

**10k vertices in Chrome, varying substeps:** 10 → 0.79 ms (1.15×), 15 → 1.15 ms (1.15×), 30 → 2.26 ms (1.14×).

### Native vs Safari (20 substeps)

| Vertices | Native ms per frame | Safari ms per frame | Ratio | Rest frame (native / Safari) | Wall time to rest (native / Safari) | Safari NaN frames |
|---|---|---|---|---|---|---|
| 100 | 0.84 | 0.89 | 1.06× | 452 / 451 | 0.38 / 0.40 s | 0 |
| 2,500 | 0.99 | 1.13 | 1.14× | 287 / 267 | 0.28 / 0.30 s | 0 |
| 5,041 | 1.12 | 1.17 | 1.05× | 440 / 440 | 0.49 / 0.52 s | 0 |
| **10,000** | 1.33 | **1.45** | 1.09× | 462 / 458 | 0.61 / **0.66 s** | 0 |
| 19,881 | 2.18 | 2.18 | 1.00× | 458 / 444 | 1.00 / 0.97 s | 0 |
| 40,000 | 4.15 | 4.63 | 1.12× | 582 / 569 | 2.41 / 2.64 s | 0 |

### Cost per GPU job (the M1 worry)
The 100-vertex sheet is almost pure overhead: 580 dispatches with almost no work in each.

| | Native Metal | Chrome | Safari |
|---|---|---|---|
| Per dispatch | 1.45 µs | 1.7 µs | 1.5 µs |

The browsers add 3–17% per dispatch, not multiples. The 26 colours × 20 substeps design holds in the browser.

### GPU time by phase (profiling mode, ms per frame)

| | predict | stretch | bend | collide | update |
|---|---|---|---|---|---|
| Native 10k | 0.12 | 0.46 | 1.05 | 0.09 | 0.11 |
| Chrome 10k | 0.18 | 0.99 | 2.60 | 0.15 | 0.16 |
| Safari 10k | 0.14 | 0.71 | 1.43 | 0.10 | 0.11 |
| Native 40k | 0.34 | 1.41 | 3.13 | 0.22 | 0.29 |
| Chrome 40k | 0.17 | 1.16 | 3.60 | 0.11 | 0.17 |
| Safari 40k | 0.16 | 1.19 | 2.88 | 0.12 | 0.16 |

Bending is the biggest phase on every target. Both browsers support `timestamp-query`. Profiling mode uses one pass per phase per substep, so absolute numbers carry per-pass overhead. Chrome's 10k row is inflated by that overhead, which is more than its canonical 1.56 ms frame.

### Notes / open problems
- **Results agree but aren't bit-identical across targets.** Rest frames differ by 0–10% (40k: native 582, Chrome 541, Safari 569). The shader compilers differ (naga→MSL on native, Tint/Dawn in Chrome, WebKit's compiler in Safari), and a falling cloth amplifies tiny floating-point differences. Stability and penetration agree everywhere: no NaNs, min distance 2.00 mm, max speed after 1 s ≤ 2.1 m/s. M3's "same results within tolerance" needs a real definition, for example the final shape compared within N mm instead of identical rest frames.
- **Still untested:** Firefox (not installed here) and the Windows laptop. Running there just means opening `bench.html` and pressing Run, then Copy JSON.
- Safari ran in a visible, focused window. Background tabs may be throttled, so for manual runs keep the tab in front.
- `chrome-check.mjs` used to cut piped output at 64 KB (`process.exit` drops buffered stdout). It now writes the report to a file and sets `exitCode` instead.

## M2 — T-shirt on the body, native ✅ (2026-10-11)

**Done-when met:** the T-shirt drapes onto the avatar and comes to rest without explosions at 10k and 20k vertices, and also at 5k and 40k. Raw JSON is in [bench/m2/](bench/m2/).

![drape sequence](docs/m2/drape-10k.png)
![at rest: front, back, three-quarter](docs/m2/rest-10k.png)

### What works
- **Avatar:** the MakeHuman base mesh (CC0), body group only, in metres. 13,380 vertices and 26,756 triangles, A-pose, 1.67 m tall. The source, license and measurements are in [assets/body/README.md](assets/body/README.md).
- **Body on the CPU** ([body.rs](crates/drape-core/src/body.rs)):
  - a triangle BVH (built in 18 ms)
  - exact signed distance, with the sign from angle-weighted pseudo-normals (unit-tested on a cube for face, edge and vertex regions)
  - a narrow-band **SDF bake**: exact within ±4 cm, and only the sign beyond that, from one BVH ray per grid row
- **SDF size:** a box around the torso and upper arms at 4 mm is 226×216×126 = **24.6 MB, baked in 0.43 s** on native (multi-threaded with rayon). It's cached under `target/sdf-cache/`, and the bake also builds for wasm.
- **SDF on the GPU:** stored in a storage buffer and sampled by hand with trilinear interpolation and an analytic gradient in [sdf.wgsl](crates/drape-core/shaders/sdf.wgsl). Core WebGPU can't filter float 3D textures, so the shader does it. The same snippet is prepended to the sim and metrics shaders.
- **Collision:** each vertex is projected out to `sdf ≥ 2 mm` along the gradient, with the same Coulomb friction as M1.
- **Procedural T-shirt** ([tshirt.rs](crates/drape-assets/src/tshirt.rs)): front, back and 2 sleeves as 2D polygons in metres, with 10 seams. The pieces are sized from the avatar's measurements: chest 0.96 m around with ease, sleeve opening 0.34 m. The meshed pattern with colour-coded seams is in [docs/m2/pattern-10k.png](docs/m2/pattern-10k.png).
- **Meshing** ([meshing.rs](crates/drape-assets/src/meshing.rs)): the boundary is resampled at the target edge length, and both sides of each seam get **the same segment count**. The interior is an equilateral lattice, and spade's constrained Delaunay triangulation joins the two. The mean edge comes out within 1% of the target.
- **Sewing:** zero-length constraints, graph-coloured (3 colours), stored after the stretch constraints in the same buffer so no extra binding is needed.
  - **Ramp-in:** compliance goes from 1e-2 to 1e-8 over 0.5 s, on a log scale.
  - **Correction clamp:** at most 0.5 mm per vertex per substep while the seams close. Seams close within about 20 frames from initial gaps of up to 372 mm (mean 158 mm).
- **Initial placement:** hardcoded for this garment. The body panels sit on a cylinder of radius 0.20 m around the torso, front in front and back behind. The sleeves are wrapped on a cylinder of radius 0.10 m around each measured upper-arm axis. **No vertex starts inside the body.**
- **Schedule:** gravity is off for 0.6 s, so the panels don't fall before the seams have closed, and then ramps to full over 0.3 s. Ramped parameters are a 96-byte uniform upload per frame, not a readback. Rest detection can't start until all ramps have finished.
- **Bench additions:**
  - an **exact CPU penetration check** at the end of the run: BVH signed distance for every cloth vertex
  - the SDF-vs-exact error at those vertices
  - per-seam gaps, including where along each seam the worst gap is
  - each of the fastest vertices labelled with its panel
- **Viewer:** `--scene tshirt` runs at 60 fps at 10k vertices. **F** toggles *fast drape*, 8 sim frames per display frame, so the drape should settle in about 0.7 s on screen instead of 5.6 s. That's calculated (333 frames ÷ 8 ÷ 60 fps); the key press itself hasn't been exercised, because the smoke test is headless.

### Numbers (native Metal, Apple M2, normal mode, 20 substeps, 4 mm SDF, 900 frames)

| Target | Vertices | Mean edge (mm) | Colours (stretch+sew+bend) / dispatches | **Pipelined ms per frame** | Serial median ms | Rest frame (sim time) | **Wall time to rest** | Max speed (m/s) | Max speed after ramps | **Exact max penetration (mm)** | GPU min SDF distance (mm) | SDF error (mm) | Max seam gap (mm) | NaN frames |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5k | 5,053 | 12.4 | 8+3+18 / 640 | 1.28 | 1.78 | 274 (4.6 s) | **0.35 s** | 3.85 | 1.05 | **0.00** | 1.90 | 0.95 | 1.5 | 0 |
| **10k** | 10,002 | 8.7 | 8+3+18 / 640 | **1.85** | 2.30 | 333 (5.6 s) | **0.62 s** | 4.41 | 1.47 | **0.00** | 1.83 | 1.19 | 1.5 | 0 |
| **20k** | 19,967 | 6.2 | 9+3+18 / 660 | **3.19** | 3.42 | 347 (5.8 s) | **1.11 s** | 4.86 | 1.96 | **0.00** | 1.92 | 1.36 | 2.2 | 0 |
| 40k | 39,674 | 4.4 | 9+3+18 / 660 | 5.16 | 5.70 | 328 (5.5 s) | **1.69 s** | 3.92 | 3.92 | **0.00** | 1.91 | 1.39 | 3.5 | 0 |
| 10k, 3 mm SDF | 10,002 | 8.7 | 8+3+18 / 640 | 1.94 | 2.53 | 337 (5.6 s) | 0.65 s | 4.34 | 1.41 | 0.00 | 1.95 | 0.95 | 1.5 | 0 |

Against the plan's criteria, on native so far:
- **Drape to rest < 3 s:** ✅ at every size, measured as wall time with frames queued back to back.
- **Body penetration at rest < 2 mm:** ✅ 0.00 mm, exact, at every size.
- **Stability:** ✅ no NaNs, and the max speed stays under 5 m/s **including the sewing phase**. That's the raw criterion with nothing excluded; unlike the M1 sheet, nothing free-falls here.

**GPU time by phase at 10k (profiling mode, ms per frame):**

| predict | stretch | sew | bend | collide (SDF) | update |
|---|---|---|---|---|---|
| 0.12 | 0.48 | 0.14 | **1.08** | 0.37 | 0.12 |

Bending is still the biggest phase. SDF collision, which does 8 scattered reads per vertex, costs 3× the analytic sphere.

### Findings
- **The most important bug: the sewing clamp must be lifted once the seams are closed.** At first the 0.5 mm clamp stayed on for the whole run. Under gravity, the closed seams then crept open, the sleeves slid down the A-pose arms, and the whole shirt fell off within 2 s (final seam gap 1.7 m). The clamp now applies only during the 0.5 s ramp. Closed seams need larger corrections under load than the clamp allows.
- **Seam gaps at rest are small, but the four-way underarm junction is sensitive to the mesh.** Mean gaps are 0.05–0.4 mm. The maximum is 1.5–3.5 mm in the main runs, always at the underarm junction, where the front, back and both sleeve corners meet in the armpit crease and the torso and arm surfaces both push outward. In one earlier mesh (edge 8.8 mm, 9,637 vertices, [tshirt_9.6k_edge8.8mm.json](bench/m2/tshirt_9.6k_edge8.8mm.json)), that junction stayed open by **18 mm**, while everything else was below 4 mm. A taller sleeve cap made it worse (24 mm), so I reverted it. Merging junction vertices once they meet would remove this. That's in "Later".
- **A 4 mm SDF is good enough.** Against the exact distance, its error at the cloth vertices is ≤ 1.4 mm. A 3 mm SDF lowers that to 0.95 mm but is 2.4× bigger (58 MB, closer to the 128 MiB binding limit), with no change in the results.
- **Sim time vs wall time again:** rest takes 4.6–5.8 s of simulated time, but the sim runs 9× faster than real time at 10k, so wall time is 0.62 s. The browser viewer in M3 needs the same "fast drape" mode.

### Open problems / notes
- **The penetration check only looks at vertices.** Body features poking through a triangle's interior aren't detected. With 4–12 mm triangles on a smooth body, and the 2 mm thickness, this is unlikely, but it's unmeasured. The SDF also doesn't include the hands or head; the shirt can't reach them, but a dragged sleeve could leave the SDF box, where there's no collision.
- **Fit is approximate.** The sleeve cap is flat, which suits a T-pose, so the sleeves flare a little on the A-pose arms. The neckline is generous. Garment fit and fabric calibration are out of scope.
- **No self-collision yet (M4).** Folds and the doubled-up cloth at the seams can interpenetrate.
- **The T-shirt doesn't run in the browser yet.** The sheet does (checked again after the bench refactor: Chrome 1.55 ms). M3 needs the body OBJ and the baked SDF served to the page: either fetch the cached `.bin` (24.6 MB) or bake in wasm (single-threaded, so probably several seconds; measure it).
- `drape-web` builds on native too; only the canvas `start()` is wasm-only. So `cargo test --workspace` and rust-analyzer both check it.

## M3 — Browser port and parity ✅ Chrome + Safari, ⏸ Firefox (2026-10-11)

**Done-when:** runs in Chrome ✅ and Safari ✅. **Firefox isn't installed on this Mac, and you chose to skip it for now**, so it's untested. Running `bench.html` there is a matter of Run → Copy JSON. Native and browser numbers are side by side below. Raw JSON is in [bench/m3/](bench/m3/), and the comparison script is [bench/compare_m3.py](bench/compare_m3.py).

![Safari 27, T-shirt 10k after the automated drag](docs/m3/safari-viewer-10k.jpg)

### What works
- **Web viewer** ([web/index.html](web/index.html), [viewer.rs](crates/drape-web/src/viewer.rs)): the same `Solver` and `Renderer` as native, in a canvas, driven by `requestAnimationFrame`.
  - Choice of T-shirt 5k/10k/20k/40k or the M1 sheet; fast drape (F), pause, reset; orbit and zoom.
  - **Mouse drag:** pointer-down does a one-off position readback, a CPU ray pick (nearest vertex within 1.5 cm of the ray, front-most), then grabs a patch. A drag elsewhere orbits. The native viewer has the same drag.
- **Drag model** ([sim.rs](crates/drape-core/src/sim.rs)), settled through the stability test below:
  - **Patch:** the picked vertex plus graph-connected neighbours within 1.5 cm (≤ 32), so the other layer of the shirt isn't grabbed.
  - **Spring:** XPBD attachments with a **fixed total stiffness of 100 N/m**, so 1 cm of lag pulls with 1 N, independent of mesh resolution.
  - **Release:** a 6-frame soft release.
  - **Body blocking:** the target can't enter the body. It stops at the surface, like a hand.
  - **Cost:** applied in the collide pass, so there's no extra dispatch.
- **Assets on the web:** `npm run assets` exports the body OBJ (0.87 MB) and the baked SDF (50.2 MB, **14.9 MB gzipped**) to `web/public/assets` (git-ignored). On the M2 Mac with a local server: the fetch takes 50–200 ms, decode 8–13 ms, and the BVH 24–26 ms. **Baking the SDF in wasm takes 9.2–9.4 s** (single thread; native with rayon takes 1.7 s), so **download it, don't bake it**.
- **Bench page:** T-shirt drape, the 60 s random-drag test, the sheet, and SDF-bake timing, all running the same `drape_core` code as the CLI. It's automatable through URL parameters, and with `post=1` it sends its results and progress logs back to the dev server, which is how the Safari runs work.
- **`bench-drag`** ([dragbench.rs](crates/drape-core/src/dragbench.rs)): the plan's stability test. Drape for 4 s, then 60 s of random drags: ~43 episodes, each picking a random vertex, pulling it 5–25 cm in a random direction over ≥ 0.3 s, holding, releasing and pausing. Then a 3 s settle and the exact penetration check. **The script comes from a fixed-seed RNG, so native and every browser replay identical drags.**

### Native vs browser: T-shirt drape (Apple M2, 20 substeps, 900 frames)

#### Chrome: bench/m3/chrome_tshirt.json

| Vertices | Native ms | Chrome ms | Ratio | Native rest frame | Chrome rest frame | Native wall to rest | Chrome wall to rest | Chrome max pen (mm) | Chrome max v | Chrome NaN | Shape diff mean / p95 / max (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5,053 | 1.31 | 1.44 | 1.10× | 287 | 287 | 0.38 s | 0.41 s | 0.00 | 3.12 | 0 | 0.00 / 0.01 / 0.02 |
| 10,002 | 1.75 | 1.83 | 1.05× | 286 | 286 | 0.50 s | 0.52 s | 0.00 | 2.57 | 0 | 0.00 / 0.00 / 0.01 |
| 19,967 | 2.62 | 2.97 | 1.13× | 219 | 219 | 0.57 s | 0.65 s | 0.00 | 3.26 | 0 | 0.00 / 0.00 / 0.02 |
| 39,674 | 4.80 | 5.36 | 1.11× | 284 | 284 | 1.36 s | 1.52 s | 0.00 | 2.01 | 0 | 0.00 / 0.01 / 0.04 |

#### Safari: bench/m3/safari_tshirt.json

| Vertices | Native ms | Safari ms | Ratio | Native rest frame | Safari rest frame | Native wall to rest | Safari wall to rest | Safari max pen (mm) | Safari max v | Safari NaN | Shape diff mean / p95 / max (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5,053 | 1.31 | 1.39 | 1.06× | 287 | 287 | 0.38 s | 0.40 s | 0.00 | 3.12 | 0 | 0.00 / 0.01 / 0.01 |
| 10,002 | 1.75 | 1.86 | 1.06× | 286 | 286 | 0.50 s | 0.53 s | 0.00 | 2.57 | 0 | 0.00 / 0.00 / 0.01 |
| 19,967 | 2.62 | 2.94 | 1.12× | 219 | 219 | 0.57 s | 0.64 s | 0.00 | 3.26 | 0 | 0.01 / 0.01 / 0.02 |
| 39,674 | 4.80 | 5.11 | 1.06× | 284 | 284 | 1.36 s | 1.45 s | 0.00 | 2.01 | 0 | 0.01 / 0.01 / 0.05 |

- **Speed:** browsers are **1.05–1.13× native** (Chrome) and **1.06–1.12×** (Safari), well within "browser ≤ 2× native".
- **Results:** "same results within tolerance" holds almost exactly. The rest frame is identical, and the final shape is within **0.05 mm per vertex** of native at every size. Here, unlike the M1 sheet, the damped drape converges to the same state whichever shader compiler ran it.
- **Drape criteria in both browsers:** rest in 0.40–1.52 s of wall time, 0.00 mm penetration, max speed ≤ 3.3 m/s, and no NaNs.

### Interactive drag (viewer automation: fast-drape to 6 s, then 3 s of circular dragging at the view centre)

| | 10k fps while dragging | 20k fps while dragging | Fast drape: 6 s of sim takes (10k / 20k) |
|---|---|---|---|
| Chrome 150 | **56.6** | **55.9** | 0.72 s / 1.07 s |
| Safari 27 | **55.9** | **56.3** | 0.76 s / 1.17 s |

**≥ 30 fps ✅**: both browsers stay near the 60 Hz cap. The page also samples an offscreen "work per frame" time (Chrome 9.5 / 12.4 ms, Safari 10.3 / 13.3 ms at 10k / 20k). That's only an upper bound: in a live page, the GPU-done callback is delayed by the event loop, and the bench's serial sim time is about 2.3 ms at 10k.

### Stability: 60 s of random drags (native; Chrome and Safari give identical numbers)

| Mesh | Seed | Episodes | **Max speed (m/s)** | Frames ≥ 5 m/s (of 3,600) | Vertices ≥ 5 m/s on worst frame | NaN | Min SDF distance during drags (mm) | **Penetration after settle (mm)** | Seam gap after (mm) | Gentle variant: max speed | Gentle: frames ≥ 5 m/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10k | 1 | 44 | 3.98 | 0 | 0 | 0 | 1.6 | 0.00 | 1.9 | 4.10 | 0 |
| 10k | 2 | 43 | 8.24 | 2 | 168 | 0 | 0.9 | 0.00 | 3.3 | 6.60 | 1 |
| 10k | 3 | 43 | 11.81 | 2 | 2 | 0 | 1.2 | 0.00 | 2.1 | 4.60 | 0 |
| 20k | 1 | 44 | 8.24 | 3 | 191 | 0 | 1.6 | 0.00 | 3.9 | 4.55 | 0 |
| 20k | 2 | 43 | 6.07 | 3 | 253 | 0 | 0.7 | 0.00 | 2.7 | 2.47 | 0 |
| 20k | 3 | 43 | 6.66 | 2 | 16 | 0 | 1.4 | 0.00 | 3.9 | 6.31 | 1 |

- **Gentle variant:** pulls of 5–15 cm over ≥ 0.5 s.
- **Chrome and Safari both reproduced all 6 native runs exactly** (same max speeds and spike counts), with no NaN and 0.00 mm penetration after.

**Against the plan's criterion ("no NaN, no explosion, max vertex speed < 5 m/s"):**
- ✅ No NaN, ever.
- ✅ The cloth never ends up in the body (0.00 mm after every run), and seams stay closed (< 4 mm).
- ❌ **The raw speed limit is broken in 5 of 6 harsh runs and 2 of 6 gentle ones.** Each time it's only 1–3 frames out of 3,600: from 2 vertices up to about 250 for one or two frames, peaking at 6–12 m/s. The cloth recovers right away.
- **Verdict:** stable, but it doesn't strictly pass. Every remaining spike happens at **body creases** (front of the armpit, the crotch, where the arm touches the torso in the A-pose) or on a **free edge whipping** under a hard, fast pull.

### Findings: what the drag test exposed (all fixed, all in both targets)
1. **The SDF box was clipping the body.** A box ending at y = 0.70 let dragged hems sink into the hips, and the cloth whipped at the box boundary (62 m/s, then 35 mm of penetration). **Fix:** the box now covers everything the shirt can reach (y 0.40–1.60, x ±0.55); at 4 mm that's 50 MB.
2. **A narrow SDF band left no escape route.** Beyond ±4 cm the gradient is zero, so cloth dragged deep inside couldn't get out. **Fix:** a 12 cm band, which covers the whole torso interior.
3. **The drag was effectively rigid.** A per-vertex compliance of 1e-3 m/N looks soft, but it's rigid for 5–10 mg vertices, and it rammed cloth through the body at more than 100 N. **Fix:** a fixed total stiffness (100 N/m).
4. **Inside targets jumped across the body.** Snapping a target inside the body to the *nearest* surface made it jump to the far side as a drag path crossed the body (250 vertices above 5 m/s). **Fix:** the target is blocked at the surface instead.
5. **Push-out became launch velocity.** In position-based dynamics, a 6 mm push-out in one substep turns into a 7 m/s velocity. **Fix:** inelastic contact, which zeroes the outward normal velocity after a contact. This also made the drape rest sooner: 10k now rests at frame 286 instead of 333.
6. **Free edges whipped.** **Fix:** XPBD stretch damping (β = 1e-5 s, Macklin 2016) plus quadratic air drag (k = ½ρC_d/σ ≈ 4 /m for cotton). Both are physically motivated, and both are now defaults for every scene.
7. **Tried and rejected:** capping the push-out per substep (1–5 mm). It lets cloth sink 40–100 mm into the body under drag load. The cap is now off by default (`contact_max_step`).

### Defaults changed in M3 (the M1/M2 tables above used the old ones)
`stretch_damping` 0 → 1e-5 s · `air_drag` 0 → 4 /m · inelastic contact · drag spring 100 N/m total · SDF box y 0.40–1.60, x ±0.55, z −0.25–0.35, band 12 cm (50.2 MB). **The M3 tables are the current baseline.** Native T-shirt at 10k: 1.75 ms per frame, rest at frame 286 (0.50 s).

### Open problems / notes
- **Creases are the weak spot.** Per-vertex SDF projection can't represent a gap narrower than twice the thickness: the armpit in A-pose, or a dragged hem between the thighs. Options: a slightly bigger arm–torso gap in the avatar pose; a velocity filter at contacts; a triangle-level contact; or a max-velocity clamp. The clamp would make the number pass but hide the issue, so I didn't add one.
- **Firefox is untested** (skipped for now at your request). **The Windows laptop is untested.**
- **The SDF download is 50 MB raw / 15 MB gzip.** That's fine on a local server. For production, compress it (f16 storage would need the `shader-f16` feature, so instead quantise to i16 in a u32 buffer), use a coarser grid outside the torso, or bake it on a server.
- **Canvas colour:** the browser canvas uses a non-sRGB format, so the shading is darker than native. Rendering quality is out of scope.
- `?sdf=bake` exists for testing the wasm bake path; it's slow (9 s).
- The debug hook `DRAPE_DEBUG_EPISODE=N` (native only) prints the fastest vertex every frame of drag episode N. It's how the causes above were found.

## Later
- Better damping than global velocity damping (e.g. damping only along constraints, or in the solver itself), so the drape rests faster without slowing free fall.
- Cut dispatch count if the browser overhead is high: fewer colours, or merging stretch and bend into one coloured pass.
- Merge seam vertices once they meet, especially at junctions like the underarm.
- Triangle-level penetration check (body vertices against cloth triangles), not just cloth vertices.
- A sleeve cap shaped for the A-pose (pattern fit; out of scope for the spike).
- Better crease contact (see M3): velocity filter at contacts, or triangle-level body contact.
- Smaller SDF download (i16 quantisation, adaptive grid) for production.
