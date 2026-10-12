# SPDX-License-Identifier: AGPL-3.0-or-later
"""One line per drape bench JSON (spike 2, S2), plus the per-seam gaps of the worst seams.
usage: python3 tools/bench/s2/summary.py file.json [...] [--seams]"""
import json, sys

files = [a for a in sys.argv[1:] if not a.startswith('--')]
print('| file | garment | verts | ms/frame | rest frame | rest wall s | max v | max v after ramps | NaN | max pen mm | max seam gap mm | self-isect end / persistent | inside at start |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for f in files:
    r = json.load(open(f))
    sp = r['scene_params']
    pen = r.get('penetration') or {}
    si = r.get('self_intersections_after_pipelined') or {}
    fmt = lambda x, d=2: '—' if x is None else f'{x:.{d}f}'
    print(f"| {f.split('/')[-1]} | {r['scene']} | {r['mesh']['vertices']} | {fmt(r['frame_ms_pipelined'])} | {r['rest_frame']} | {fmt(r['rest_wall_s_pipelined'])} | "
          f"{fmt(r['max_speed'])} | {fmt(r['max_speed_after_ramps'])} | {r['non_finite_frames']} | {fmt(pen.get('max_penetration_mm'))} | {fmt(r['max_seam_gap_mm'], 1)} | "
          f"{r['self_intersections_final']['pairs']} / {si.get('persistent_pairs')} | {sp.get('initial_inside_thickness')} |")
    if '--seams' in sys.argv:
        for name, mx, mean, at in sorted(r['seam_gaps_mm'], key=lambda s: -s[1])[:6]:
            print(f'|   seam {name} | max {mx:.1f} mm at {at:.2f}, mean {mean:.1f} |')
        print('|   fastest |', ', '.join(f'{v[2]} {v[1]:.2f}' for v in r['final_fastest_vertices'][:5]), '|')
