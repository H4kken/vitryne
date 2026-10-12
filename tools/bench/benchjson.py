# SPDX-License-Identifier: AGPL-3.0-or-later
"""Loading and describing `drape bench` / `drape bench-drag` JSON, native or from bench.html.
Shared by summary.py and compare.py."""
import base64
import glob
import json
import os
import struct


def load(paths):
    """Every bench run in the given files and directories. A bench.html document ({runs: [...]})
    contributes each of its runs, tagged with the document's user agent."""
    files = []
    for p in paths:
        files += sorted(glob.glob(os.path.join(p, '*.json'))) if os.path.isdir(p) else [p]
    runs = []
    for f in files:
        d = json.load(open(f))
        for r in d['runs'] if 'runs' in d else [d]:
            if 'mesh' not in r and 'episodes' not in r:
                continue  # not a bench run (e.g. a viewer report)
            r.setdefault('user_agent', d.get('user_agent'))
            r['_file'] = os.path.basename(f)
            runs.append(r)
    return runs


def is_drag(r):
    return 'episodes' in r


def target(r):
    """'native', or the browser's name."""
    ua = r.get('user_agent')
    if not ua:
        return 'native' if r.get('target', 'native') == 'native' else 'web'
    if 'Firefox' in ua:
        return 'firefox'
    if 'Chrome' in ua:
        return 'chrome'
    return 'safari' if 'Version/' in ua else 'web'


def sim(r):
    return r.get('sim') or r['config']['sim']


def vertices(r):
    return r['vertices'] if is_drag(r) else r['mesh']['vertices']


def self_collision(r):
    s = sim(r)
    return f"k={s['self_rebuild_every']}" if s.get('self_collision') else 'off'


def key(r):
    """What has to match for two runs to be the same benchmark on different targets."""
    return (
        'drag' if is_drag(r) else 'drape',
        r.get('scene', 'sheet'),
        vertices(r),
        sim(r)['substeps'],
        self_collision(r),
        r['config'].get('seed') if is_drag(r) else None,
    )


def positions(r):
    b = base64.b64decode(r['final_positions_b64'])
    f = struct.unpack(f'<{len(b) // 4}f', b)
    return [f[i:i + 3] for i in range(0, len(f), 3)]


def shape_diff_mm(a, b):
    """Per-vertex distance between two runs' final positions: (mean, p95, max) in mm, or None."""
    if not (a.get('final_positions_b64') and b.get('final_positions_b64')):
        return None
    d = sorted(sum((x - y) ** 2 for x, y in zip(p, q)) ** 0.5 * 1000 for p, q in zip(positions(a), positions(b)))
    return sum(d) / len(d), d[int(len(d) * 0.95)], d[-1]


def f(x, d=2):
    return '—' if x is None else f'{x:.{d}f}'
