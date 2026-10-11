# WebGPU Garment Drape Spike — Plan for Claude Code

## Goal

Find out, in about 2 weeks, whether garment-grade cloth simulation can run **in the browser on WebGPU** at usable speed, using **one Rust + wgpu codebase** that also runs natively.

This is a **spike**, not a product. Optimize for a clear yes/no answer with numbers. Throwaway code is fine. Scope creep is not.

## Pass / fail criteria

Measured in the browser (Chrome, Safari 26+, Firefox) on a MacBook Air (Apple Silicon) and a mid-range Windows laptop with an integrated GPU:

| Test | Pass |
|---|---|
| T-shirt (10–20k vertices) drapes from initial placement to rest on avatar | < 3 s to rest |
| Interactive drag of cloth (mouse) | ≥ 30 fps |
| Stability: 60 s of simulation, random drags | No NaN, no explosion (max vertex speed < 5 m/s) |
| Body penetration at rest | Max < 2 mm |
| Self-collision (single layer, sleeves/folds) | 0 persistent self-intersections after rest (stretch goal) |
| Native vs browser | Same results within tolerance; browser ≤ 2× slower than native |

**Decision rule at the end:**
- All core tests pass in ≥ 2 browsers → client-side simulation is viable.
- Drape passes, self-collision fails → browser for single-layer preview, server for full sims.
- Drape fails → browser is a viewer only; simulation runs on server GPUs (the same engine, natively).

Record every result in `REPORT.md`, including failures.

## Hard rules for the implementation

1. **WebGPU core only.** Request `wgpu::Features::empty()` and `wgpu::Limits::default()` (the WebGPU defaults) **even on native**, so native results predict browser results. No push constants, no f64, no native-only features. Log adapter limits at startup.
2. **One set of WGSL shaders** shared by native and web. No per-target shader forks.
3. In wasm, use wgpu's **WebGPU backend only** (disable the WebGL fallback) so we measure WebGPU, not WebGL.
4. **No float atomics** (WGSL only has `atomic<i32|u32>`). Use graph coloring or fixed-point i32 accumulation, as described below.
5. The simulation step stays on the GPU. No CPU readback per frame except for the benchmark's sampled metrics.
6. Work milestone by milestone. Commit at the end of each one, and update `PROGRESS.md` with what works, numbers, and open problems.
7. Write the headless benchmark early (M1) so every later milestone produces comparable numbers.

## Repository layout

```
drape-spike/
├── Cargo.toml                 # workspace
├── crates/
│   ├── drape-core/            # solver: buffers, pipelines, step(), metrics
│   │   └── shaders/*.wgsl
│   ├── drape-assets/          # procedural t-shirt pattern, triangulation, body loading, SDF bake
│   ├── drape-native/          # winit viewer + `bench` CLI (headless, prints JSON)
│   └── drape-web/             # wasm-bindgen entry, canvas viewer, bench page
├── web/                       # minimal Vite page hosting the wasm (no framework needed)
├── assets/body/               # test avatar mesh (OBJ)
├── PROGRESS.md
└── REPORT.md
```

Suggested crates: `wgpu`, `winit`, `glam`, `bytemuck`, `pollster` (native), `wasm-bindgen`, `wasm-bindgen-futures`, `web-sys`, `spade` or `earcutr` (triangulation), `parry3d` (CPU-side intersection checks in benchmarks only), `serde_json`.

## Test assets

- **Body:** a CC0 human mesh in A-pose, about 20–50k triangles. A MakeHuman export is CC0. Put it in `assets/body/`. An ANSUR II–driven parametric body comes later; it's out of scope here.
- **Garment:** a **procedural** T-shirt pattern generated in code, so there's no DXF parser in the spike: front panel, back panel, 2 sleeves as 2D polygons in metres, with seams defined as pairs of polyline segments (side seams, shoulder seams, sleeve caps, underarm seams). DXF-AAMA import is optional and comes after the spike.
- **Meshing:** triangulate each panel with roughly uniform triangles (Delaunay plus interior points or a simple grid-clip), target edge length 0.8–1.2 cm → about 10–20k vertices total. Make edge length a parameter so we can benchmark 5k / 10k / 20k / 40k.

## Technical approach

**Integrator:** XPBD with **small steps** (Macklin et al. 2019): many substeps per frame (start at 15–20), 1 constraint iteration per substep. Gravity, simple velocity damping.

