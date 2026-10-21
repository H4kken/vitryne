# Contributing to Vitryne

Thanks for helping. This page covers the sign-off we need on every commit, how to build and run
Vitryne, and the local check every change has to pass.

## Sign your commits (DCO)

Vitryne uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO 1.1)
instead of a contributor licence agreement. By adding a `Signed-off-by` line to a commit, you
certify that you wrote the change or otherwise have the right to submit it under the project's
licence (AGPL-3.0-or-later).

Sign off with `-s`:

```sh
git commit -s -m "Explain the change"
```

This adds `Signed-off-by: Your Name <you@example.com>`, using your `user.name` and `user.email`.
Use your real name. Every commit in a pull request needs it. If you forgot, run
`git commit --amend -s` for the last commit, or `git rebase --signoff <base>` for several.

The commits imported from the spike (before the first signed-off commit) predate this rule.

## Licence of contributions

Code is AGPL-3.0-or-later. New source files start with an SPDX header, in that file type's
comment syntax:

```rust
// SPDX-License-Identifier: AGPL-3.0-or-later
```

Assets keep their own licences, listed in [assets/LICENSES.md](assets/LICENSES.md). Add a row
there when you add an asset.

## Build and run

**Prerequisites:**
- Rust (stable; tested with 1.99), with the `clippy` and `rustfmt` components and the wasm target:
  `rustup target add wasm32-unknown-unknown`
- `wasm-bindgen-cli`, the exact version the crate pins:
  `cargo install wasm-bindgen-cli --version 0.2.129`
- Node 22 or newer with [pnpm](https://pnpm.io) 10 (`corepack enable pnpm`, or any install;
  `packageManager` in each `package.json` names the version), and Python 3 (for the scripts in
  `tools/`)
- A GPU with Metal, Vulkan or DX12 for the native build, and a browser with WebGPU for the web
  build

**Native:**

```sh
cargo run -p vitryne-cli --release -- bench --garment assets/examples/tshirt.vtry --verts 10000
cargo run -p vitryne-cli --release -- view --garment assets/examples/tshirt.vtry
```

The first run bakes the body SDF (about 1–2 s) and caches it in `packages/vitryne-engine/target/sdf-cache/`.

**Browser:**

```sh
cd packages/vitryne-web
pnpm install --frozen-lockfile
pnpm run dev        # starts a local Supabase (Docker), builds the wasm, exports the examples and SDFs,
                    # serves http://localhost:5173 (`--local`: that Supabase even if packages/vitryne-web/.env.local names another)
pnpm run dev:app    # the same without a backend: enough for the bench page
pnpm run build      # production build in packages/vitryne-web/dist
pnpm run check      # format types up to date, tsc, eslint, vitest (needs `pnpm run wasm` and `pnpm run assets` once)
```

The editor (`packages/vitryne-web/`) is TypeScript, React, Tailwind and shadcn/ui; how it is built, and the
rules it follows, are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). After changing
`docs/format/schema/`, run `pnpm run gen:format` to regenerate the types and validators.

The app needs cross-origin isolation, so whatever serves it must send two headers (the dev
server and `vite preview` already do); [docs/HOSTING.md](docs/HOSTING.md) has them for nginx,
Caddy and static hosts.

The bench page is at `/bench.html`. Benchmark scripts are in [tools/bench/](tools/bench/), and
their output goes to `bench-out/`, which git ignores.

## The local check

There's no CI. Run this before you push; it has to pass:

```sh
make check            # everything: about 1–2 minutes once the caches are warm
make check-quick      # Rust only: fmt, clippy (native and wasm32), tests
```

It checks:
- SPDX headers, and that no file over 1 MiB is committed outside Git LFS;
- `cargo fmt --check`;
- `cargo clippy -D warnings`, natively and for wasm32;
- `cargo test` (including the worker's open, edit, undo, save path on the three examples);
- the app: the wasm build, the production bundle, the format types and validators up to date with
  `docs/format/schema/`, `tsc`, eslint, and vitest (commands and guardrails, and random edit
  sessions, pattern tools included, checked against the worker's Rust after every step);
- that `assets/examples/` is what `vitryne convert` writes;
- the golden regression suite on your GPU (`vitryne regress`): the three sample garments and a
  skirt drawn in the editor (`packages/vitryne-engine/tests/skirt.vtry`) at 10k vertices, 600 frames, compared with `packages/vitryne-engine/tests/` on rest frame, final shape (0.5 mm;
  20 mm for the hoodie, whose neck junction is chaotic), penetration, self-intersections, edge
  strain and seam gap. After an intended change, re-record with
  `packages/vitryne-engine/target/release/vitryne regress --update` and explain the difference in the commit message. The
  skirt's file is made by the editor's own commands (`packages/vitryne-web/src/document/skirt.test.ts`, which
  fails if the file differs); after an intended change to them, re-record it with
  `SKIRT_UPDATE=1 pnpm exec vitest run src/document/skirt.test.ts` in `packages/vitryne-web/`.

## Rules for engine changes

- **WebGPU core only.** Every target uses `Features::empty()` and `Limits::default()`, one set
  of WGSL shaders, and only the WebGPU backend in wasm. The device setup asserts it.
- **Engine and UI stay separate.** Engine crates have no UI code. The UI talks to the engine
  only through its public API and the worker message protocol.
- **Published methods only** in the solver. Cite the paper in a comment where it's implemented,
  and in `docs/ALGORITHMS.md`.
- **Don't loosen a quality criterion to make it pass.** If a target is wrong, change it in its
  own commit, with the reasoning in `docs/PROGRESS.md`, before the run it affects.

## Large files

- Generated data isn't committed: SDF bakes, benchmark output, build output.
- Binary assets over 1 MiB go through [Git LFS](https://git-lfs.com/). The patterns are in
  [.gitattributes](.gitattributes); run `git lfs install` once before adding one.
- `make check` fails if a file over 1 MiB is committed outside LFS.
