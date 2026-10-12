// SPDX-License-Identifier: AGPL-3.0-or-later
//! 2D sewing patterns: panels bounded by named edges (polylines, metres), optional internal
//! lines (open polylines inside a panel, e.g. a pocket placement line), and seams pairing chains
//! of edges. The procedural T-shirt builds one in code; `garment` builds one from DXF-AAMA.

use glam::Vec2;

#[derive(Debug, Clone)]
pub struct PatternEdge {
    pub name: String,
    /// Polyline from this edge's start corner to the next edge's start corner.
    pub pts: Vec<Vec2>,
}

impl PatternEdge {
    pub fn new(name: impl Into<String>, pts: Vec<Vec2>) -> Self {
        Self {
            name: name.into(),
            pts,
        }
    }

    pub fn length(&self) -> f32 {
        self.pts.windows(2).map(|w| w[0].distance(w[1])).sum()
    }

    /// `n + 1` points evenly spaced by arc length (both ends included).
    pub fn resample(&self, n: usize) -> Vec<Vec2> {
        let total = self.length();
        let mut out = Vec::with_capacity(n + 1);
        let mut seg = 0;
        let mut acc = 0.0;
        for k in 0..=n {
            let target = total * k as f32 / n as f32;
            while seg + 1 < self.pts.len() - 1
                && acc + self.pts[seg].distance(self.pts[seg + 1]) < target
            {
                acc += self.pts[seg].distance(self.pts[seg + 1]);
                seg += 1;
            }
            let (a, b) = (self.pts[seg], self.pts[seg + 1]);
            let l = a.distance(b).max(1e-12);
            out.push(a.lerp(b, ((target - acc) / l).clamp(0.0, 1.0)));
        }
        *out.last_mut().unwrap() = *self.pts.last().unwrap();
        out[0] = self.pts[0];
        out
    }
}

/// A closed panel: edges in order, each starting where the previous ended.
#[derive(Debug, Clone)]
pub struct Panel {
    pub name: String,
    pub edges: Vec<PatternEdge>,
    /// Internal lines: open polylines strictly inside the panel (their ends may touch the
    /// boundary at an edge corner). Meshed as constrained edges, so they can be sewn.
    pub inner: Vec<PatternEdge>,
}

impl Panel {
    pub fn new(name: impl Into<String>, edges: Vec<PatternEdge>) -> Self {
        Self {
            name: name.into(),
            edges,
            inner: Vec::new(),
        }
    }

    pub fn edge(&self, name: &str) -> usize {
        self.edges
            .iter()
            .position(|e| e.name == name)
            .unwrap_or_else(|| panic!("{}: no edge {name}", self.name))
    }

    pub fn outline(&self) -> Vec<Vec2> {
        self.edges
            .iter()
            .flat_map(|e| e.pts[..e.pts.len() - 1].iter().copied())
            .collect()
    }

    /// Edge index of internal line `k` in the panel's flat edge numbering (boundary edges
    /// first, then internal lines), as used by `EdgeRef` and `MeshedPattern::edge_vertices`.
    pub fn inner_index(&self, k: usize) -> usize {
        self.edges.len() + k
    }

    pub fn area(&self) -> f32 {
        let o = self.outline();
        (0..o.len())
            .map(|i| o[i].perp_dot(o[(i + 1) % o.len()]))
            .sum::<f32>()
            .abs()
            * 0.5
    }
}

/// One edge of a seam chain: (panel, flat edge index, traversed backwards).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EdgeRef {
    pub panel: usize,
    pub edge: usize,
    pub backward: bool,
}

/// Seam between chain `a` and chain `b`. Each chain is a run of consecutive edges. If both
/// chains have the same number of edges they are paired edge by edge (so the landmarks between
/// them, e.g. notches, meet); otherwise (or with `by_length`) as whole chains. `reversed`:
/// `a`'s start meets `b`'s end. A chain may span panels: each edge after the first contributes
/// its vertices except its start (at a panel change that start is sewn to the previous edge's
/// end by another seam).
#[derive(Debug, Clone)]
pub struct Seam {
    pub name: String,
    pub a: Vec<EdgeRef>,
    pub b: Vec<EdgeRef>,
    pub reversed: bool,
    pub by_length: bool,
}

impl Seam {
    /// A seam between two single forward edges.
    pub fn simple(
        name: impl Into<String>,
        a: (usize, usize),
        b: (usize, usize),
        reversed: bool,
    ) -> Self {
        let r = |(panel, edge)| {
            vec![EdgeRef {
                panel,
                edge,
                backward: false,
            }]
        };
        Self {
            name: name.into(),
            a: r(a),
            b: r(b),
            reversed,
            by_length: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Pattern {
    pub panels: Vec<Panel>,
    pub seams: Vec<Seam>,
}

impl Pattern {
    pub fn edge(&self, r: EdgeRef) -> &PatternEdge {
        let p = &self.panels[r.panel];
        if r.edge < p.edges.len() {
            &p.edges[r.edge]
        } else {
            &p.inner[r.edge - p.edges.len()]
        }
    }

    pub fn chain_length(&self, chain: &[EdgeRef]) -> f32 {
        chain.iter().map(|&r| self.edge(r).length()).sum()
    }

    pub fn area(&self) -> f32 {
        self.panels.iter().map(Panel::area).sum()
    }
}

/// Quadratic Bézier from `p0` to `p2` with control `p1`, as `n` segments.
pub fn bezier(p0: Vec2, p1: Vec2, p2: Vec2, n: usize) -> Vec<Vec2> {
    (0..=n)
        .map(|k| {
            let t = k as f32 / n as f32;
            (1.0 - t) * (1.0 - t) * p0 + 2.0 * (1.0 - t) * t * p1 + t * t * p2
        })
        .collect()
}

pub fn point_in_polygon(p: Vec2, poly: &[Vec2]) -> bool {
    let mut inside = false;
    let n = poly.len();
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            inside = !inside;
        }
    }
    inside
}

pub fn dist_to_segment(p: Vec2, a: Vec2, b: Vec2) -> f32 {
    let ab = b - a;
    let t = ((p - a).dot(ab) / ab.length_squared().max(1e-12)).clamp(0.0, 1.0);
    p.distance(a + t * ab)
}

pub fn dist_to_polygon(p: Vec2, poly: &[Vec2]) -> f32 {
    let n = poly.len();
    (0..n)
        .map(|i| dist_to_segment(p, poly[i], poly[(i + 1) % n]))
        .fold(f32::MAX, f32::min)
}

pub fn dist_to_polyline(p: Vec2, line: &[Vec2]) -> f32 {
    line.windows(2)
        .map(|w| dist_to_segment(p, w[0], w[1]))
        .fold(f32::MAX, f32::min)
}
