#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Regenerates the spike-2 test garments (assets/garments/*/*.dxf) from FreeSewing.
# Needs: cd tools/patterns && npm install
set -e
cd "$(dirname "$0")"
M=../../assets/body/measurements.json
G=../../assets/garments
node export-aama.mjs teagan $M $G/tshirt/tshirt.dxf
# Ankle length (the default, +2%, reaches the floor; the scene has no floor).
node export-aama.mjs titan $M $G/trousers/trousers.dxf all '{"lengthBonus":-0.06}'
node export-aama.mjs hugo $M $G/hoodie/hoodie.dxf
