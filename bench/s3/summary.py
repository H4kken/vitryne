#!/usr/bin/env python3
"""S3 drag-test summary: python3 bench/s3/summary.py <dir> [<dir2> to compare]"""
import json, sys, glob, os, collections

def load(d):
    r = {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        r[os.path.basename(f)[:-5]] = json.load(open(f))
    return r

def row(j):
    return (j["max_speed"], j["frames_over_5ms"], j["non_finite_frames"],
            j["penetration_after"]["max_penetration_mm"] if j.get("penetration_after") else float("nan"),
            j["self_intersections_after"]["persistent_pairs"] or 0, j["frame_ms_serial"]["mean"],
            j["min_collider_dist_mm"])

runs = [load(d) for d in sys.argv[1:]]
keys = sorted(set().union(*runs), key=lambda k: (k.rsplit("_s", 1)[0], int(k.rsplit("_s", 1)[1])))
print("| run | " + " | ".join(f"max v · frames>5 · NaN · pen mm · persist · ms ({os.path.basename(d.rstrip('/'))})" for d in sys.argv[1:]) + " |")
print("|---|" + "---|" * len(runs))
tot = [collections.defaultdict(int) for _ in runs]
for k in keys:
    cells = []
    for i, r in enumerate(runs):
        if k not in r:
            cells.append("—"); continue
        v, f5, nan, pen, per, ms, md = row(r[k])
        g = k.rsplit("_s", 1)[0]
        tot[i][g + " frames>5"] += f5; tot[i][g + " runs failing"] += f5 > 0; tot[i][g + " persistent"] += per
        cells.append(f"{v:.2f} · {f5} · {nan} · {pen:.2f} · {per} · {ms:.2f}")
    print(f"| {k} | " + " | ".join(cells) + " |")
print()
for i, d in enumerate(sys.argv[1:]):
    print(d, dict(tot[i]))
