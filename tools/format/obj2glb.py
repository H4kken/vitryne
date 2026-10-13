#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Converts the test avatar's OBJ (metres, triangles) to the glTF binary a Vitryne avatar part
holds: one mesh, one primitive, POSITION + indices, no materials.

usage: tools/format/obj2glb.py assets/body/makehuman_body_m.obj out.glb

Until vitryne-format exists (M5), this makes the avatar part of examples/*.vtry
(`tools/format/build-examples.sh`).
"""
import json
import struct
import sys


def main(src, dst):
    pos, tris = [], []
    for line in open(src):
        f = line.split()
        if not f:
            continue
        if f[0] == "v":
            pos.append(tuple(float(x) for x in f[1:4]))
        elif f[0] == "f":
            idx = [int(x.split("/")[0]) - 1 for x in f[1:]]
            tris.extend((idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1))
    vbytes = b"".join(struct.pack("<3f", *p) for p in pos)
    ibytes = b"".join(struct.pack("<3I", *t) for t in tris)
    lo = [min(p[k] for p in pos) for k in range(3)]
    hi = [max(p[k] for p in pos) for k in range(3)]
    gltf = {
        "asset": {"version": "2.0", "generator": "vitryne tools/format/obj2glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "body"}],
        "meshes": [{"name": "body", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": lo, "max": hi},
            {"bufferView": 1, "componentType": 5125, "count": 3 * len(tris), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vbytes), "target": 34962},
            {"buffer": 0, "byteOffset": len(vbytes), "byteLength": len(ibytes), "target": 34963},
        ],
        "buffers": [{"byteLength": len(vbytes) + len(ibytes)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ = vbytes + ibytes
    bin_ += b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(dst, "wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, total))
        out.write(struct.pack("<I4s", len(js), b"JSON") + js)
        out.write(struct.pack("<I4s", len(bin_), b"BIN\0") + bin_)
    print(f"{dst}: {len(pos)} vertices, {len(tris)} triangles, {total} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
