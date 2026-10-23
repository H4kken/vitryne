#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Edge-strain tables for drape and drag JSON (files or directories).

usage: python3 tools/bench/strain.py <json or dir>... [--regions] [--groups] [--seams] [--hotspots]

Drape runs: the distribution at the end of the serial run (percent). Drag runs: at rest before
the drags, at the end of each hold (median and max of the per-episode p99), and 3 s after.
"""
import sys

from benchjson import load


def pct(x, nd=1):
    return '—' if x is None else f'{x * 100:.{nd}f}'


def dist(s):
    return ' / '.join(pct(s[k]) for k in ('p50', 'p90', 'p99', 'p999', 'max'))


def main():
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    paths = [a for a in sys.argv[1:] if not a.startswith('--')]
    runs = [(r['_file'].removesuffix('.json'), r) for r in load(paths)]
    drape = [(n, r) for n, r in runs if 'strain' in r]
    drag = [(n, r) for n, r in runs if 'strain_before' in r]
    if drape:
        print('| Run | Vertices | Rest frame | Edge strain p50 / p90 / p99 / p99.9 / max (%) | > 3% | > 8% | p99 seam / contact / free (%) |')
        print('|---|---|---|---|---|---|---|')
        for name, r in drape:
            s = r['strain']
            over = dict((round(t, 2), f) for t, f in s['over'])
            reg = dict((k, v) for k, v in s['by_region'])
            print(f"| {name} | {r['mesh']['vertices']:,} | {r.get('rest_frame') or 'none'} | {dist(s['all'])} "
                  f"| {pct(over.get(0.03))} | {pct(over.get(0.08))} "
                  f"| {' / '.join(pct(reg[k]['p99']) for k in ('seam', 'contact', 'free'))} |")
        for name, r in drape:
            s = r['strain']
            if '--regions' in flags:
                print(f'\n{name}, by region:')
                for k, v in s['by_region']:
                    print(f"  {k:8s} {v['edges']:6d} edges  mean {pct(v['mean'])}  {dist(v)}")
            if '--groups' in flags:
                print(f'\n{name}, by panel:')
                for k, v in s['by_group']:
                    print(f"  {k:14s} {v['edges']:6d} edges  mean {pct(v['mean'])}  {dist(v)}")
            if '--seams' in flags:
                print(f'\n{name}, seam line strain, side A / B (%):')
                for k, a, b in s['seam_lines']:
                    print(f"  {k:18s} {pct(a)} / {pct(b)}")
            if '--hotspots' in flags:
                print(f'\n{name}, worst edges:')
                for h in s['hotspots']:
                    m = h['midpoint']
                    print(f"  {pct(h['strain'])}%  {h['group']:12s} {h['region']:8s} at ({m[0]:+.3f}, {m[1]:.3f}, {m[2]:+.3f})")
    if drag:
        if drape:
            print()
        print('| Run | Vertices | Stable | Before: p99 / max (%) | Holds: p99 median / max, max edge (%) | After: p99 / max (%) |')
        print('|---|---|---|---|---|---|')
        for name, r in drag:
            b, a = r['strain_before'], r['strain_after']
            print(f"| {name} | {r['vertices']:,} | {'yes' if r['stable'] else 'NO'} | {pct(b['p99'])} / {pct(b['max'])} "
                  f"| {pct(r['strain_hold_p99_median'])} / {pct(r['strain_hold_p99_max'])}, {pct(r['strain_hold_max'])} "
                  f"| {pct(a['p99'])} / {pct(a['max'])} |")


if __name__ == '__main__':
    main()
