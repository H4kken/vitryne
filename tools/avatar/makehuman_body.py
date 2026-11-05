# SPDX-License-Identifier: AGPL-3.0-or-later
"""Make a body from MakeHuman's base mesh and its macro targets (CC0), without MakeHuman.

MakeHuman's macro sliders (gender, age, muscle, weight, height, proportions, ethnicity) each
give a value 0..1; a macro target's weight is the product of the values its name lists
(`universal-female-young-averagemuscle-averageweight`, `african-male-child`, `female-young-
…-maxheight`), and a body is the base mesh plus the weighted sum of the targets. The values
from sliders follow MakeHuman's own rules (apps/human.py `_set*Vals`).

Used by tools/avatar/build_bodies.py. Needs numpy and a checkout of MakeHuman's data
(https://github.com/makehumancommunity/makehuman, `makehuman/data`).
"""
import os
import numpy as np

# Defaults of MakeHuman's new human: everything in the middle, the three ethnicities equal.
DEFAULTS = dict(gender=0.5, age=0.5, muscle=0.5, weight=0.5, height=0.5, proportions=0.5,
                african=1 / 3, asian=1 / 3, caucasian=1 / 3)


def slider_values(gender, age, muscle, weight, height, proportions, african, asian, caucasian):
    """The weight of every word a macro target's name can contain."""
    mid = lambda x: (max(0.0, 1 - x * 2), max(0.0, x * 2 - 1))  # (min, max) of a 0..1 slider
    v = {'male': gender, 'female': 1 - gender}
    if age < 0.5:
        young = max(0.0, (age - 0.1875) * 3.2)
        v.update(old=0.0, baby=max(0.0, 1 - age * 5.333), young=young,
                 child=max(0.0, min(1.0, 5.333 * age) - young))
    else:
        old = max(0.0, age * 2 - 1)
        v.update(old=old, young=1 - old, baby=0.0, child=0.0)
    for name, x in (('muscle', muscle), ('weight', weight)):
        lo, hi = mid(x)
        v.update({f'min{name}': lo, f'max{name}': hi, f'average{name}': 1 - (lo + hi)})
    lo, hi = mid(height)
    v.update(minheight=lo, maxheight=hi)
    lo, hi = mid(proportions)
    v.update(uncommonproportions=lo, idealproportions=hi)
    total = african + asian + caucasian
    v.update(african=african / total, asian=asian / total, caucasian=caucasian / total)
    return v


def read_target(path):
    """(vertex indices, offsets in the base mesh's units) of a .target file."""
    rows = [l.split() for l in open(path) if l.strip() and not l.startswith('#')]
    return (np.array([int(r[0]) for r in rows], dtype=int),
            np.array([[float(x) for x in r[1:4]] for r in rows], dtype=float).reshape(-1, 3))


def macro_files(data_dir):
    root = os.path.join(data_dir, 'targets', 'macrodetails')
    for dirpath, _, names in os.walk(root):
        for n in sorted(names):
            if n.endswith('.target'):
                yield os.path.join(dirpath, n)


def apply_macros(base_vertices, data_dir, **sliders):
    """The base mesh's vertices with the macro targets of these slider values added."""
    values = slider_values(**{**DEFAULTS, **sliders})
    out = np.array(base_vertices, dtype=float)
    used = 0
    for path in macro_files(data_dir):
        words = [w for w in os.path.basename(path)[:-len('.target')].split('-') if w != 'universal']
        unknown = [w for w in words if w not in values]
        if unknown:
            raise SystemExit(f'{path}: unknown word(s) {unknown}: MakeHuman changed its names?')
        weight = float(np.prod([values[w] for w in words]))
        if weight > 0:
            idx, off = read_target(path)
            out[idx] += weight * off
            used += 1
    return out, used
