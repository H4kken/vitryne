# SPDX-License-Identifier: AGPL-3.0-or-later
"""A skeleton and skin weights for an avatar's mesh, from MakeHuman's default rig (CC0).

  python3 tools/avatar/rig.py --makehuman <checkout of makehumancommunity/makehuman> [--check]

MakeHuman's rig has 163 bones and weights for 139 of them (face, tongue, every finger joint), on
the 19,158 vertices of its base mesh. The editor's body is the base mesh's `body` group (13,380
vertices, `assets/body/convert.py`), so this

1. maps the weights onto those vertices: body vertex k is the k-th used base vertex, in index
   order, exactly as convert.py numbers them (checked against the first avatar's mesh);
2. keeps `KEEP` (about 25 bones) and folds every other bone's weights into its nearest kept
   ancestor, so a finger moves with its hand and the face with the head;
3. keeps the four strongest joints per vertex and scales them to add up to one;
4. places each kept joint at its bone's head (translation only, no rest rotation: a pose is one
   rotation per joint), in metres, in the body OBJ's frame (derive.makehuman_joints).

`skin_for` returns (joints, joint_ids, weights) for `write_glb` in build_bodies.py. Numbers go to
the mesh as `JOINTS_0` (unsigned short) and `WEIGHTS_0` (normalized unsigned short), which add up
to exactly 65535 per vertex.

`--check` builds the skin for the first avatar (assets/body/makehuman_body_m.obj) and prints what
the reduction costs: weight moved by folding and dropped by the four-joint limit, per region.
"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import derive  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# What moves on its own. Everything else follows the nearest of these above it in the skeleton.
KEEP = [
    'root',
    'spine05', 'spine03', 'spine01', 'neck01', 'head',
    'breast.L', 'breast.R',
    'clavicle.L', 'upperarm01.L', 'lowerarm01.L', 'wrist.L',
    'clavicle.R', 'upperarm01.R', 'lowerarm01.R', 'wrist.R',
    'upperleg01.L', 'lowerleg01.L', 'foot.L',
    'upperleg01.R', 'lowerleg01.R', 'foot.R',
]


def body_vertices(base_obj):
    """The base mesh's vertex indices the `body` group uses, in order (convert.py's numbering)."""
    group, used = None, set()
    for line in open(base_obj):
        if line.startswith('g '):
            group = line.split()[1]
        elif line.startswith('f ') and group == 'body':
            used.update(int(t.split('/')[0]) - 1 for t in line.split()[1:])
    return sorted(used)


def folded(bones, kept):
    """Each bone's nearest kept bone, itself or the first kept ancestor."""
    out = {}
    for name in bones:
        at = name
        while at not in kept:
            at = bones[at]['parent']
            if at is None:
                raise SystemExit(f'{name} has no kept ancestor')
        out[name] = at
    return out


def order(bones, kept):
    """The kept bones, each after its kept parent, siblings by name (so the file is reproducible)."""
    parent = {k: folded(bones, kept)[bones[k]['parent']] if bones[k]['parent'] else None
              for k in kept}
    out, seen = [], set()

    def visit(k):
        if k in seen:
            return
        if parent[k] is not None:
            visit(parent[k])
        seen.add(k)
        out.append(k)

    for k in sorted(kept):
        visit(k)
    return out, parent


