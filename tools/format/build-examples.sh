#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Regenerates the example projects from the sample garments' sidecars (vitryne convert): the
# folder form in assets/examples/<garment>.vtry/ (committed, diffable) and the zip form in
# bench-out/examples/<garment>.vtry, then validates both against the schemas.
# usage: tools/format/build-examples.sh          (needs cargo; python3 with jsonschema)
set -eu
cd "$(dirname "$0")/../.."
(cd packages/vitryne-engine && cargo build --release -p vitryne-cli --locked)
vitryne=packages/vitryne-engine/target/release/vitryne
out=bench-out/examples
mkdir -p "$out"
for toml in assets/garments/*/garment.toml; do
  g=$(basename "$(dirname "$toml")")
  "$vitryne" convert "$toml" "assets/examples/$g.vtry/" 2> /dev/null
  "$vitryne" convert "$toml" "$out/$g.vtry" 2> /dev/null
done
python3 -I tools/format/validate.py assets/examples/*.vtry "$out"/*.vtry
