"""Tape-measure the test avatar in FreeSewing's terms (mm), by slicing the mesh.

Circumferences are convex-hull perimeters of a horizontal (or arm-perpendicular) slice: that's
what a tape held taut around the body measures. Heights and lengths are read off the slices.
usage: python3 tools/patterns/measure.py assets/body/makehuman_body_m.obj [--profile] > measurements.json
"""
import json, sys
import numpy as np
from scipy.spatial import ConvexHull

def load(path):
    v, f = [], []
    for line in open(path):
        if line.startswith('v '):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('f '):
            f.append([int(t.split('/')[0]) - 1 for t in line.split()[1:4]])
    return np.array(v), np.array(f)

V, F = load(sys.argv[1])

def slice_pts(origin, normal):
    """Points where mesh edges cross the plane, with each point's triangle index."""
    d = (V - origin) @ normal
    pts, tri = [], []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        ia, ib = F[:, a], F[:, b]
        m = (d[ia] < 0) != (d[ib] < 0)
        s = (d[ia[m]] / (d[ia[m]] - d[ib[m]]))[:, None]
        pts.append(V[ia[m]] + s * (V[ib[m]] - V[ia[m]]))
        tri.append(np.nonzero(m)[0])
    return np.concatenate(pts), np.concatenate(tri)

def loops(y):
    """Horizontal slice at y, split into connected loops (via shared triangles' edges)."""
    pts, tri = slice_pts(np.array([0, y, 0]), np.array([0, 1.0, 0]))
    # Each triangle contributes a segment between its two crossing points: union-find.
    parent = list(range(len(pts)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    by_tri = {}
    for i, t in enumerate(tri):
        by_tri.setdefault(t, []).append(i)
    # Crossing points on a shared edge coincide: merge by rounded position too.
    key = {}
    for i, p in enumerate(pts):
        k = tuple(np.round(p, 7))
        if k in key:
            parent[find(i)] = find(key[k])
        else:
            key[k] = i
    for ids in by_tri.values():
        for j in ids[1:]:
            parent[find(j)] = find(ids[0])
    groups = {}
    for i in range(len(pts)):
        groups.setdefault(find(i), []).append(i)
    return [pts[g] for g in groups.values() if len(g) > 8]

def hull_perim(p2):
    h = ConvexHull(p2)
    q = p2[h.vertices]
    return float(np.sum(np.linalg.norm(q - np.roll(q, 1, axis=0), axis=1)))

def girth(p):  # horizontal loop -> tape length
    return hull_perim(p[:, [0, 2]])

if '--profile' in sys.argv:
    for y in np.arange(0.02, 1.68, 0.02):
        ls = sorted(loops(y), key=lambda p: p[:, 0].mean())
        print(f'{y:.2f} ' + '  '.join(f'[x {p[:,0].min():+.3f}..{p[:,0].max():+.3f} z {p[:,2].min():+.3f}..{p[:,2].max():+.3f} g {girth(p)*1000:.0f}]' for p in ls))
    sys.exit()

def torso(y):
    """The loop that contains x = 0 (torso), at height y."""
    ls = [p for p in loops(y) if p[:, 0].min() < 0 < p[:, 0].max()]
    return max(ls, key=len) if ls else None

ys = np.arange(0.50, 1.50, 0.005)
# Crotch: highest y where the slice through x=0 doesn't exist (legs separate).
crotch = max(y for y in np.arange(0.5, 1.0, 0.002) if torso(y) is None)
# Armpit: lowest y where the arms join the torso loop (torso loop suddenly wider).
def torso_width(y):
    p = torso(y)
    return p[:, 0].max() - p[:, 0].min() if p is not None else 0
armpit = min(y for y in np.arange(1.15, 1.45, 0.002) if torso_width(y) > 0.50)
# Waist: narrowest torso girth between crotch + 0.20 and armpit - 0.10.
waist_y = min(np.arange(crotch + 0.20, armpit - 0.10, 0.005), key=lambda y: girth(torso(y)))
# Seat: fullest girth between 5 cm above the crotch (below that the hull spans both thighs) and the waist.
seat_y = max(np.arange(crotch + 0.05, waist_y, 0.005), key=lambda y: girth(torso(y)))
# Chest: fullest torso girth below the armpit.
chest_y = max(np.arange(waist_y, armpit - 0.005, 0.005), key=lambda y: girth(torso(y)))
# Hips (FreeSewing: at the hip bones, where low-rise trousers sit): taken at a third of the way
# from waist to seat height... MakeHuman's iliac crest is about 0.10 m under the waist.
hips_y = waist_y - 0.10
out = {}
mm = lambda m: round(float(m) * 1000, 1)
out['waist'] = mm(girth(torso(waist_y)))
out['seat'] = mm(girth(torso(seat_y)))
out['hips'] = mm(girth(torso(hips_y)))
out['chest'] = mm(girth(torso(chest_y)))
def back_half(p):
    """Hull of the loop; back half = part with z below the loop's centre (wearer's back is -Z)."""
    q = p[ConvexHull(p[:, [0, 2]]).vertices][:, [0, 2]]
    zc = (q[:, 1].min() + q[:, 1].max()) / 2
    # Tape length along hull points with z < zc, plus the side transitions.
    tot = 0.0
    n = len(q)
    for i in range(n):
        a, b = q[i], q[(i + 1) % n]
        if a[1] < zc and b[1] < zc:
            tot += np.linalg.norm(b - a)
        elif (a[1] < zc) != (b[1] < zc):
            s = (zc - a[1]) / (b[1] - a[1])
            m = a + s * (b - a)
            tot += np.linalg.norm((a if a[1] < zc else b) - m)
    return tot
out['seatBack'] = mm(back_half(torso(seat_y)))
out['waistBack'] = mm(back_half(torso(waist_y)))
out['waistToFloor'] = mm(waist_y)
out['waistToSeat'] = mm(waist_y - seat_y)
out['waistToHips'] = mm(waist_y - hips_y)
out['waistToUpperLeg'] = mm(waist_y - crotch)
out['waistToArmpit'] = mm(armpit - waist_y)

# Mid-sagittal profile (x = 0 slice): cross seam from front waist through the crotch to the back.
def sagittal():
    pts, _ = slice_pts(np.array([0.0, 0, 0]), np.array([1.0, 0, 0]))
    return pts
S = sagittal()
def profile_len(lo_y, hi_y, front):
    """Length along the body's x=0 outline between heights, on the front (z > 0.03) or back."""
    q = S[(S[:, 1] >= lo_y - 0.002) & (S[:, 1] <= hi_y)]
    q = q[q[:, 2] > 0.03] if front else q[q[:, 2] <= 0.03]
    pts = []
    for y0 in np.arange(lo_y, hi_y + 1e-9, 0.01):
        b = q[(q[:, 1] >= y0) & (q[:, 1] < y0 + 0.01)]
        if len(b):
            pts.append([y0, b[:, 2].max() if front else b[:, 2].min()])
    pts = np.array(pts)
    return float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))