**Constraints:**
- *Stretch:* per-edge distance constraints, or per-triangle (better anisotropy later). Use compliance values that make cotton-like fabric.
- *Bending:* dihedral or isometric bending on edge-adjacent triangle pairs.
- *Sewing:* resample the two sides of each seam to equal vertex counts and add zero-rest-length distance constraints. **Ramp them in** (high compliance → low over about 0.5 s) to avoid explosions.
- *Body collision:* bake a **signed distance field** of the avatar on the CPU at load (grid about 2–4 mm, or 128³ to start), upload as a storage buffer or 3D texture, sample trilinearly in the shader, project vertices out to `sdf > thickness` (about 2 mm), and apply friction.
- *Self-collision (M4):* spatial hash rebuilt each substep via **counting sort** (count with `atomic<u32>` → prefix sum → scatter), then vertex–vertex repulsion within thickness. Point-point only for the spike; triangle-level continuous collision is out of scope.

**Parallelism without float atomics:**
- Stretch, bend and sew: **graph-color** the constraints on the CPU at load and dispatch one pass per color (Gauss-Seidel per color, no write conflicts).
- Collisions: Jacobi-style. Accumulate corrections as **fixed-point i32** with `atomicAdd`, plus a count, then apply the averaged correction.

**Initial placement:** a big part of real garment tools. For the spike, place each panel as a curved sheet at a fixed offset from the body: front panel in front of the torso, back panel behind, sleeves wrapped as half-cylinders around the arms. Then let sewing pull them together. Hardcode positions for this one garment.

**Rendering:** simple lit shading in wgpu (normals recomputed on the GPU), orbit camera. No PBR, no textures.

**Metrics (`drape-core::metrics`):**
- frame time and sim time per frame (use timestamp queries where available, otherwise CPU timing around `queue.submit` + `on_submitted_work_done`)
- time to rest: kinetic energy below a threshold for 30 consecutive frames
- max vertex speed, NaN check
- max body penetration: sample the SDF at vertices (readback, sampled every N frames)
- self-intersections at rest: CPU check with a triangle BVH (parry3d) on a readback, benchmark only

## Milestones

### M0 — Setup (½ day)
- Workspace, crates, CI-free local build for native and wasm (`wasm-pack` or `wasm-bindgen-cli` + Vite).
- Device init with WebGPU-default limits; print adapter info and limits on both targets.
- **Done when:** a coloured triangle renders natively and in Chrome, through the WebGPU backend.

### M1 — GPU cloth sheet (1 day)
- Grid cloth (e.g., 100×100) pinned at two corners, XPBD stretch and bend, graph-colored passes, sphere collision analytically.
- Headless `bench` CLI: runs N frames, prints JSON metrics.
- **Done when:** stable drape natively, bench JSON printed, numbers recorded in `PROGRESS.md`.

### M2 — T-shirt on the body, native (3 days)
- Procedural pattern → meshing → initial placement → sewing constraints with ramp-in.
- Body OBJ loading, SDF bake, SDF collision with thickness and friction.
- **Done when:** the T-shirt drapes onto the avatar and rests without explosions at 10k and 20k vertices. Bench numbers recorded.

### M3 — Browser port and parity (2 days)
- Same `drape-core` in wasm, render to canvas, mouse drag of nearest vertex (ray pick on CPU from a sampled position readback is fine).
- Bench page: a button runs the same benchmark as the CLI and shows the JSON (with a copy button).
- **Done when:** runs in Chrome, Safari and Firefox. Native vs browser numbers side by side in `PROGRESS.md`.

### M4 — Self-collision (2–3 days, stretch)
- Spatial hash via counting sort, vertex–vertex repulsion, tuned so folds and sleeves don't pass through each other.
- **Done when:** self-intersection count at rest is reported; target 0 persistent.

### M5 — Benchmarks and report (1 day)
- Run the full matrix: {5k, 10k, 20k, 40k vertices} × {self-collision off/on} × {native, Chrome, Safari, Firefox} × {available machines}.
- Fill in `REPORT.md`: results table, pass/fail against the criteria above, the decision-rule outcome, main bottlenecks (which pass dominates GPU time), and browser-specific bugs found.

## Explicitly out of scope

DXF import, fabric calibration, multiple layers, avatar parametrization (ANSUR), rendering quality, UI, collaboration, Next.js, server deployment. If something tempting comes up, note it in `PROGRESS.md` under "Later" and move on.

## Known risks to watch

- **Sewing explosions** at start → ramp sewing compliance; clamp max correction per substep.
- **Graph coloring** producing too many colors (many dispatches) → measure dispatch overhead; consider fewer substeps with more iterations.
- **Safari/Metal differences** in workgroup size limits or timestamp queries → keep workgroup size 64, feature-detect timestamps.
- **Buffer limits** (default `maxStorageBufferBindingSize` = 128 MB) → fine at these sizes, but log usage.
- **SDF resolution** too coarse at wrists/armpits → acceptable for the spike; note penetration hotspots.
