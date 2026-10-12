# SPDX-License-Identifier: AGPL-3.0-or-later
"""Native vs browser for the T-shirt (M3): performance side by side, plus shape parity.
usage: python3 tools/bench/compare_m3.py bench-out/m3/chrome_tshirt.json [bench-out/m3/safari_tshirt.json ...]
Native runs: bench-out/m3/tshirt_native_{5k,10k,20k,40k}.json (made with --record-positions).
Shape parity: per-vertex distance between the native and browser positions after the same
number of frames (both runs record final positions)."""
import base64
import glob
import json
import struct
import sys


def positions(r):
    b = base64.b64decode(r['final_positions_b64'])
    f = struct.unpack(f'<{len(b) // 4}f', b)
    return [f[i:i + 3] for i in range(0, len(f), 3)]


native = {}
for p in glob.glob('bench-out/m3/tshirt_native_*.json'):
    r = json.load(open(p))
    native[r['mesh']['vertices']] = r

fmt = lambda x, d=2: '—' if x is None else f'{x:.{d}f}'
for path in sys.argv[1:]:
    doc = json.load(open(path))
    ua = doc['user_agent']
    browser = 'Safari' if 'Version/' in ua and 'Chrome' not in ua else 'Firefox' if 'Firefox' in ua else 'Chrome'
    print(f'\n### {browser}: {path}\n')
    print(f'| Vertices | Native ms | {browser} ms | Ratio | Native rest frame | {browser} rest frame | Native wall to rest | {browser} wall to rest | {browser} max pen (mm) | {browser} max v | {browser} NaN | Shape diff mean / p95 / max (mm) |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for b in doc['runs']:
        v = b['mesh']['vertices']
        n = native.get(v)
        shape = '—'
        if n and n.get('final_positions_b64') and b.get('final_positions_b64'):
            pa, pb = positions(n), positions(b)
            d = sorted(((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2) ** 0.5 * 1000 for x, y in zip(pa, pb))
            shape = f'{sum(d) / len(d):.2f} / {d[int(len(d) * 0.95)]:.2f} / {d[-1]:.2f}'
        ratio = b['frame_ms_pipelined'] / n['frame_ms_pipelined'] if n else None
        print(f"| {v:,} | {fmt(n and n['frame_ms_pipelined'])} | {fmt(b['frame_ms_pipelined'])} | {fmt(ratio)}× | "
              f"{n and n['rest_frame']} | {b['rest_frame']} | {fmt(n and n['rest_wall_s_pipelined'])} s | {fmt(b['rest_wall_s_pipelined'])} s | "
              f"{fmt(b['penetration']['max_penetration_mm'])} | {fmt(b['max_speed'])} | {b['non_finite_frames']} | {shape} |")