def skin_for(base_obj, skeleton, weights_file, joints_mm, keep=KEEP, stats=None):
    """The skin of the `body` group of `base_obj` (the base mesh, possibly deformed by targets).
    `joints_mm`: derive.makehuman_joints for that body. Returns (joints, joint_ids, weights):
    joints as (name, parent index or None, rest position in metres), joint_ids (n, 4) uint16,
    weights (n, 4) uint16 adding up to 65535."""
    sk = json.load(open(skeleton))
    bones = sk['bones']
    w = json.load(open(weights_file))['weights']
    kept = set(keep)
    missing = kept - set(bones)
    if missing:
        raise SystemExit(f'not in the skeleton: {sorted(missing)}')
    joints_order, parent = order(bones, kept)
    index = {k: i for i, k in enumerate(joints_order)}
    target = folded(bones, kept)
    used = body_vertices(base_obj)
    at = {v: k for k, v in enumerate(used)}
    n = len(used)

    # Weight of each kept joint on each body vertex.
    dense = np.zeros((n, len(joints_order)))
    moved = np.zeros(n)
    for bone, entries in w.items():
        j = index[target[bone]]
        for v, x in entries:
            k = at.get(v)
            if k is None:
                continue  # a helper vertex, not in the body
            dense[k, j] += x
            if bone != target[bone]:
                moved[k] += x
    total = dense.sum(1)
    if (total <= 0).any():
        raise SystemExit(f'{int((total <= 0).sum())} body vertices have no weights')
    dense /= total[:, None]
    moved /= total

    # The four strongest, scaled to one, then to integers adding up to 65535.
    top = np.argsort(-dense, axis=1, kind='stable')[:, :4]
    picked = np.take_along_axis(dense, top, axis=1)
    kept_share = picked.sum(1)
    picked /= kept_share[:, None]
    q = np.floor(picked * 65535).astype(np.int64)
    short = 65535 - q.sum(1)
    q[np.arange(n), 0] += short  # the strongest takes the rounding
    if stats is not None:
        stats['folded'] = moved
        stats['dropped'] = 1 - kept_share
        stats['total_before'] = total
    ids = top.astype(np.uint16)
    # A joint with no share (a vertex with fewer than four) points at joint 0 with weight 0.
    ids[q == 0] = 0

    joints = []
    for name in joints_order:
        head = joints_mm[bones[name]['head']] / 1000.0
        joints.append((name, None if parent[name] is None else index[parent[name]],
                       [float(x) for x in head]))
    return joints, ids, q.astype(np.uint16)


def default_paths(makehuman):
    data = os.path.join(makehuman, 'makehuman', 'data')
    rigs = os.path.join(data, 'rigs')
    sk = os.path.join(rigs, 'default.mhskel')
    wf = json.load(open(sk))['weights_file']
    return os.path.join(data, '3dobjs', 'base.obj'), sk, os.path.join(rigs, wf)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--makehuman', required=True)
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    base_obj, sk, wf = default_paths(a.makehuman)
    body_obj = os.path.join(REPO, 'assets', 'body', 'makehuman_body_m.obj')

    # The mapping: the base mesh's body group, scaled and shifted as convert.py does, is the
    # first avatar's mesh.
    verts = np.array([[float(x) for x in l.split()[1:4]] for l in open(base_obj) if l.startswith('v ')])
    used = body_vertices(base_obj)
    body, _ = derive.read_obj(body_obj)
    mapped = verts[used] * 0.1
    mapped[:, 1] -= mapped[:, 1].min()
    err = np.abs(mapped - body).max()
    print(f'{len(used)} body vertices; mapped base mesh vs assets/body/makehuman_body_m.obj: '
          f'max difference {err * 1000:.4f} mm')
    if len(used) != len(body) or err > 2e-6:
        raise SystemExit('the vertex mapping does not reproduce the first avatar: not going on')

    joints_mm = derive.makehuman_joints(base_obj, sk, body_obj)
    stats = {}
    joints, ids, q = skin_for(base_obj, sk, wf, joints_mm, stats=stats)
    print(f'{len(joints)} joints, {len(q)} vertices')
    print(f'weight folded into an ancestor: mean {stats["folded"].mean() * 100:.1f}% '
          f'(max {stats["folded"].max() * 100:.1f}%); lost to the four-joint limit: '
          f'mean {stats["dropped"].mean() * 100:.3f}%, max {stats["dropped"].max() * 100:.2f}%, '
          f'{int((stats["dropped"] > 0.01).sum())} vertices over 1%')
    print(f'weights per vertex before folding summed to {stats["total_before"].min():.3f} '
          f'to {stats["total_before"].max():.3f}')
    if a.check:
        for name, p, rest in joints:
            print(f'  {name:14} parent {"-" if p is None else joints[p][0]:14} '
                  f'rest {rest[0]:7.3f} {rest[1]:7.3f} {rest[2]:7.3f}')


if __name__ == '__main__':
    main()