# Crotch point: lowest point of the x=0 slice; front/back separated by its z.
low = S[np.argmin(S[:, 1])]
cs_front = profile_len(low[1], waist_y, True) + 0.0
cs_back = profile_len(low[1], waist_y, False)
gap = 0.0  # the crotch curve under the body: approximately the z-extent at the bottom
bottom = S[S[:, 1] < low[1] + 0.02]
gap = float(bottom[:, 2].max() - bottom[:, 2].min())
out['crossSeamFront'] = mm(cs_front + gap / 2)
out['crossSeam'] = mm(cs_front + cs_back + gap)

# Legs: knee = narrowest leg girth between 0.35 and 0.60, upper leg etc.
def leg(y):
    ls = [p for p in loops(y) if p[:, 0].mean() > 0.02]
    return max(ls, key=len) if ls else None
knee_y = min(np.arange(0.38, 0.58, 0.005), key=lambda y: girth(leg(y)))
out['knee'] = mm(girth(leg(knee_y)))
out['waistToKnee'] = mm(waist_y - knee_y)
out['upperLeg'] = mm(girth(leg(crotch - 0.03)))

# Neck: girth of the neck loop at its base; HPS = side of the neck base.
neck_base = None
for y in np.arange(armpit + 0.02, 1.60, 0.002):
    p = torso(y)
    if p is not None and p[:, 0].max() - p[:, 0].min() < 0.16:
        neck_base = y
        break
