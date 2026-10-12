# SPDX-License-Identifier: AGPL-3.0-or-later
"""Markdown tables for drape and drag benchmark runs.

usage: python3 tools/bench/summary.py <file.json | dir> [...] [--group] [--seams]
  --group   drag runs: one row per target x garment x size, summed over seeds
  --seams   drape runs: also the worst seams and the fastest vertices at the end
"""
import sys
from collections import defaultdict

from benchjson import f, is_drag, load, self_collision, target, vertices

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit(__doc__)
runs = load(args)
drapes = [r for r in runs if not is_drag(r)]
drags = [r for r in runs if is_drag(r)]

if drapes:
    print('| Run | Target | Scene | Vertices | Self-coll | ms/frame | Rest frame | Wall to rest (s) | Max v (m/s) | NaN | Max pen (mm) | Max seam gap (mm) | Self-isect end / persistent | Edge strain mean / p99 / max (%) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in drapes:
        pen = (r.get('penetration') or {}).get('max_penetration_mm')
        si = r.get('self_intersections_after_pipelined') or {}
        st = r.get('stretch_strain')  # [mean, p99, max] as fractions
        strain = ' / '.join(f(x * 100, 1) for x in st) if st else '—'
        print(f"| {r['_file']} | {target(r)} | {r.get('scene', 'sheet')} | {vertices(r):,} | {self_collision(r)} | {f(r['frame_ms_pipelined'])} | "
              f"{r['rest_frame'] if r['rest_frame'] is not None else 'none'} | {f(r.get('rest_wall_s_pipelined'))} | {f(r['max_speed'])} | "
              f"{r['non_finite_frames']} | {f(pen)} | {f(r.get('max_seam_gap_mm'), 1)} | "
              f"{(r.get('self_intersections_final') or {}).get('pairs', '—')} / {si.get('persistent_pairs', '—')} | {strain} |")
        if '--seams' in sys.argv:
            for name, mx, mean, at in sorted(r.get('seam_gaps_mm') or [], key=lambda s: -s[1])[:6]:
                print(f'| ↳ seam {name} | max {mx:.1f} mm at {at:.2f}, mean {mean:.1f} |')
            print('| ↳ fastest |', ', '.join(f'{v[2]} {v[1]:.2f}' for v in r.get('final_fastest_vertices', [])[:5]), '|')
    print()


def pen_after(r):
    return (r.get('penetration_after') or {}).get('max_penetration_mm')


def widening(r):
    return (r.get('max_seam_gap_mm_after') or 0) - (r.get('max_seam_gap_mm_before') or 0)


if drags and '--group' not in sys.argv:
    print('| Run | Target | Scene | Vertices | Self-coll | Seed | Stable | Max v (m/s) | Frames ≥ 5 m/s | Longest run | NaN | Pen after (mm) | Seam widening (mm) | Persistent self-isect after | ms/frame |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in drags:
        print(f"| {r['_file']} | {target(r)} | {r['scene']} | {vertices(r):,} | {self_collision(r)} | {r['config']['seed']} | "
              f"{'✅' if r.get('stable') else '❌'} | {f(r['max_speed'])} | {r['frames_over_5ms']} | {r.get('max_consecutive_frames_over_5ms', '—')} | "
              f"{r['non_finite_frames']} | {f(pen_after(r))} | {f(widening(r), 1)} | "
              f"{r['self_intersections_after']['persistent_pairs'] or 0} | {f(r['frame_ms_serial']['mean'])} |")
elif drags:
    groups = defaultdict(list)
    for r in drags:
        groups[(target(r), r['scene'], vertices(r), self_collision(r))].append(r)
    print('| Target | Scene | Vertices | Self-coll | Stable | Frames ≥ 5 m/s (sum) | Longest run | Max v (m/s) | NaN | Max pen after (mm) | Max seam widening (mm) | Persistent self-isect after (sum) | ms/frame (mean) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (t, scene, v, sc), rs in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][2], kv[0][0])):
        bad = sorted(r['config']['seed'] for r in rs if not r.get('stable'))
        print(f"| {t} | {scene} | {v:,} | {sc} | {len(rs) - len(bad)}/{len(rs)}{' ❌ seeds ' + ', '.join(map(str, bad)) if bad else ' ✅'} | "
              f"{sum(r['frames_over_5ms'] for r in rs)} | {max(r.get('max_consecutive_frames_over_5ms') or 0 for r in rs)} | "
              f"{max(r['max_speed'] for r in rs):.1f} | {sum(r['non_finite_frames'] for r in rs)} | "
              f"{f(max((pen_after(r) or 0) for r in rs))} | {max(widening(r) for r in rs):.1f} | "
              f"{sum(r['self_intersections_after']['persistent_pairs'] or 0 for r in rs)} | {sum(r['frame_ms_serial']['mean'] for r in rs) / len(rs):.2f} |")
