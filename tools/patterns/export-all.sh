#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Regenerates the spike-2 test garments (assets/garments/*/*.dxf) from FreeSewing.
# Needs: cd tools/patterns && pnpm install
set -e
cd "$(dirname "$0")"
M=../../assets/body/measurements.json
G=../../assets/garments
# Chest ease 18% (Teagan's default is 12%): a relaxed tee. We measured that the avatar's raised
# arms stretch the 12% armholes by ~10% in any solver; see docs/PROGRESS.md, Fabric stretch.
node export-aama.mjs teagan $M $G/tshirt/tshirt.dxf all '{"chestEase":0.18}'
# Ankle length (the default, +2%, reaches the floor; the scene has no floor).
node export-aama.mjs titan $M $G/trousers/trousers.dxf all '{"lengthBonus":-0.06}'
node export-aama.mjs hugo $M $G/hoodie/hoodie.dxf
