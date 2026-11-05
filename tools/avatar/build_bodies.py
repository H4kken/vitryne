# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build the bundled bodies of assets/bodies/ from MakeHuman's base mesh and macro targets.

  python3 tools/avatar/build_bodies.py --makehuman <checkout of makehuman> [--only SLUG] [--out DIR]

For each body of BODIES: the base mesh with its macro sliders applied (makehuman_body.py), cut to
the `body` group in metres with the feet at y = 0 (assets/body/convert.py, the same as the first
avatar), its measurements and regions (derive.py), written as assets/bodies/<slug>/avatar.json
and body.glb (a project file's avatar part). Everything is CC0 (MakeHuman's mesh and targets).
Needs numpy and scipy.
"""
import argparse, hashlib, json, os, re, struct, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import derive  # noqa: E402
import makehuman_body as mb  # noqa: E402

# slug, name, sliders. Slider 0.5 is average; weight 0.1 / 0.9 are a leaner and a fuller build.
BODIES = [
    ('female-slim', 'Female, slim', dict(gender=0.0, weight=0.1)),
    ('female-average', 'Female, average', dict(gender=0.0, weight=0.5)),
    ('female-full', 'Female, fuller', dict(gender=0.0, weight=0.9)),
    ('male-slim', 'Male, slim', dict(gender=1.0, weight=0.1)),
    ('male-average', 'Male, average', dict(gender=1.0, weight=0.5)),
    ('male-full', 'Male, fuller', dict(gender=1.0, weight=0.9)),
]


def body_id(slug):
    """A stable version-7-shaped id for the avatar (file-format.md, Identifiers)."""
    b = bytearray(hashlib.sha256(f'vitryne-avatar:{slug}'.encode()).digest()[:16])
    b[6] = (b[6] & 0x0F) | 0x70
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'


def write_glb(path, vertices, triangles):
    """A glTF binary with one mesh, positions and indices only (what the app's avatars are)."""
    pos = np.asarray(vertices, dtype='<f4')
    idx = np.asarray(triangles, dtype='<u4').reshape(-1)
    pos_b, idx_b = pos.tobytes(), idx.tobytes()
    gltf = {
        'asset': {'version': '2.0', 'generator': 'vitryne tools/avatar/build_bodies.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'body'}],
        'meshes': [{'name': 'body', 'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
             'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()},
            {'bufferView': 1, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos_b), 'target': 34962},
            {'buffer': 0, 'byteOffset': len(pos_b), 'byteLength': len(idx_b), 'target': 34963}],
        'buffers': [{'byteLength': len(pos_b) + len(idx_b)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    bin_ = pos_b + idx_b
    bin_ += b'\0' * (-len(bin_) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(bin_)) + b'BIN\0' + bin_)


def compact(text):
    """json.dumps(indent=2) with every list of numbers on one line, like assets/body/avatar.json."""
    return re.sub(r'\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]',
                  lambda m: '[' + re.sub(r'\s+', ' ', m.group(1)) + ']', text)


def deformed_base(base_obj, vertices, path):
    """base.obj's text with these vertices (the base mesh's units) in place of its own."""
    k = 0
    with open(base_obj) as src, open(path, 'w') as out:
        for line in src:
            if line.startswith('v '):
                x, y, z = vertices[k]
                out.write(f'v {x:.6f} {y:.6f} {z:.6f}\n')
                k += 1
            else:
                out.write(line)


def build(slug, name, sliders, mh, out_dir, tmp):
    data = os.path.join(mh, 'makehuman', 'data')
    base_obj = os.path.join(data, '3dobjs', 'base.obj')
    skeleton = os.path.join(data, 'rigs', 'default.mhskel')
    base, _ = read_base(base_obj)
    verts, n = mb.apply_macros(base, data, **sliders)
    deformed = os.path.join(tmp, f'{slug}-base.obj')
    deformed_base(base_obj, verts, deformed)
    body_obj = os.path.join(tmp, f'{slug}.obj')
    subprocess.run([sys.executable, os.path.join(REPO, 'assets', 'body', 'convert.py'), deformed, body_obj],
                   check=True, stdout=subprocess.DEVNULL)
    measurements, ctx = derive.derive_measurements(body_obj)
    regions = derive.derive_regions(derive.makehuman_joints(deformed, skeleton, body_obj), ctx)
    v, f = derive.read_obj(body_obj)
    d = os.path.join(out_dir, slug)
    os.makedirs(d, exist_ok=True)
    write_glb(os.path.join(d, 'body.glb'), v, f)
    sliders_text = ', '.join(f'{k} {x}' for k, x in sliders.items())
    avatar = {
        'id': body_id(slug),
        'name': name,
        'attribution': {
            'title': f'MakeHuman base mesh (hm08) with macro targets ({sliders_text})',
            'creator': 'Data Collection AB, Joel Palmius, Jonas Hauquier',
            'license': 'CC0-1.0',
            'source': 'https://github.com/makehumancommunity/makehuman',
        },
        'mesh': f'avatars/{body_id(slug)}/body.glb',
        'pose': 'A',
        'measurements': measurements,
        'regions': regions,
    }
    with open(os.path.join(d, 'avatar.json'), 'w') as fh:
        fh.write(compact(json.dumps(avatar, indent=2)) + '\n')
    return measurements, n


def read_base(path):
    verts = [[float(x) for x in l.split()[1:4]] for l in open(path) if l.startswith('v ')]
    return np.array(verts), None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--makehuman', required=True, help='a checkout of makehumancommunity/makehuman')
    ap.add_argument('--only')
    ap.add_argument('--out', default=os.path.join(REPO, 'assets', 'bodies'))
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        print(f'{"body":16} {"height":>7} {"chest":>6} {"waist":>6} {"hips":>6} {"targets":>7}')
        for slug, name, sliders in BODIES:
            if a.only and a.only != slug:
                continue
            m, n = build(slug, name, sliders, a.makehuman, a.out, tmp)
            print(f'{slug:16} {m["height"]:7.0f} {m["chest"]:6.0f} {m["waist"]:6.0f} {m["hips"]:6.0f} {n:7}')


if __name__ == '__main__':
    main()
