# SPDX-License-Identifier: AGPL-3.0-or-later
"""Two targets side by side (e.g. native vs Chrome): speed, results and shape parity.

usage: python3 tools/bench/compare.py <reference: file.json | dir> <other: file.json | dir>
Runs are matched on kind (drape/drag), scene, vertex count, substeps, self-collision and seed.
Shape parity needs final positions in both runs: `run.sh drape` records them natively
(--record-positions), and bench.html records them by default.
"""
import sys

from benchjson import f, key, load, shape_diff_mm, target

if len(sys.argv) != 3:
    sys.exit(__doc__)
ref = {key(r): r for r in load([sys.argv[1]])}
other = {key(r): r for r in load([sys.argv[2]])}
both = sorted(set(ref) & set(other), key=lambda k: (k[0], k[1], k[2], k[4], k[5] or 0))
if not both:
    sys.exit('no matching runs')
for path, side, rest in ((sys.argv[1], ref, other), (sys.argv[2], other, ref)):
    unmatched = len(set(side) - set(rest))
    if unmatched:
        print(f'({unmatched} runs in {path} have no match)\n')
a_name, b_name = target(ref[both[0]]), target(other[both[0]])
ab = f'({a_name} · {b_name})'


def pen(r):
    return (r.get('penetration') or {}).get('max_penetration_mm')


def persistent_end(r):
    return (r.get('self_intersections_after_pipelined') or {}).get('persistent_pairs', '—')


def persistent_after(r):
    return r['self_intersections_after']['persistent_pairs'] or 0


def stable(r):
    return '✅' if r.get('stable') else '❌'


drapes = [k for k in both if k[0] == 'drape']
if drapes:
    print(f'| Scene | Vertices | Self-coll | {a_name} ms | {b_name} ms | Ratio | Rest frame {ab} | Wall to rest, s {ab} | '
          f'Max pen mm {ab} | Persistent self-isect {ab} | Shape diff mean / p95 / max (mm) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for k in drapes:
        a, b = ref[k], other[k]
        d = shape_diff_mm(a, b)
        print(f"| {k[1]} | {k[2]:,} | {k[4]} | {f(a['frame_ms_pipelined'])} | {f(b['frame_ms_pipelined'])} | "
              f"{b['frame_ms_pipelined'] / a['frame_ms_pipelined']:.2f}× | {a['rest_frame']} · {b['rest_frame']} | "
              f"{f(a.get('rest_wall_s_pipelined'))} · {f(b.get('rest_wall_s_pipelined'))} | {f(pen(a))} · {f(pen(b))} | "
              f"{persistent_end(a)} · {persistent_end(b)} | {' / '.join(f(x) for x in d) if d else '—'} |")
    print()

drags = [k for k in both if k[0] == 'drag']
if drags:
    print(f'| Scene | Vertices | Self-coll | Seed | Stable {ab} | Max v {ab} | Frames ≥ 5 m/s {ab} | '
          f'Persistent self-isect after {ab} | Identical episodes | ms/frame {ab} |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for k in drags:
        a, b = ref[k], other[k]
        same = [e['max_speed'] for e in a['episodes']] == [e['max_speed'] for e in b['episodes']]
        print(f"| {k[1]} | {k[2]:,} | {k[4]} | {k[5]} | {stable(a)} · {stable(b)} | {f(a['max_speed'])} · {f(b['max_speed'])} | "
              f"{a['frames_over_5ms']} · {b['frames_over_5ms']} | {persistent_after(a)} · {persistent_after(b)} | "
              f"{'yes' if same else 'no'} | {f(a['frame_ms_serial']['mean'])} · {f(b['frame_ms_serial']['mean'])} |")
