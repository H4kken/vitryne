# SPDX-License-Identifier: AGPL-3.0-or-later
"""Derive an avatar's measurements and regions from its mesh, so a new body needs no hand-measuring.

  python3 tools/avatar/derive.py --body assets/body/makehuman_body_m.obj \\
      --base-obj base.obj --skeleton default.mhskel [--check assets/body/avatar.json] [--write]

- Measurements (mm): the tape measures of tools/patterns/measure.py (slices of the mesh), plus
  `height`. They go into the avatar's `measurements`.
- Regions (mm, file-format.md, Regions): from the MakeHuman skeleton's joints. A joint is the
  mean of a few helper vertices of MakeHuman's base mesh, so it follows every body made from
  that mesh with targets (the same topology), unlike numbers measured by hand. `--base-obj` is
  makehuman/data/3dobjs/base.obj and `--skeleton` makehuman/data/rigs/default.mhskel (both
  CC0, https://github.com/makehumancommunity/makehuman); the body OBJ must come from
  assets/body/convert.py (the joints get the same scale and floor shift).
- Torso and head centres (z) come from slices of the body, the one thing joints don't give.

`--check AVATAR.json` compares the derived regions with that file's and fails past --tol-mm /
--tol-deg. `--write` puts the derived measurements into it (the regions stay as they are: the
golden drapes depend on them). Needs numpy and scipy.
"""
import argparse, json, os, re, sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'patterns'))
import measure  # noqa: E402


def read_obj(path):
    v, f = [], []
    for line in open(path):
        if line.startswith('v '):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('f '):
            f.append([int(t.split('/')[0]) - 1 for t in line.split()[1:4]])
    return np.array(v), np.array(f)


def makehuman_joints(base_obj, skeleton, body_obj):
    """Every skeleton joint in the body OBJ's frame (mm). convert.py scales the base mesh by 0.1
    to metres and shifts it so the feet (the lowest vertex of the `body` group) are at y = 0."""
    verts, group, used = [], None, set()
    for line in open(base_obj):
        if line.startswith('v '):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('g '):
            group = line.split()[1]
        elif line.startswith('f ') and group == 'body':
            used.update(int(t.split('/')[0]) - 1 for t in line.split()[1:])
    verts = np.array(verts)
    floor = verts[sorted(used)][:, 1].min()
    # The body OBJ must be that group, or the joints would not sit on it.
    body, _ = read_obj(body_obj)
    if len(body) != len(used):
        sys.exit(f'{body_obj} has {len(body)} vertices, the base mesh body group {len(used)}: '
                 'was it made by assets/body/convert.py?')
    joints = json.load(open(skeleton))['joints']
    out = {}
    for name, ids in joints.items():
        p = verts[ids].mean(0)
        out[name] = np.array([p[0], p[1] - floor, p[2]]) * 100.0  # decimetres -> mm
    return out


def unit(v):
    return v / np.linalg.norm(v)


def rnd(v, n=1):
    return [round(float(x), n) for x in v]


def derive_regions(joints, ctx):
    """The avatar's regions from its joints and slices of its body. `ctx` is measure's context."""
    j = lambda b, end='head': joints[f'{b}____{end}']
    r = {}
    for side, sx in (('left', 'L'), ('right', 'R')):
        s, e = j(f'upperarm01.{sx}'), j(f'lowerarm01.{sx}')
        f, w = j(f'lowerarm01.{sx}', 'tail'), j(f'wrist.{sx}')
        r[f'arm-{side}'] = {'type': 'path', 'points': [rnd(p) for p in (s, e, (e + f) / 2, f, w)],
                            'zero': [0.0, 1.0, 0.0]}
        # The axes point from the arm back towards the shoulder (the top of a sleeve's piece).
        r[f'upper-arm-{side}'] = {'type': 'axis', 'origin': rnd(s), 'axis': rnd(unit(s - e), 3),
                                  'zero': [0.0, 1.0, 0.0]}
        r[f'arm-straight-{side}'] = {'type': 'axis', 'origin': rnd(s), 'axis': rnd(unit(s - w), 3),
                                     'zero': [0.0, 1.0, 0.0]}
        # The leg's axis from the ankle through the hip joint, taken down to the floor.
        hip, ankle = j(f'upperleg01.{sx}'), j(f'foot.{sx}')
        d = unit(hip - ankle)
        floor = ankle - d * (ankle[1] / d[1])
        r[f'leg-{side}'] = {'type': 'axis', 'origin': rnd(floor), 'axis': rnd(d, 3),
                            'zero': [0.0, 0.0, 1.0]}
    torso_z = float(np.mean([mid_z(ctx['torso'](y)) for y in
                             np.arange(ctx['crotch'] + 0.05, ctx['armpit'], 0.02)])) * 1000
    head_ys = np.arange(1.50, 1.63, 0.02)
    head_z = float(np.median([mid_z(ctx['torso'](y)) for y in head_ys])) * 1000
    r['torso'] = {'type': 'axis', 'origin': [0.0, 0.0, round(torso_z, 1)], 'axis': [0.0, 1.0, 0.0],
                  'zero': [0.0, 0.0, 1.0]}
    r['head'] = {'type': 'axis', 'origin': [0.0, 0.0, round(head_z, 1)], 'axis': [0.0, 1.0, 0.0],
                 'zero': [0.0, 0.0, 1.0]}
    r['head-over'] = {'type': 'axis', 'origin': [0.0, round(float(j('head')[1]), 1), round(head_z, 1)],
                      'axis': [1.0, 0.0, 0.0], 'zero': [0.0, 1.0, 0.0]}
    return dict(sorted(r.items()))


