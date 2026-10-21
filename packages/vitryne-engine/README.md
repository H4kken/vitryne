# vitryne-engine

The Rust side of Vitryne: the GPU cloth solver, its renderer, the `.vtry` file format, patterns
(DXF-AAMA, meshing, placement, sewing), the wasm build the editor runs, and the `vitryne` CLI and
native viewer. One Cargo workspace; its `target/` is here.

| Crate | Folder | What |
|---|---|---|
| `vitryne-solver` | [solver/](solver/) | The solver and its public API (`Engine`, `Body`, `Garment`, `Simulation`, `SimSettings`), its WGSL shaders, benchmarks, the regression runner. No rendering, no UI. |
| `vitryne-render` | [render/](render/) | Viewport rendering: cloth and body shading, the orbit camera, picking, seams in 3D. |
| `vitryne-format` | [format/](format/) | The `.vtry` file family: types, zip or folder, validation, migrations. No engine dependency. |
| `vitryne-pattern` | [pattern/](pattern/) | DXF-AAMA import and export, the `garment.toml` sidecar, meshing, placement, sewing suggestions; turns a `.vtry` into what the solver drapes. |
| `vitryne-wasm` | [wasm/](wasm/) | The browser build: the editor worker's API (`VtryFile`, `PreparedScene`, `Viewport`) and the bench page's. |
| `vitryne-cli` | [cli/](cli/) | The `vitryne` binary: viewer, `bench`, `regress`, `convert`, `export`, ... (usage at the top of [cli/src/main.rs](cli/src/main.rs)). |
| | [tests/](tests/) | The golden drapes `vitryne regress` compares against, and the drawn skirt it drapes. |

Every component of the solver and the paper it comes from: [docs/ALGORITHMS.md](../../docs/ALGORITHMS.md).

## Build and check

From the repository root (the Makefile puts `~/.cargo/bin` on the `PATH`):

```sh
make cli            # builds packages/vitryne-engine/target/release/vitryne
make check-quick    # rustfmt, clippy (native and wasm32), cargo test
make regress        # the golden drapes (needs a GPU); make regress-update after an intended change
```

`cargo` itself runs in this folder (`cd packages/vitryne-engine && cargo test`). The `vitryne`
binary runs from the repository root, where its default paths (`assets/`, the goldens, the SDF
cache in `target/sdf-cache/`) point:

```sh
packages/vitryne-engine/target/release/vitryne view --garment assets/examples/trousers.vtry
packages/vitryne-engine/target/release/vitryne bench --garment assets/examples/tshirt.vtry --verts 10000
```

## Rules

- WebGPU core only: `Features::empty()`, `Limits::default()`, one set of WGSL for every target.
- Published methods only in the solver, cited where implemented and in docs/ALGORITHMS.md.
- The editor uses the engine only through its public API and the wasm bindings.
- Joins, placement, measuring and grading: read [docs/PATENTS.md](../../docs/PATENTS.md) first.

More in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Who to ask

Mathis Grimberg, the maintainer; open an issue on [GitHub](https://github.com/H4kken/vitryne/issues).
