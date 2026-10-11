//! 2D sewing patterns: panels bounded by named edges (polylines, metres), and seams pairing
//! edges. No DXF in the spike; the T-shirt is generated in code.

use glam::Vec2;

#[derive(Debug, Clone)]
pub struct PatternEdge {
    pub name: &'static str,
    /// Polyline from this edge's start corner to the next edge's start corner.
    pub pts: Vec<Vec2>,
}

impl PatternEdge {
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
            while seg + 1 < self.pts.len() - 1 && acc + self.pts[seg].distance(self.pts[seg + 1]) < target {
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

/// A closed panel: edges in counter-clockwise order, each starting where the previous ended.
#[derive(Debug, Clone)]
pub struct Panel {
    pub name: &'static str,
    pub edges: Vec<PatternEdge>,
}

impl Panel {
    pub fn edge(&self, name: &str) -> usize {
        self.edges.iter().position(|e| e.name == name).unwrap_or_else(|| panic!("{}: no edge {name}", self.name))
    }

    pub fn outline(&self) -> Vec<Vec2> {
        self.edges.iter().flat_map(|e| e.pts[..e.pts.len() - 1].iter().copied()).collect()
    }
}

/// Seam between edge `a` of panel `pa` and edge `b` of panel `pb`. `reversed`: `a`'s start
/// meets `b`'s end.
#[derive(Debug, Clone)]
pub struct Seam {
    pub name: &'static str,
    pub a: (usize, usize),
    pub b: (usize, usize),
    pub reversed: bool,
}

#[derive(Debug, Clone)]
pub struct Pattern {
    pub panels: Vec<Panel>,
    pub seams: Vec<Seam>,
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

pub fn dist_to_polygon(p: Vec2, poly: &[Vec2]) -> f32 {
    let n = poly.len();
    (0..n)
        .map(|i| {
            let (a, b) = (poly[i], poly[(i + 1) % n]);
            let ab = b - a;
            let t = ((p - a).dot(ab) / ab.length_squared().max(1e-12)).clamp(0.0, 1.0);
            p.distance(a + t * ab)
        })
        .fold(f32::MAX, f32::min)
}
