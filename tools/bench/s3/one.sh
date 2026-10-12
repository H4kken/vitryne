#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# tools/bench/s3/one.sh <garment> <verts> <seed> <out.json> [extra flags]: one drag run, one summary line.
# DRAPE_BIN overrides the binary (default target/release/drape).
g=$1 v=$2 s=$3 out=$4; shift 4
${DRAPE_BIN:-target/release/drape} bench-drag --scene garment --garment assets/garments/$g/garment.toml \
  --verts $v --self-collision --self-rebuild 4 --seed $s "$@" --out "$out" > /dev/null 2>"${out%.json}.log" || { echo "FAIL $g $v $s"; exit 1; }
python3 - "$out" "$*" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
p = d["penetration_after"]
print(f'{d["scene"]:>16} {d["vertices"]} s{d["config"]["seed"]} [{sys.argv[2]}]: max v {d["max_speed"]:.2f}, frames>5 {d["frames_over_5ms"]}, NaN {d["non_finite_frames"]}, '
      f'pen {p["max_penetration_mm"]:.2f} mm, min dist {d["min_collider_dist_mm"]:.2f} mm, seam {d["max_seam_gap_mm_after"]:.1f} mm, '
      f'persist {d["self_intersections_after"]["persistent_pairs"]}, ms {d["frame_ms_serial"]["mean"]:.2f}, '
      f'longest run>5 {d.get("max_consecutive_frames_over_5ms")}, seam before {d.get("max_seam_gap_mm_before") or 0:.1f} mm, stable {d.get("stable")}')
PY
