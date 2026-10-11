"""Side-by-side native vs browser bench results.
usage: python3 bench/compare.py <browser.json> [<browser2.json> ...]
Browser files are what bench.html outputs ({runs: [...]}); native results are matched from
bench/m1/grid{N}.json (20 substeps) or bench/m1/grid100_ss{S}.json by vertex count + substeps."""
import glob
import json
import sys

native = {}
for p in glob.glob('bench/m1/*.json'):
    r = json.load(open(p))
    if r['gpu_timestamps'] or r['config']['scene']['pin_spacing'] != 0.9 or r['config']['sim']['damping'] != 1.0:
        continue
    native[(r['mesh']['vertices'], r['config']['sim']['substeps'])] = r

def fmt(x, d=2):
    return '—' if x is None else f'{x:.{d}f}'

print('| Vertices | Substeps | Native pipelined ms | Browser pipelined ms | Ratio | Native rest frame | Browser rest frame | Native wall to rest | Browser wall to rest | Browser NaN frames | Browser max v >1 s |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for path in sys.argv[1:]:
    for b in json.load(open(path))['runs']:
        key = (b['mesh']['vertices'], b['config']['sim']['substeps'])
        n = native.get(key)
        np_ = n['frame_ms_pipelined'] if n else None
        bp = b['frame_ms_pipelined']
        print(f"| {key[0]:,} | {key[1]} | {fmt(np_)} | {fmt(bp)} | {fmt(bp / np_ if np_ else None)}× | "
              f"{n['rest_frame'] if n else '—'} | {b['rest_frame']} | {fmt(n['rest_wall_s_pipelined'] if n else None)} s | "
              f"{fmt(b['rest_wall_s_pipelined'])} s | {b['non_finite_frames']} | {b['max_speed_after_1s']:.2f} |")
