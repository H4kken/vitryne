#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Adds the generated parts to the example projects (examples/*.vtry, folder form), packs each
# into a .vtry zip under bench-out/examples/, and validates both forms.
# usage: tools/format/build-examples.sh          (needs python3 with jsonschema)
set -eu
cd "$(dirname "$0")/../.."
out=bench-out/examples
mkdir -p "$out"
for dir in examples/*.vtry; do
  for avatar in "$dir"/avatars/*/; do
    [ -f "$avatar/body.glb" ] || python3 -I tools/format/obj2glb.py assets/body/makehuman_body_m.obj "$avatar/body.glb"
  done
  zip="$out/$(basename "$dir")"
  rm -f "$zip"
  # mimetype first and stored (zip -0), like EPUB and ODF; then everything else, binaries stored.
  (cd "$dir" && zip -q -X -0 "$OLDPWD/$zip" mimetype \
    && zip -q -X -D -r -n .glb:.bin "$OLDPWD/$zip" . -x mimetype -x '.*')
  python3 -I tools/format/validate.py "$dir" "$zip"
done
