# Vitryne

**Open-source garment design in the browser.** Import a sewing pattern, place it around a body,
sew it, pick a fabric, and watch it drape in 3D, on your own GPU, for free.

<p align="center">
  <img src="docs/media/drape.gif" alt="Vitryne 3D cloth drape in real time" width="512" />
</p>

Vitryne runs a real-time GPU cloth solver (XPBD) directly in your web browser using WebGPU and
WebAssembly, backed by the same Rust codebase and WGSL shaders that run natively. Everything stays
on your machine: no account needed, and no telemetry. Cloud storage is optional, on an instance
anyone can run ([docs/CLOUD.md](docs/CLOUD.md)).

---

## Features

- **Real-time GPU Cloth Simulation:** Extended Position Based Dynamics (XPBD) cloth solver with
  non-linear stretch, bending, sewing springs, SDF avatar collision, and self-collision untangling.
- **2D & 3D Garment Design:** Interactive 2D pattern inspection and flat arrangement alongside a 3D
  viewport with orbit camera, interactive cloth pinching/pulling, and placement handles.
- **Whole-Edge Sewing Engine:** Two-click seam creation with chain detection and automatic geometric
  seam suggestions that pair matching seams in seconds. Designed deliberately to avoid proprietary
  free-sewing patent restrictions ([docs/PATENTS.md](docs/PATENTS.md)).
- **Physical Fabric Presets:** Calibrated physical fabric parameters (weight, directional stretch and
  bending stiffness, thickness, friction) for Cotton jersey, Denim, Poplin shirting, Fleece, and Wool
  suiting ([docs/FABRICS.md](docs/FABRICS.md)), with multi-material simulation support.
- **Production 3D Export:** Export draped 3D garments to standard glTF 2.0 (`.glb`) or Wavefront
  OBJ (`.obj` + `.mtl`) with real-world 1:1 metre scale, vertex normals, double-sided PBR cloth
  materials, and UVs mapped directly to 2D pattern coordinates for texture printing.
- **Pattern Export (DXF-AAMA):** Export the pattern pieces back to cutting and CAD tools as
  DXF-AAMA (ASTM D6673), in millimetres, with corners, notches, grain lines, internal lines,
  quantities and cut-on-fold pieces as halves with a mirror line. Outlines are sewing lines (no
  seam allowance yet).
- **Local-First & Private:** Saves to standard `.vtry` zip or folder files. Your designs never leave
  your device.

---

## Quickstart: From DXF to 3D Drape in 5 Steps

