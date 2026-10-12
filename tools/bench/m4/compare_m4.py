# SPDX-License-Identifier: AGPL-3.0-or-later
"""M4 native vs browser with self-collision: drape performance + shape parity + intersections,
and the drag test per seed.
usage: python3 tools/bench/m4/compare_m4.py bench-out/m4/browser/chrome_*.json bench-out/m4/browser/safari_*.json
Native runs: bench-out/m4/native/*.json (scripted in docs/history/PROGRESS.md M4)."""
import base64
import json
import os
import struct
import sys

N = 'bench-out/m4/native'


def positions(r):
    b = base64.b64decode(r['final_positions_b64'])
    f = struct.unpack(f'<{len(b) // 4}f', b)
    return [f[i:i + 3] for i in range(0, len(f), 3)]


def shape(a, b):
    if not (a.get('final_positions_b64') and b.get('final_positions_b64')):
        return '—'
    d = sorted(sum((x - y) ** 2 for x, y in zip(p, q)) ** 0.5 * 1000 for p, q in zip(positions(a), positions(b)))
    return f'{sum(d) / len(d):.2f} / {d[int(len(d) * 0.95)]:.2f} / {d[-1]:.2f}'


def native_drape(run):
    sc = run.get('self_collision')
    tag = f"sc-k{sc['rebuild_every']}" if sc else 'off'
    if run['scene'] == 'sheet':
        p = f'{N}/drop-{tag}.json'
    else:
        p = f"{N}/tshirt-{run['scene_params']['tshirt']['edge']:g}-{tag}.json"
    return json.load(open(p)) if os.path.exists(p) else None


fmt = lambda x, d=2: '—' if x is None else f'{x:.{d}f}'
for path in sys.argv[1:]:
    doc = json.load(open(path))
    if 'runs' not in doc:
        continue
    ua = doc['user_agent']
    br = 'Safari' if 'Version/' in ua and 'Chrome' not in ua else 'Chrome'
    print(f'\n#### {br}: {path}\n')
    runs = doc['runs']
    if 'episodes' in runs[0]:
        print(f'| Seed | Native max v | {br} max v | Native frames ≥ 5 m/s | {br} | Native isect after / persistent | {br} | Identical episodes |')
        print('|---|---|---|---|---|---|---|---|')
        for b in runs:
            s = b['config']['seed']
            n = json.load(open(f'{N}/drag-s{s}-sc-k{b["sim"]["self_rebuild_every"]}.json'))
            same = [e['max_speed'] for e in n['episodes']] == [e['max_speed'] for e in b['episodes']]
            ia, ib = n['self_intersections_after'], b['self_intersections_after']
            print(f"| {s} | {fmt(n['max_speed'])} | {fmt(b['max_speed'])} | {n['frames_over_5ms']} | {b['frames_over_5ms']} | "
                  f"{ia['pairs']} / {ia['persistent_pairs']} | {ib['pairs']} / {ib['persistent_pairs']} | {'yes' if same else 'no'} |")
        continue
    print(f'| Scene | Vertices | Self-coll | Native ms | {br} ms | Ratio | Native rest | {br} rest | {br} isect final / persistent | {br} pen mm | Shape diff mean / p95 / max (mm) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for b in runs:
        n = native_drape(b)
        sc = b.get('self_collision')
        ratio = b['frame_ms_pipelined'] / n['frame_ms_pipelined'] if n else None
        pen = (b.get('penetration') or {}).get('max_penetration_mm')
        print(f"| {b['scene']} | {b['mesh']['vertices']:,} | {'k=' + str(sc['rebuild_every']) if sc else 'off'} | "
              f"{fmt(n and n['frame_ms_pipelined'])} | {fmt(b['frame_ms_pipelined'])} | {fmt(ratio)}× | {n and n['rest_frame']} | {b['rest_frame']} | "
              f"{b['self_intersections_final']['pairs']} / {b['self_intersections_after_pipelined']['persistent_pairs']} | {fmt(pen)} | {shape(n, b) if n else '—'} |")
