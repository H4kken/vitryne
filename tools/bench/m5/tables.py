# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5: build the spike REPORT tables (docs/history/REPORT.md) from bench-out/m5/native/*.json and bench-out/m5/chrome/*.json.
usage: python3 tools/bench/m5/tables.py > /tmp/tables.md"""
import base64
import glob
import json
import os
import struct

N, C = 'bench-out/m5/native', 'bench-out/m5/chrome'
SIZES = ['0.0122', '0.00864', '0.0061', '0.00432']
f2 = lambda x, d=2: '—' if x is None else f'{x:.{d}f}'


def load(p):
    return json.load(open(p)) if os.path.exists(p) else None


def chrome_runs(name):
    d = load(f'{C}/chrome_{name}.json')
    return d['runs'] if d else []


def positions(r):
    b = base64.b64decode(r['final_positions_b64'])
    f = struct.unpack(f'<{len(b) // 4}f', b)
    return [f[i:i + 3] for i in range(0, len(f), 3)]


def shape_max(a, b):
    if not (a and b and a.get('final_positions_b64') and b.get('final_positions_b64')):
        return None
    return max(sum((x - y) ** 2 for x, y in zip(p, q)) ** 0.5 * 1000 for p, q in zip(positions(a), positions(b)))


def by_vertices(runs):
    return {r['mesh']['vertices']: r for r in runs}


print('### Drape to rest (T-shirt, 20 substeps, 900 frames)\n')
print('| Vertices | Self-coll | Native ms | Chrome ms | Chrome / native | Rest frame (native · Chrome) | **Chrome wall to rest** | Native wall to rest | Max penetration mm (native · Chrome) | Self-intersections at end (native · Chrome) | Shape diff max mm |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for tag, cname in [('off', 'tshirt_off'), ('sc', 'tshirt_sc')]:
    cr = by_vertices(chrome_runs(cname))
    for e in SIZES:
        n = load(f'{N}/tshirt-{e}-{tag}.json')
        if not n:
            continue
        c = cr.get(n['mesh']['vertices'])
        ratio = c['frame_ms_pipelined'] / n['frame_ms_pipelined'] if c else None
        print(f"| {n['mesh']['vertices']:,} | {'on (K=4)' if tag == 'sc' else 'off'} | {f2(n['frame_ms_pipelined'])} | {f2(c and c['frame_ms_pipelined'])} | {f2(ratio)}× | "
              f"{n['rest_frame']} · {c and c['rest_frame']} | **{f2(c and c['rest_wall_s_pipelined'])} s** | {f2(n['rest_wall_s_pipelined'])} s | "
              f"{f2(n['penetration']['max_penetration_mm'])} · {f2(c and c['penetration']['max_penetration_mm'])} | "
              f"{n['self_intersections_final']['pairs']} · {c and c['self_intersections_final']['pairs']} | {f2(shape_max(n, c))} |")

print('\n### Dropped sheet (10k, folds onto itself)\n')
print('| Self-coll | Native ms | Chrome ms | Native isect end / persistent | Chrome isect end / persistent |')
print('|---|---|---|---|---|')
for tag in ['off', 'sc']:
    n = load(f'{N}/drop-{tag}.json')
    c = (chrome_runs(f'drop_{tag}') or [None])[0]
    pi = lambda r: f"{r['self_intersections_final']['pairs']} / {r['self_intersections_after_pipelined']['persistent_pairs']}" if r else '—'
    print(f"| {'on (K=4)' if tag == 'sc' else 'off'} | {f2(n and n['frame_ms_pipelined'])} | {f2(c and c['frame_ms_pipelined'])} | {pi(n)} | {pi(c)} |")

print('\n### Interactive drag in Chrome (viewer automation, rAF fps while dragging)\n')
print('| Vertices | Self-coll off | Self-coll on (K=4) | Fast drape: wall s to 6 s of sim (off · on) |')
print('|---|---|---|---|')
for sz, e in [('10k', '0.00864'), ('20k', '0.0061'), ('40k', '0.00432')]:
    a, b = load(f'{C}/chrome_viewer_{sz}_off.json'), load(f'{C}/chrome_viewer_{sz}_sc.json')
    print(f"| {a and a['vertices'] or sz} | {f2(a and a['drag_fps_raf'], 1)} | {f2(b and b['drag_fps_raf'], 1)} | {f2(a and a['fast_drape_wall_s_to_sim_6s'])} · {f2(b and b['fast_drape_wall_s_to_sim_6s'])} |")

print('\n### Stability: 60 s random drags\n')
print('| Test | Self-coll | Seed | Max v native · Chrome (m/s) | Frames ≥ 5 m/s native · Chrome | NaN | Pen after mm | Isect after / persistent, native · Chrome | Drag frame ms native · Chrome |')
print('|---|---|---|---|---|---|---|---|---|')
groups = [('harsh 10k', 'drag-10k', 'drag_10k', range(1, 7)), ('harsh 20k', 'drag-20k', 'drag_20k', range(1, 4)), ('gentle 10k', 'gentle-10k', 'gentle_10k', range(1, 4))]
totals = {}
for label, nf, cf, seeds in groups:
    for tag in ['off', 'sc']:
        cr = {r['config']['seed']: r for r in chrome_runs(f'{cf}_{tag}')}
        for s in seeds:
            n = load(f'{N}/{nf}-s{s}-{tag}.json')
            c = cr.get(s)
            if not n:
                continue
            t = totals.setdefault((label, tag), [0, 0, 0, 0, 0])
            t[0] += n['frames_over_5ms']; t[1] += c['frames_over_5ms'] if c else 0
            t[2] += n['non_finite_frames'] + (c['non_finite_frames'] if c else 0)
            t[3] += (n['self_intersections_after']['persistent_pairs'] or 0) > 0
            t[4] += 1
            ia = lambda r: f"{r['self_intersections_after']['pairs']} / {r['self_intersections_after']['persistent_pairs']}" if r else '—'
            print(f"| {label} | {'on' if tag == 'sc' else 'off'} | {s} | {f2(n['max_speed'])} · {f2(c and c['max_speed'])} | {n['frames_over_5ms']} · {c and c['frames_over_5ms']} | "
                  f"{n['non_finite_frames']} · {c and c['non_finite_frames']} | {f2(n['penetration_after']['max_penetration_mm'])} · {f2(c and c['penetration_after']['max_penetration_mm'])} | "
                  f"{ia(n)} · {ia(c)} | {f2(n['frame_ms_serial']['median'])} · {f2(c and c['frame_ms_serial']['median'])} |")
print('\n| Test | Self-coll | Runs | Frames ≥ 5 m/s total, native · Chrome (of 3,600 per run) | NaN frames | Runs with persistent self-intersections (native) |')
print('|---|---|---|---|---|---|')
for (label, tag), t in totals.items():
    print(f"| {label} | {'on' if tag == 'sc' else 'off'} | {t[4]} | {t[0]} · {t[1]} | {t[2]} | {t[3]} |")

print('\n### GPU time by phase (profiling mode, ms per frame; includes per-pass overhead)\n')
for tgt in ['native', 'chrome']:
    for tag in ['off', 'sc']:
        rows = []
        if tgt == 'native':
            for e in SIZES:
                r = load(f'{N}/prof-tshirt-{e}-{tag}.json')
                if r:
                    rows.append(r)
        else:
            rows = chrome_runs(f'prof_{tag}')
        if not rows or not rows[0].get('gpu_phase_ms'):
            print(f'{tgt} {tag}: no timestamps\n')
            continue
        labels = [p['label'] for p in rows[0]['gpu_phase_ms']]
        print(f"**{tgt}, self-collision {'on (K=4)' if tag == 'sc' else 'off'}**\n")
        print('| Vertices | ' + ' | '.join(labels) + ' | total | top phase |')
        print('|---|' + '---|' * (len(labels) + 2))
        for r in rows:
            ms = {p['label']: p['ms'] for p in r['gpu_phase_ms']}
            tot = sum(ms.values())
            top = max(ms, key=ms.get)
            print(f"| {r['mesh']['vertices']:,} | " + ' | '.join(f2(ms.get(l)) for l in labels) + f' | {f2(tot)} | {top} {ms[top] / tot * 100:.0f}% |')
        print()