You can start from one of the bundled example projects (T-shirt, Trousers, Hoodie) or import your
own DXF pattern (such as an open-source pattern from [FreeSewing](https://freesewing.org/)):

1. **Launch the Editor:**
   Open the hosted app or start locally with `cd app && pnpm run dev` and navigate to
   `http://localhost:5173`.
2. **Import or Start from an Example:**
   - On the start screen, click any example garment (e.g., **T-shirt (Teagan)**) to open it immediately.
   - Or click **Import your own pattern** (or drop a `.dxf` file). To follow along with a raw pattern,
     select `assets/garments/tshirt/tshirt.dxf`. In the import dialog, preview the pieces and click
     **Accept and import**.
3. **Inspect Placement:**
   - In **3D view** (press `1` or select the 3D tool), the pattern pieces appear positioned around
     the MakeHuman body avatar. Use the **Select** tool to adjust cylinder wraps or offsets with 3D handles.
   - Switch to **Flat view** (press `2`) to see the 2D layout and piece boundaries.
4. **Sew the Seams:**
   - Open the **Seams** panel on the right rail (the link icon <kbd>🔗</kbd>).
   - Click **Suggest seams**. Vitryne inspects edge lengths and piece geometry, proposing all 10 seams
     (side seams, shoulders, armhole sleeve caps, and underarms).
   - Click **Accept all** to sew them instantly, or use the **Sew** tool in flat view to click matching
     edge pairs manually.
5. **Simulate, Adjust Fabric & Export:**
   - The cloth drapes in real time around the avatar. Use the **Pinch** tool to grab and pull the
     fabric to check fit and drape.
   - Open the **Fabric** panel to switch presets (e.g. from Cotton jersey to Heavy denim or Wool) or
     tune weight and stiffness sliders.
   - In the **⋯** menu (top right), choose **Export…**, select **glTF 2.0 (.glb)** or **OBJ**,
     and download your draped 3D garment ready for Blender, Unreal Engine, or web 3D viewers; or
     select **Pattern (.dxf)** for the pieces as DXF-AAMA, for cutting and CAD tools. From the
     command line: `drape export examples/tshirt.vtry --out tshirt.dxf`.

---

## Browser Requirements

Vitryne requires **WebGPU** support.

| Browser | Platform | Status | Notes |
|---|---|---|---|
| **Google Chrome / Chromium** | macOS, Windows, Linux, Android | ✅ Supported | Chrome 113+ has WebGPU enabled by default. Supports native file picker (`showSaveFilePicker`). |
| **Microsoft Edge** | Windows, macOS | ✅ Supported | Edge 113+ with WebGPU enabled. |
| **Apple Safari** | macOS, iOS, iPadOS | ✅ Supported | Safari 18+ (macOS 14.4 Sonoma, macOS 15 Sequoia). Uses standard browser download for saves/exports. |
| **Mozilla Firefox** | Windows, macOS, Linux | ⚠️ Supported behind flag | Enable `dom.webgpu.enabled = true` in `about:config` (Firefox Nightly / Release). |

If your browser or device lacks WebGPU support, Vitryne displays an informative fallback notice
explaining the requirement.

---

## Known Limitations (Honestly)

Vitryne is under active development. Here is what does not work yet:

- **Whole-edge seams only:** Seams connect whole boundary edges between corners. Vitryne deliberately
  avoids free-hand partial seam drafting and notch-to-notch segment sewing in the UI to stay clear of
  competitor patent claims ([docs/PATENTS.md](docs/PATENTS.md)). Split lines must be in the pattern.
- **Single-layer garments:** The solver simulates one layer of cloth per panel. Complex multi-layer
  constructions (linings, fusible interfacings, quilted batting, or pockets sewn on top of bodies)
  are not yet supported.
- **Static rigid avatar collider:** The MakeHuman body is baked into a signed distance field (SDF).
  Dynamic skeletal rigging, avatar posing, and walking animations are planned for future versions.
- **Woven strain settling:** On high-tension woven garments (like the trousers example), resting edge
  strain reaches ~5.4% p99 under one XPBD iteration per substep, compared to the ideal 3% woven target.
- **Hoodie collar junction:** The hoodie test garment features extreme geometry at the back-neck
  junction and does not come to a static rest; it retains persistent self-intersections in tight folds.
- **No WebGL fallback:** The solver requires compute shaders and storage buffers available only in
  WebGPU.

---

## Development & CLI

### Prerequisites

- Rust 1.85+ with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen-cli` 0.2.129: `cargo install wasm-bindgen-cli --version 0.2.129`
- Node.js 22+ and pnpm 10: `corepack enable`
- A GPU with Vulkan, Metal, or DirectX 12 drivers.

### Commands

```sh
# Run the complete test suite (Rust fmt, clippy, unit tests, web check, golden drapes)
./check.sh

# Quick Rust-only check
./check.sh --quick

# Run the web editor locally
cd app && pnpm install --frozen-lockfile && pnpm run dev
# Open http://localhost:5173

# Run the native viewer
cargo run --release -p drape-native -- view --garment examples/tshirt.vtry

# Run headless native benchmarks
cargo run --release -p drape-native -- bench --scene garment --garment examples/tshirt.vtry --verts 10000
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, code formatting, and sign-off rules.

### Hosting, with or without accounts

One command runs the editor (no account, nothing stored server-side):

```sh
docker compose -f deploy/docker-compose.yml up -d --build    # then open http://localhost:8000
```

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `deploy/.env` to add optional accounts and cloud
storage on a Supabase project (anonymous first, email later, data export and account deletion
built in). See [docs/CLOUD.md](docs/CLOUD.md) for the backend, running it on a domain or Coolify,
and developing with a local Supabase (`pnpm run dev:cloud`). Any other static host works too
([docs/HOSTING.md](docs/HOSTING.md)).

---

## Licence & Intellectual Property

Vitryne's source code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

### **What you make with Vitryne is yours**

**Garments, patterns, 3D meshes, textures, `.vtry` project files, and any other files you create or export with Vitryne are strictly yours.** They are user data and output, not covered by the AGPL, and you retain complete ownership to use, modify, distribute, or sell them commercially or non-commercially without restriction.

Bundled sample assets preserve their respective open licences:
- **MakeHuman Avatar Mesh:** [Creative Commons Zero (CC0 1.0)](assets/LICENSES.md).
- **FreeSewing Patterns (Teagan T-shirt, Titan Trousers, Hugo Hoodie):** [MIT License](assets/LICENSES.md).
