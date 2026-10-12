#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Rasterise an SVG with macOS Quick Look (square crop, so keep the SVG roughly square).
# usage: tools/patterns/svg2png.sh in.svg [size]  -> in.svg.png next to it
cd "$(dirname "$1")" && qlmanage -t -s "${2:-1800}" -o . "$(basename "$1")" >/dev/null 2>&1
