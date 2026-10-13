#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The local check. It must pass before every milestone commit (there is no CI).
# usage: ./check [--quick]      --quick: Rust only (fmt, clippy, tests), no web build or regression drapes
# Needs: cargo with clippy + rustfmt, the wasm32-unknown-unknown target, wasm-bindgen-cli 0.2.129,
# Node 22+, python3, and a GPU for the drapes. See CONTRIBUTING.md.
set -eu
cd "$(dirname "$0")"

quick=0
[ "${1:-}" = "--quick" ] && quick=1
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
cargo fmt --all --check

step "clippy (native)"
cargo clippy --workspace --all-targets --locked -- -D warnings

step "clippy (wasm32)"
cargo clippy -p drape-web --target wasm32-unknown-unknown --locked -- -D warnings

step "tests"
cargo test --workspace --locked

if [ "$quick" = 1 ]; then
  printf '\ncheck: quick checks passed (web build and drapes skipped)\n'
  exit 0
fi

step "web: wasm build + production bundle"
[ -d web/node_modules ] || (cd web && npm ci)
(cd web && npm run build)

step "web: syntax check"
# The viewer is plain JS until the TypeScript app arrives (M6); then this becomes tsc + eslint.
for f in $(git ls-files 'web/*.js' 'web/*.mjs' 'tools/*.mjs'); do node --check "$f"; done
echo ok

step "app: typecheck + lint"
echo "skipped: app/ arrives in M6"

step "example projects are up to date"
# examples/*.vtry are `drape convert` output; after a change to the converter or a sidecar,
# run tools/format/build-examples.sh and commit the result.
cargo build --release -p drape-native --locked
rm -rf bench-out/examples-check && mkdir -p bench-out/examples-check
for toml in assets/garments/*/garment.toml; do
  g=$(basename "$(dirname "$toml")")
  target/release/drape convert "$toml" "bench-out/examples-check/$g.vtry/" > /dev/null 2>&1
  diff -r "examples/$g.vtry" "bench-out/examples-check/$g.vtry" > /dev/null \
    || fail "examples/$g.vtry differs from drape convert's output (run tools/format/build-examples.sh)"
done
echo ok

step "regression drapes (golden suite)"
# The three example projects at 10k vertices, 600 frames each, against tests/regression/*.json and *.pos:
# rest frame, final shape, penetration, self-intersections, strain, seam gap. After an
# intended change: `target/release/drape regress --update`, and say why in the commit.
cargo build --release -p drape-native --locked
target/release/drape regress 2> /dev/null || fail "regression drapes differ from the golden results"

printf '\ncheck: all passed\n'
