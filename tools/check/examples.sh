#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The example projects are up to date (`make examples-check`): assets/examples/*.vtry must be
# what `vitryne convert` writes from the sidecars. After a change to the converter or a sidecar,
# run `make examples` and commit the result. Needs the release CLI (`make` builds it first).
set -eu
cd "$(dirname "$0")/../.."
fail() { printf 'check: FAILED: %s\n' "$*" >&2; exit 1; }

vitryne=packages/vitryne-engine/target/release/vitryne
rm -rf bench-out/examples-check && mkdir -p bench-out/examples-check
for toml in assets/garments/*/garment.toml; do
  g=$(basename "$(dirname "$toml")")
  "$vitryne" convert "$toml" "bench-out/examples-check/$g.vtry/" > /dev/null 2>&1
  diff -r "assets/examples/$g.vtry" "bench-out/examples-check/$g.vtry" > /dev/null \
    || fail "assets/examples/$g.vtry differs from vitryne convert's output (run make examples)"
done
echo ok
