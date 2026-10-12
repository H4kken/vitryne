# SPDX-License-Identifier: AGPL-3.0-or-later
import json, sys
for f in sys.argv[1:]:
    r = json.load(open(f))
    sc = r.get('self_collision')
    i0, i1, i2 = r['self_intersections_initial'], r['self_intersections_final'], r['self_intersections_after_pipelined']
    pen = r.get('penetration') or {}
    print(f"{f.split('/')[-1]:28s} ms {r['frame_ms_serial']['median']:.3f} pipe {r['frame_ms_pipelined']:.3f} disp {r['mesh']['dispatches_per_frame']} "
          f"rest {r['rest_frame']} vmax>1s {r['max_speed_after_1s']:.2f} nan {r['non_finite_frames']} "
          f"isect {i0['pairs']}/{i1['pairs']}/{i2['pairs']} persist {i2['persistent_pairs']} "
          f"pen {pen.get('max_penetration_mm', 0):.2f} seam {r.get('max_seam_gap_mm') or 0:.2f} "
          + (f"r {sc['radius_mm']:.2f}/{sc['query_radius_mm']:.2f}mm k{sc['rebuild_every']} {sc['check']}" if sc else ""))
