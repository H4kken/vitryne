---
title: "Contributing"
icon: GitMerge
description: "Building Vitryne, the checks, and how to send a change."
---

<!-- Copied from CONTRIBUTING.md. -->

Thanks for helping. This page covers the sign-off we need on every commit, how to open a pull
request, how to build and run Vitryne, and the check every change has to pass. Found a bug or
have an idea? [Open an issue](https://github.com/H4kken/vitryne/issues/new/choose). A security
problem goes through [SECURITY.md](https://github.com/H4kken/vitryne/blob/main/SECURITY.md) instead.

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

## Pull requests

1. **Say what you plan first** for anything bigger than a fix: an issue, or a comment on one.
   Some features have to be designed around a competitor's patents (joining pieces, placement,
   measuring, resizing: [docs/PATENTS.md](/developers/patents)), and it's better to know before
   you write the code.
2. **Fork, then branch from `main`**, named after the change: `fix/seam-flip`,
   `feat/fabric-presets`, `docs/hosting-nginx`. One topic per pull request; a refactor and a
   feature are two.
3. **Keep up with `main` by rebasing** (`git rebase origin/main`), not merging.
4. **Open the pull request into `main`.** Its title becomes the commit on `main`, in the
   history's form: `type(scope): what changes`, with a type among `feat`, `fix`, `perf`,
   `refactor`, `docs`, `test`, `build`, `ci`, `chore`, and a scope when it helps (`solver`,
   `web`, `cloud`, `format`, `pattern`, `cli`). The template asks for the rest.
5. **CI** runs on every push: `check` (`make check-ci`, everything in [the local
   check](#the-local-check) but the golden drapes) and `dco` (each commit signed off). A
   first-time contributor's run waits for a maintainer to start it.
6. **A maintainer reviews and squash-merges it.** It needs CI green, one approval and every
   conversation resolved. If your change touches the solver, the mesher, the importer or the
   shaders, run `make regress` on a GPU and say so: CI can't.
7. **A line under Unreleased** in [CHANGELOG.md](https://github.com/H4kken/vitryne/blob/main/CHANGELOG.md) if people will notice the change.

How pull requests are merged and releases made: [docs/MAINTAINING.md](https://github.com/H4kken/vitryne/blob/main/docs/MAINTAINING.md).

## Licence of contributions

Code is AGPL-3.0-or-later. New source files start with an SPDX header, in that file type's
comment syntax:

```rust
// SPDX-License-Identifier: AGPL-3.0-or-later
```

Assets keep their own licences, listed in [assets/LICENSES.md](https://github.com/H4kken/vitryne/blob/main/assets/LICENSES.md). Add a row
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
- `make` (on Windows, WSL or Git Bash)

Everything runs from the repository root through the [Makefile](https://github.com/H4kken/vitryne/blob/main/Makefile); `make` lists the
targets. The code is in three packages, each with a README:
[packages/vitryne-engine](https://github.com/H4kken/vitryne/tree/main/packages/vitryne-engine) (the Rust workspace: solver, renderer, file
format, patterns, wasm build, CLI), [packages/vitryne-web](https://github.com/H4kken/vitryne/tree/main/packages/vitryne-web) (the editor)
and [packages/vitryne-cloud](https://github.com/H4kken/vitryne/tree/main/packages/vitryne-cloud) (the backend and the web image).

**Native:**

```sh
make cli
packages/vitryne-engine/target/release/vitryne bench --garment assets/examples/tshirt.vtry --verts 10000
packages/vitryne-engine/target/release/vitryne view --garment assets/examples/tshirt.vtry
```

Run the binary from the repository root: its default paths are relative to it. The first run
bakes the body SDF (about 1–2 s) and caches it in `packages/vitryne-engine/target/sdf-cache/`.
`cargo` itself runs in `packages/vitryne-engine/`.

**Browser:**

```sh
make setup          # first run: pnpm install, the wasm, the examples and their SDFs
make dev            # starts a local Supabase (Docker) and serves http://localhost:5173
                    # (ARGS=--local: that Supabase even if packages/vitryne-web/.env.local names another)
make dev-app        # the same without a backend: enough for the bench page
make build          # production build in packages/vitryne-web/dist
make test           # cargo test, then format types up to date, tsc, eslint, vitest
```

The editor (`packages/vitryne-web/`) is TypeScript, React, Tailwind and shadcn/ui; how it is
built, and the rules it follows, are in [docs/ARCHITECTURE.md](/developers/architecture). After
changing `docs/format/schema/`, run `pnpm run gen:format` in `packages/vitryne-web/` to
regenerate the types and validators.

The app needs cross-origin isolation, so whatever serves it must send two headers (the dev
server and `vite preview` already do); [docs/HOSTING.md](/self-hosting/static-hosting) has them for nginx,
Caddy and static hosts.

The bench page is at `/bench.html`. Benchmark scripts are in [tools/bench/](https://github.com/H4kken/vitryne/tree/main/tools/bench), and
their output goes to `bench-out/`, which git ignores.

## The local check

Run this before you push; it has to pass:

```sh
make check            # everything: about 1–2 minutes once the caches are warm
make check-ci         # the same without the golden drapes (no GPU needed): what CI runs
make check-quick      # Rust only: fmt, clippy (native and wasm32), tests
tools/check/dco.sh origin/main HEAD   # every commit signed off
```

It checks, one step after another (each is also a target of its own: `make hygiene`,
`make lint`, `make regress`, ...):

- SPDX headers, and that no file over 1 MiB is committed outside Git LFS;
- `cargo fmt --check`, and prettier on the editor;
- `cargo clippy -D warnings`, natively and for wasm32;
- `cargo test` (including the worker's open, edit, undo, save path on the three examples);
- the app: the wasm build, the production bundle, the format types and validators up to date with
  `docs/format/schema/`, `tsc`, eslint, and vitest (commands and guardrails, and random edit
  sessions, pattern tools included, checked against the worker's Rust after every step);
- that `assets/examples/` is what `vitryne convert` writes (`make examples` rewrites them);
- the golden regression suite on your GPU (`make regress`): the three sample garments and a
  skirt drawn in the editor (`packages/vitryne-engine/tests/skirt.vtry`) at 10k vertices, 600
  frames, compared with `packages/vitryne-engine/tests/` on rest frame, final shape (0.5 mm;
  20 mm for the hoodie, whose neck junction is chaotic), penetration, self-intersections, edge
  strain and seam gap. After an intended change, re-record with `make regress-update` and
  explain the difference in the commit message. The skirt's file is made by the editor's own
  commands (`packages/vitryne-web/src/document/skirt.test.ts`, which fails if the file
  differs); after an intended change to them, re-record it with
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
  [.gitattributes](https://github.com/H4kken/vitryne/blob/main/.gitattributes); run `git lfs install` once before adding one.
- `make check` fails if a file over 1 MiB is committed outside LFS.
