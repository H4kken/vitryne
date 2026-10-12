#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# tools/bench/s3/chrome.sh <out-dir> <garments> <verts> <seeds>: drag test in headless Chrome, one seed per page.
# Needs the dev server (cd web && npm run dev; PORT overrides 5173) and `npm run assets`.
out=$1 gs=$2 v=$3 seeds=$4; mkdir -p "$out"
for g in $gs; do for s in $seeds; do
  f="$out/${g}_$((v/1000))k_s$s.json"
  node tools/bench/chrome-check.mjs "http://localhost:${PORT:-5173}/bench.html?auto=1&mode=drag&garment=$g&res=$v&seeds=$s&sc=1&rebuild=4" /dev/null 1200000 "$f.tmp" > /dev/null 2>&1
  python3 - "$f.tmp" "$f" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))["runs"][0]
except Exception as e:
    print("FAIL", sys.argv[2], e); sys.exit()
json.dump(r, open(sys.argv[2], "w"), indent=1)
p = r["penetration_after"]
print(f'{r["scene"]:>16} {r["vertices"]} s{r["config"]["seed"]}: max v {r["max_speed"]:.2f}, frames>5 {r["frames_over_5ms"]}, longest run {r["max_consecutive_frames_over_5ms"]}, NaN {r["non_finite_frames"]}, pen {p["max_penetration_mm"]:.2f} mm, seam {r["max_seam_gap_mm_before"]:.1f} -> {r["max_seam_gap_mm_after"]:.1f} mm, stable {r["stable"]}, ms {r["frame_ms_serial"]["mean"]:.2f}')
PY
  rm -f "$f.tmp"
done; done
