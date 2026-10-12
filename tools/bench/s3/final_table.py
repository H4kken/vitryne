#!/usr/bin/env python3
"""S3 final drag table: python3 tools/bench/s3/final_table.py (reads bench-out/s3/final/{native,chrome})."""
import json, glob
print("| Garment | Target | Stable (S3 criterion) | Frames ≥ 5 m/s (of 6 × 3,600) | Longest run | Max speed (m/s) | NaN | Max penetration after (mm) | Max seam widening (mm) | Persistent self-isect after (sum) | ms/frame |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for g in ["tshirt_10k", "tshirt_20k", "trousers_10k", "trousers_20k", "hoodie_10k", "hoodie_20k"]:
    for t in ["native", "chrome"]:
        js = [json.load(open(f)) for f in sorted(glob.glob(f"bench-out/s3/final/{t}/{g}_s*.json"))]
        if not js: continue
        bad = [j["config"]["seed"] for j in js if not j["stable"]]
        print(f"| {g.replace('_', ' ')} | {t} | {len(js) - len(bad)}/{len(js)}{' ❌ seeds ' + ', '.join(map(str, bad)) if bad else ' ✅'} | {sum(j['frames_over_5ms'] for j in js)} | "
              f"{max(j['max_consecutive_frames_over_5ms'] for j in js)} | {max(j['max_speed'] for j in js):.1f} | {sum(j['non_finite_frames'] for j in js)} | "
              f"{max(j['penetration_after']['max_penetration_mm'] for j in js):.2f} | {max(j['max_seam_gap_mm_after'] - j['max_seam_gap_mm_before'] for j in js):.1f} | "
              f"{sum(j['self_intersections_after']['persistent_pairs'] or 0 for j in js)} | {sum(j['frame_ms_serial']['mean'] for j in js) / len(js):.2f} |")
