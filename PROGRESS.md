# Progress

Machine used so far: MacBook Air, Apple M2 (integrated GPU), macOS (Darwin 27). Rust 1.99.0, wgpu 30.0.1, wasm-bindgen 0.2.129, Vite 8.3.1, Chrome 150.

## How to run

```sh
# native
cargo run -p drape-native --release -- info              # adapter report JSON
cargo run -p drape-native --release -- snapshot out.ppm  # headless render check
cargo run -p drape-native --release                       # winit viewer
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

## Later
- (nothing yet)
