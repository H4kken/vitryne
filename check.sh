#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The local check. It must pass before every milestone commit (there is no CI).
# usage: ./check [--quick]      --quick: Rust only (fmt, clippy, tests), no web build or regression drapes
# Needs: cargo with clippy + rustfmt, the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129,
# Node 22+ with pnpm 10, python3, and a GPU for the drapes. See CONTRIBUTING.md.
set -eu
cd "$(dirname "$0")"

quick=0
[ "${1:-}" = "--quick" ] && quick=1
engine=packages/vitryne-engine
vitryne=$engine/target/release/vitryne
step() { printf '\n== %s\n' "$*"; }
fail() { printf 'check: FAILED: %s\n' "$*" >&2; exit 1; }

step "repository hygiene"
# Every source file carries the licence header.
missing=$(git ls-files '*.rs' '*.wgsl' '*.js' '*.mjs' '*.ts' '*.tsx' '*.py' '*.sh' '*.html' check \
  | xargs grep -L 'SPDX-License-Identifier: AGPL-3.0-or-later' || true)
[ -z "$missing" ] || fail "missing SPDX header in: $missing"
# Nothing over 1 MiB outside Git LFS (see .gitattributes and CONTRIBUTING.md).
big=$(git ls-files -z ':(attr:!filter)' | xargs -0 wc -c 2>/dev/null \
  | awk '$2 != "total" && $1 > 1048576 { print $2 " (" int($1 / 1024) " KiB)" }')
[ -z "$big" ] || fail "files over 1 MiB must go through Git LFS or be generated: $big"
echo ok

step "rustfmt"
(cd "$engine" && cargo fmt --all --check)

step "clippy (native)"
(cd "$engine" && cargo clippy --workspace --all-targets --locked -- -D warnings)

step "clippy (wasm32)"
(cd "$engine" && cargo clippy -p vitryne-wasm --target wasm32-unknown-unknown --locked -- -D warnings)

step "tests"
(cd "$engine" && cargo test --workspace --locked)

if [ "$quick" = 1 ]; then
  printf '\ncheck: quick checks passed (web build and drapes skipped)\n'
  exit 0
fi

step "app: wasm, assets, production bundle"
# pnpm run build: the wasm (browser + Node), the bundled examples and SDFs, tsc, vite build.
(cd packages/vitryne-web && pnpm install --frozen-lockfile)
(cd packages/vitryne-web && pnpm run build)

step "app: format types up to date, typecheck, lint, tests"
# The TypeScript types and validators are generated from docs/format/schema/; the tests run
# the commands and guardrails against the worker's Rust (Node build of the same wasm),
# including random edit sessions on the three examples (fast-check).
(cd packages/vitryne-web && pnpm run check)

step "tools: syntax check"
for f in $(git ls-files 'tools/*.mjs'); do node --check "$f"; done
echo ok

step "cloud: syntax check"
# The backend and the web image are checked by packages/vitryne-cloud/tests/ and
# packages/vitryne-cloud/deploy/smoke.sh (they need Docker and the local Supabase stack;
# docs/CLOUD.md, Checking).
for f in $(git ls-files 'packages/vitryne-cloud/tests/*.mjs' 'packages/vitryne-web/scripts/*.mjs'); do node --check "$f"; done
for f in $(git ls-files 'packages/vitryne-cloud/deploy/*.sh'); do bash -n "$f"; done
echo ok

step "example projects are up to date"
# assets/examples/*.vtry are `vitryne convert` output; after a change to the converter or a
# sidecar, run tools/format/build-examples.sh and commit the result.
(cd "$engine" && cargo build --release -p vitryne-cli --locked)
rm -rf bench-out/examples-check && mkdir -p bench-out/examples-check
for toml in assets/garments/*/garment.toml; do
  g=$(basename "$(dirname "$toml")")
  "$vitryne" convert "$toml" "bench-out/examples-check/$g.vtry/" > /dev/null 2>&1
  diff -r "assets/examples/$g.vtry" "bench-out/examples-check/$g.vtry" > /dev/null \
    || fail "assets/examples/$g.vtry differs from vitryne convert's output (run tools/format/build-examples.sh)"
done
echo ok

step "regression drapes (golden suite)"
# The three example projects and the drawn skirt at 10k vertices, 600 frames each, against
# packages/vitryne-engine/tests/*.json and *.pos: rest frame, final shape, penetration,
# self-intersections, strain, seam gap. After an intended change:
# `packages/vitryne-engine/target/release/vitryne regress --update`, and say why in the commit.
(cd "$engine" && cargo build --release -p vitryne-cli --locked)
"$vitryne" regress 2> /dev/null || fail "regression drapes differ from the golden results"

printf '\ncheck: all passed\n'
