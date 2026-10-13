#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Runs the drape or drag benchmark over garments x sizes (x seeds), natively or in headless Chrome,
# writes one JSON per run and prints the summary table.
#
# usage: tools/bench/run.sh drape|drag <out-dir> [extra drape flags, native only]
#
# Matrix, from the environment (defaults shown):
#   GARMENTS="tshirt trousers hoodie"  VERTS="10000 20000"  SEEDS="1 2 3 4 5 6" (drag only)
#   SC=1          self-collision on, rebuilt every 4th substep (SC=0: off)
#   TARGET=native, or TARGET=chrome: needs the page served with COOP/COEP on PORT (default 5173),
#                 e.g. `cd app && pnpm run dev`; QUERY="&ut=0" adds bench.html URL parameters
#   DRAPE_BIN=target/release/drape (native; built first if it's the default)
#
# Output: <out-dir>/<target>_<garment>_<N>k[_s<seed>].json, plus a .log per native run.
# Then: python3 tools/bench/compare.py <native-dir> <chrome-dir> puts two targets side by side.
set -u
cd "$(dirname "$0")/../.."

mode=${1:?usage: tools/bench/run.sh drape|drag <out-dir> [flags]}
out=${2:?usage: tools/bench/run.sh drape|drag <out-dir> [flags]}
shift 2
case $mode in drape | drag) ;; *) echo "mode must be drape or drag" >&2; exit 2 ;; esac
target=${TARGET:-native}
garments=${GARMENTS:-tshirt trousers hoodie}
verts=${VERTS:-10000 20000}
seeds=${SEEDS:-1 2 3 4 5 6}
[ "$mode" = drape ] && seeds=-
bin=${DRAPE_BIN:-target/release/drape}
mkdir -p "$out"

if [ "$target" = native ] && [ -z "${DRAPE_BIN:-}" ]; then
  cargo build --release -p drape-native --locked -q || exit 1
fi

for g in $garments; do
  for v in $verts; do
    for s in $seeds; do
      name="${target}_${g}_$((v / 1000))k"
      [ "$s" = - ] || name="${name}_s$s"
      f="$out/$name.json"
      if [ "$target" = native ]; then
        sc=""
        [ "${SC:-1}" = 1 ] && sc="--self-collision --self-rebuild 4"
        if [ "$mode" = drape ]; then
          # shellcheck disable=SC2086
          "$bin" bench --scene garment --garment "examples/$g.vtry" --verts "$v" $sc \
            --record-positions "$@" --out "$f" > /dev/null 2> "$out/$name.log"
        else
          # shellcheck disable=SC2086
          "$bin" bench-drag --scene garment --garment "examples/$g.vtry" --verts "$v" $sc \
            --seed "$s" "$@" --out "$f" > /dev/null 2> "$out/$name.log"
        fi
      elif [ "$target" = chrome ]; then
        url="http://localhost:${PORT:-5173}/bench.html?auto=1&garment=$g&res=$v${QUERY:-}"
        [ "${SC:-1}" = 1 ] && url="$url&sc=1&rebuild=4"
        if [ "$mode" = drape ]; then url="$url&mode=tshirt"; else url="$url&mode=drag&seeds=$s"; fi
        node tools/bench/chrome-check.mjs "$url" /dev/null 1200000 "$f.page" > /dev/null 2>&1
        # Keep the run itself, plus the browser's user agent so summaries can name it.
        python3 -c 'import json, sys
d = json.load(open(sys.argv[1])); r = d["runs"][0]; r["user_agent"] = d.get("user_agent")
json.dump(r, open(sys.argv[2], "w"), indent=1)' "$f.page" "$f" 2> /dev/null
        rm -f "$f.page"
      else
        echo "TARGET must be native or chrome" >&2
        exit 2
      fi
      if [ -s "$f" ]; then echo "done $name"; else echo "FAIL $name"; rm -f "$f"; fi
    done
  done
done

python3 tools/bench/summary.py "$out"