out['neck'] = mm(girth(torso(neck_base + 0.01)))
pn = torso(neck_base + 0.01)
hps = np.array([pn[:, 0].max(), neck_base, pn[pn[:, 0].argmax(), 2]])
# Head: fullest girth above the neck.
out['head'] = mm(max(girth(torso(y)) for y in np.arange(1.50, 1.66, 0.005)))
# Shoulder point: outermost top-of-shoulder point, from the frontal profile above the armpit.
sh = [(y, torso(y)) for y in np.arange(armpit, neck_base, 0.002)]
# Shoulder tip: highest y where the torso loop is still wider than 0.30 m.
tip_y = max(y for y, p in sh if p[:, 0].max() - p[:, 0].min() > 0.30)
pt = torso(tip_y)
shoulder_pt = pt[pt[:, 0].argmax()]
# Across the back between the shoulder points, along the body surface (2 cm under the tip, so
# the slice is the torso, not the arm joint).
pb = torso(tip_y - 0.02)
pb = pb[(np.abs(pb[:, 0]) <= shoulder_pt[0]) & (pb[:, 2] < 0.0)]
pb = pb[np.argsort(pb[:, 0])]
out['shoulderToShoulder'] = mm(np.sum(np.linalg.norm(np.diff(pb[:, [0, 2]], axis=0), axis=1)))
dx, dy = shoulder_pt[0] - hps[0], hps[1] - shoulder_pt[1]
out['shoulderSlope'] = round(float(np.degrees(np.arctan2(dy, dx))), 1)
out['hpsToWaistBack'] = mm(hps[1] - waist_y + 0.01)
# hpsToBust: HPS down to the bust point (the chest's most forward point on the right side).
pc = torso(chest_y)
right = pc[(pc[:, 0] > 0.03)]
bust = right[right[:, 2].argmax()]
out['hpsToBust'] = mm(np.linalg.norm(bust - hps))

# Arm: along the measured upper-arm axis, then the forearm. Wrist/biceps girths
# perpendicular to the arm.
def arm_slice(c, axis):
    pts, _ = slice_pts(c, axis)
    pts = pts[np.linalg.norm(pts - c, axis=1) < 0.08]
    u = np.cross(axis, [0, 0, 1.0]); u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    return hull_perim(np.stack([(pts - c) @ u, (pts - c) @ w], 1))
# Arm centreline (right arm, +x): centroids of the arm's horizontal slice loops, from the
# armpit down to the fingertips; girths are taken perpendicular to the local centreline.
cents = []
for y in np.arange(armpit - 0.01, 0.90, -0.01):
    ls = [p for p in loops(y) if p[:, 0].mean() > 0.17]
    if ls:
        cents.append(max(ls, key=len).mean(0))
cents = np.array(cents)
girths = []
for i in range(1, len(cents) - 1):
    ax = cents[i + 1] - cents[i - 1]; ax /= np.linalg.norm(ax)
    try:
        girths.append((i, arm_slice(cents[i], ax)))
    except Exception:
        pass
up = [g for i, g in girths if cents[i][1] > 1.15]
out['biceps'] = mm(max(up))
# Wrist: narrowest girth in the lower part of the arm, before the hand widens.
low_g = [(i, g) for i, g in girths if 0.98 < cents[i][1] < 1.08]
wi, wg = min(low_g, key=lambda x: x[1])
out['wrist'] = mm(wg)
wrist_pt = cents[wi]
out['shoulderToWrist'] = mm(np.linalg.norm(shoulder_pt - cents[0]) + np.sum(np.linalg.norm(np.diff(cents[:wi + 1], axis=0), axis=1)))
out['_heights_m'] = {k: round(float(v), 3) for k, v in dict(crotch=crotch, waist=waist_y, seat=seat_y, hips=hips_y, chest=chest_y, armpit=armpit, neck_base=neck_base, knee=knee_y, shoulder_tip=tip_y).items()}
out['_points_m'] = {'hps': hps.round(3).tolist(), 'shoulder': shoulder_pt.round(3).tolist(), 'bust': bust.round(3).tolist(), 'wrist': wrist_pt.round(3).tolist()}
print(json.dumps(out, indent=1))
