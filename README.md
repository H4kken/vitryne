# Vitryne

**Open-source garment design in the browser.** Import a sewing pattern, place it around a body,
sew it, pick a fabric, and watch it drape in 3D, on your own GPU, for free.

> **Status: early development.** The cloth engine works, natively and in the browser, and the
> editor's first shell opens, edits and saves projects. Importing and sewing patterns in the
> editor come next. [PROGRESS.md](PROGRESS.md) tracks the work toward the first usable version.

<!-- A GIF of the drape goes here (M11). -->

## What works today

- A GPU cloth solver (XPBD) running on WebGPU, with the same Rust code and WGSL shaders natively
  and in the browser: stretch, bending, sewing, body contact, self-collision and untangling.
- DXF-AAMA pattern import, with a small sidecar file that says which edges are sewn and where
  each piece starts around the body.
- Three sample garments (a T-shirt, trousers and a hoodie, from FreeSewing) and a sample avatar
  (MakeHuman).
- The editor shell in the browser: open a `.vtry` project (or a sample), see its pattern in 2D
  and its drape in 3D, drag the cloth, edit the fabric, names and simulation settings with undo,
  and save, with a recovery copy if the tab closes.
- A native viewer and benchmarks. On an Apple M2, a 20k-vertex T-shirt comes
  to rest in about 1 s, and dragging it runs at 55+ fps in Chrome and Safari.

The engine's history and numbers from the original spikes are in [docs/history/](docs/history/).

## Planned for the first version

Open a DXF pattern → place the pieces → sew them → pick a fabric → drape → save the project →
export glTF or OBJ, all in the browser, with nothing to install and no account.

## Browser requirements

Vitryne needs **WebGPU**. Tested so far: Chrome and Safari on an Apple M2 Mac. Not yet tested:
Firefox, and Windows. Without WebGPU, the editor says so and names the browsers that work.
Saving over the opened file needs the File System Access API (Chrome, Edge); elsewhere a save
downloads the file.

## Try it locally

```sh
cd app && pnpm install --frozen-lockfile && pnpm run dev       # then open http://localhost:5173
```

You need Rust, the wasm target, `wasm-bindgen-cli` and Node; see
[CONTRIBUTING.md](CONTRIBUTING.md) for the full list and for the native build.

## Privacy

Vitryne is local-first: no account, no telemetry, and no network requests except loading the
app and its assets. Your files stay on your machine.

## Licence

Vitryne's code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

**What you make with Vitryne is yours.** Patterns, garments and other files you create with it
are not covered by the AGPL, and you can use them however you like, commercially or not.

The bundled sample assets keep their own licences (MakeHuman avatar: CC0; FreeSewing patterns:
MIT); see [assets/LICENSES.md](assets/LICENSES.md).

## Contributing

Contributions are welcome. Every commit needs a DCO sign-off (`git commit -s`), and `./check`
has to pass. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.