def mid_z(loop):
    return (loop[:, 2].min() + loop[:, 2].max()) / 2


def derive_measurements(body_obj):
    v, f = read_obj(body_obj)
    out, ctx = measure.measure(v, f)
    m = {'height': round(float(v[:, 1].max()) * 1000, 1)}
    # Millimetres only (the avatar schema's unit): shoulderSlope is in degrees.
    m.update({k: x for k, x in out.items() if not k.startswith('_') and k != 'shoulderSlope'})
    return m, ctx


def write_measurements(path, measurements):
    """Sets `measurements` in the avatar file by editing its text, so the rest of the file (its
    own layout, the hand-set regions) stays byte for byte as it is."""
    text = open(path).read()
    block = '  "measurements": {\n' + ',\n'.join(
        f'    {json.dumps(k)}: {v}' for k, v in measurements.items()) + '\n  },\n'
    text = re.sub(r'  "measurements": \{.*?\n  \},\n', '', text, flags=re.S)
    at = text.index('  "regions": {')
    with open(path, 'w') as f:
        f.write(text[:at] + block + text[at:])


def region_points(region):
    """The numbers a region is made of, for comparing: positions (mm) and directions."""
    if region['type'] == 'path':
        return [np.array(p) for p in region['points']], []
    return [np.array(region['origin'])], [unit(np.array(region['axis']))]


def compare(derived, committed, tol_mm, tol_deg):
    bad = 0
    print(f'{"region":22} {"position mm":>12} {"angle deg":>10}')
    for name in sorted(committed):
        if name not in derived:
            print(f'{name:22} missing from the derived regions')
            bad += 1
            continue
        (pa, da), (pb, db) = region_points(derived[name]), region_points(committed[name])
        dist = max(np.linalg.norm(a - b) for a, b in zip(pa, pb))
        ang = max([np.degrees(np.arccos(np.clip(a @ b, -1, 1))) for a, b in zip(da, db)] or [0.0])
        flag = '' if dist <= tol_mm and ang <= tol_deg else '  <-- over'
        bad += bool(flag)
        print(f'{name:22} {dist:12.1f} {ang:10.1f}{flag}')
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--body', required=True, help="the body OBJ (metres, feet at y = 0)")
    ap.add_argument('--base-obj', required=True)
    ap.add_argument('--skeleton', required=True)
    ap.add_argument('--check', metavar='AVATAR.json')
    ap.add_argument('--write', action='store_true', help="put the measurements into --check's file")
    ap.add_argument('--tol-mm', type=float, default=30.0)
    ap.add_argument('--tol-deg', type=float, default=10.0)
    ap.add_argument('--print', action='store_true', help='print the derived regions as JSON')
    a = ap.parse_args()

    measurements, ctx = derive_measurements(a.body)
    regions = derive_regions(makehuman_joints(a.base_obj, a.skeleton, a.body), ctx)
    if a.print:
        print(json.dumps({'measurements': measurements, 'regions': regions}, indent=2))
    if a.check:
        avatar = json.load(open(a.check))
        bad = compare(regions, avatar['regions'], a.tol_mm, a.tol_deg)
        if a.write:
            write_measurements(a.check, measurements)
            print(f'wrote {len(measurements)} measurements to {a.check}')
        if bad:
            sys.exit(f'{bad} region(s) over the tolerance')


if __name__ == '__main__':
    main()
