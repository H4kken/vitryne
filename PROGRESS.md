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
# scene/sim flags: --grid N --substeps S --damping D --friction MU --pin-spacing F --no-sphere
# add --gpu-timestamps to any native command for the opt-in profiling mode

# web (needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.129)
cd web && npm install && npm run dev                      # builds wasm, serves http://localhost:5173
node web/tools/chrome-check.mjs http://localhost:5173/ shot.png   # headless real-Chrome check (GPU on)
# web profiling mode: append ?gpu-timestamps=1 to the URL
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

## Later
- Better damping than global velocity damping (e.g. damping only along constraints, or in the solver itself), so the drape rests faster without slowing free fall.
- Cut dispatch count if the browser overhead is high: fewer colours, or merging stretch and bend into one coloured pass.
