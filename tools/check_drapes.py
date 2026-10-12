# SPDX-License-Identifier: AGPL-3.0-or-later
"""Smoke test of the three sample drapes, run by ./check until the M3 regression suite.

usage: python3 tools/check_drapes.py <dir>   (reads <dir>/{tshirt,trousers,hoodie}.json from `drape bench`)

Each garment must have no NaN and no body penetration of 2 mm or more. The T-shirt and trousers
must also come to rest with no persistent self-intersections. The hoodie's back-neck junction
is a known spike failure (docs/history/PROGRESS.md S3 finding 4, S4): it stays crossed and never
rests. It's listed below as known, so a fix shows up here as "now passes" instead of silently.
"""
import json
import os
import sys

KNOWN = {'hoodie': {'rest', 'self-intersections'}}

failed = False
for g in ['tshirt', 'trousers', 'hoodie']:
    d = json.load(open(os.path.join(sys.argv[1], f'{g}.json')))
    pen = (d.get('penetration') or {}).get('max_penetration_mm', 0.0)
    persistent = d['self_intersections_after_pipelined']['persistent_pairs']
    checks = {
        'NaN': d['non_finite_frames'] == 0,
        'penetration': pen < 2.0,
        'rest': d['rest_frame'] is not None,
        'self-intersections': persistent == 0,
    }
    known = KNOWN.get(g, set())
    bad = [k for k, ok in checks.items() if not ok and k not in known]
    fixed = [k for k in known if checks[k]]
    still = [k for k in known if not checks[k]]
    print(f"{g:9s} {d['mesh']['vertices']} verts: rest frame {d['rest_frame']}, NaN frames {d['non_finite_frames']}, "
          f"max penetration {pen:.2f} mm, persistent self-intersections {persistent}, "
          f"max seam gap {d['max_seam_gap_mm']:.1f} mm"
          + (f"  [known failures: {', '.join(still)}]" if still else '')
          + (f"  [now passes: {', '.join(fixed)}; remove it from KNOWN]" if fixed else ''))
    if bad:
        print(f"  FAIL: {', '.join(bad)}")
        failed = True
sys.exit(1 if failed else 0)
