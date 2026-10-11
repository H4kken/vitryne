import json, sys
for f in sys.argv[1:]:
    r = json.load(open(f))
    a = r['self_intersections_after']; pen = r.get('penetration_after') or {}
    print(f"{f.split('/')[-1]:30s} eps {len(r['episodes'])} vmax {r['max_speed']:.2f} >5 {r['frames_over_5ms']} nan {r['non_finite_frames']} "
          f"ms {r['frame_ms_serial']['median']:.2f} p95 {r['frame_ms_serial']['p95']:.2f} | isect eps {r['episodes_starting_intersected']} max {r['max_self_intersections_at_episode_start']} "
          f"after {a['pairs']} persist {a['persistent_pairs']} | pen {pen.get('max_penetration_mm',0):.2f} seam {r.get('max_seam_gap_mm_after') or 0:.2f}")
