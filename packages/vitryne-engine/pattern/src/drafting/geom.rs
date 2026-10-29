// SPDX-License-Identifier: AGPL-3.0-or-later
//! The plane geometry the drafting tools use, as the apps define it.
//!
//! Coordinates are the apps' scene units: pixels at 96 per inch, y pointing down. Angles are
//! degrees, counter-clockwise as seen on screen (0 points right, 90 up), as Qt's `QLineF`
//! measures them. Working in the same units keeps the apps' tolerances (a tenth of a
//! millimetre on a line, a one-pixel search step) exactly as they are.

use glam::DVec2;

/// Scene pixels per millimetre.
pub const PX_PER_MM: f64 = 96.0 / 25.4;

/// How close a point must be to count as on a line or a curve (the apps' 0.1555 mm).
pub const ON_LINE: f64 = 0.1555 * PX_PER_MM;

/// The angle of `a → b`, in [0, 360).
pub fn angle(a: DVec2, b: DVec2) -> f64 {
    let d = b - a;
    if d.x == 0.0 && d.y == 0.0 {
        return 0.0;
    }
    let deg = (-d.y).atan2(d.x).to_degrees();
    if deg < 0.0 { deg + 360.0 } else { deg }
}

/// The point `len` from `o` at `deg` (a negative length goes the other way).
pub fn polar(o: DVec2, deg: f64, len: f64) -> DVec2 {
    let r = deg.to_radians();
    o + DVec2::new(r.cos(), -r.sin()) * len
}

/// `from`'s angle turned counter-clockwise to `to`'s, in [0, 360) (Qt's `angleTo`).
pub fn angle_to(from: f64, to: f64) -> f64 {
    (to - from).rem_euclid(360.0)
}

/// `p` turned `deg` about `o`.
pub fn rotate(o: DVec2, p: DVec2, deg: f64) -> DVec2 {
    polar(o, angle(o, p) + deg, o.distance(p))
}

/// `p` mirrored in the line through `a` and `b`.
pub fn mirror(a: DVec2, b: DVec2, p: DVec2) -> DVec2 {
    let d = (b - a).normalize_or_zero();
    let q = p - a;
    a + 2.0 * q.dot(d) * d - q
}

/// Equal within the apps' fuzzy compare (relative 1e-12, or both near zero).
pub fn fuzzy_eq(a: f64, b: f64) -> bool {
    if a.abs() < 1e-12 || b.abs() < 1e-12 {
        (a - b).abs() < 1e-12
    } else {
        (a - b).abs() * 1e12 <= a.abs().min(b.abs())
    }
}

pub fn same_point(a: DVec2, b: DVec2) -> bool {
    a.distance(b) <= ON_LINE
}

/// Where the infinite lines `a1 a2` and `b1 b2` cross; `None` if parallel.
pub fn line_intersection(a1: DVec2, a2: DVec2, b1: DVec2, b2: DVec2) -> Option<DVec2> {
    let (da, db) = (a2 - a1, b2 - b1);
    let den = da.perp_dot(db);
    if den.abs() < 1e-12 {
        return None;
    }
    let t = (b1 - a1).perp_dot(db) / den;
    Some(a1 + da * t)
}

/// Where segments `a1 a2` and `b1 b2` cross, ends included.
pub fn segment_intersection(a1: DVec2, a2: DVec2, b1: DVec2, b2: DVec2) -> Option<DVec2> {
    let (da, db) = (a2 - a1, b2 - b1);
    let den = da.perp_dot(db);
    if den.abs() < 1e-12 {
        return None;
    }
    let t = (b1 - a1).perp_dot(db) / den;
    let u = (b1 - a1).perp_dot(da) / den;
    let eps = 1e-9;
    ((-eps..=1.0 + eps).contains(&t) && (-eps..=1.0 + eps).contains(&u)).then(|| a1 + da * t)
}

/// The foot of the perpendicular from `p` to the infinite line `a b`.
pub fn closest_on_line(a: DVec2, b: DVec2, p: DVec2) -> DVec2 {
    let d = b - a;
    let l2 = d.length_squared();
    if l2 == 0.0 {
        return a;
    }
    a + d * ((p - a).dot(d) / l2)
}

/// `p` lies on segment `a b`, within `ON_LINE`.
pub fn on_segment(p: DVec2, a: DVec2, b: DVec2) -> bool {
    let d = b - a;
    let l2 = d.length_squared();
    let t = if l2 == 0.0 {
        0.0
    } else {
        ((p - a).dot(d) / l2).clamp(0.0, 1.0)
    };
    (a + d * t).distance(p) <= ON_LINE
}

/// Where a circle meets the infinite line `a b`: 0, 1 (tangent) or 2 points, in the order the
/// apps' `LineIntersectCircle` gives them (the order decides which one a tool picks).
pub fn line_circle(c: DVec2, r: f64, a: DVec2, b: DVec2) -> Vec<DVec2> {
    if a.distance(b) < 1e-12 {
        return Vec::new();
    }
    // Line coefficients as the apps write them.
    let (la, lb) = (b.y - a.y, a.x - b.x);
    let p = closest_on_line(a, b, c);
    let d = c.distance(p);
    let two = if fuzzy_eq(d, r) {
        false
    } else if r > d {
        true
    } else {
        return Vec::new();
    };
    let k = (r * r - d * d).abs().sqrt();
    let t = DVec2::new(lb, -la).length();
    let p1 = p + DVec2::new(-lb, la) * (k / t);
    let p2 = p + DVec2::new(lb, -la) * (k / t);
    if two { vec![p1, p2] } else { vec![p1] }
}

/// Where two circles meet, in the apps' order; `None` when they are the same circle.
pub fn circle_circle(c1: DVec2, r1: f64, c2: DVec2, r2: f64) -> Option<Vec<DVec2>> {
    if fuzzy_eq(c1.x, c2.x) && fuzzy_eq(c1.y, c2.y) && fuzzy_eq(r1, r2) {
        return None;
    }
    let a = -2.0 * (c2.x - c1.x);
    let b = -2.0 * (c2.y - c1.y);
    let c = (c2 - c1).length_squared() + r1 * r1 - r2 * r2;
    let ab = a * a + b * b;
    let (x0, y0) = (-a * c / ab, -b * c / ab);
    if c * c > r1 * r1 * ab {
        return Some(Vec::new());
    }
    if fuzzy_eq(c * c, r1 * r1 * ab) {
        return Some(vec![DVec2::new(x0, y0) + c1]);
    }
    let mult = ((r1 * r1 - c * c / ab) / ab).sqrt();
    Some(vec![
        DVec2::new(x0 + b * mult, y0 - a * mult) + c1,
        DVec2::new(x0 - b * mult, y0 + a * mult) + c1,
    ])
}

/// The points where tangents from `p` touch the circle, in the apps' order.
pub fn tangent_points(p: DVec2, c: DVec2, r: f64) -> Vec<DVec2> {
    let d = p.distance(c);
    if fuzzy_eq(r, d) {
        return vec![p];
    }
    if r > d {
        return Vec::new();
    }
    let k = (d * d - r * r).sqrt();
    circle_circle(p, k, c, r).unwrap_or_default()
}

/// One cubic Bézier segment.
pub type Cubic = [DVec2; 4];

pub fn cubic_at(c: &Cubic, t: f64) -> DVec2 {
    let s = 1.0 - t;
    c[0] * (s * s * s) + c[1] * (3.0 * s * s * t) + c[2] * (3.0 * s * t * t) + c[3] * (t * t * t)
}

fn cubic_speed(c: &Cubic, t: f64) -> f64 {
    let s = 1.0 - t;
    ((c[1] - c[0]) * (3.0 * s * s) + (c[2] - c[1]) * (6.0 * s * t) + (c[3] - c[2]) * (3.0 * t * t))
        .length()
}

/// Arc length from 0 to `t` (Gauss-Legendre over 16 pieces).
pub fn cubic_length_to(c: &Cubic, t: f64) -> f64 {
    const X: [f64; 5] = [
        0.0,
        -0.538_469_310_105_683,
        0.538_469_310_105_683,
        -0.906_179_845_938_664,
        0.906_179_845_938_664,
    ];
    const W: [f64; 5] = [
        0.568_888_888_888_889,
        0.478_628_670_499_366,
        0.478_628_670_499_366,
        0.236_926_885_056_189,
        0.236_926_885_056_189,
    ];
    let n = 16;
    let h = t / n as f64;
    let mut sum = 0.0;
    for k in 0..n {
        let (a, b) = (k as f64 * h, (k + 1) as f64 * h);
        let (m, r) = ((a + b) / 2.0, (b - a) / 2.0);
        for i in 0..5 {
            sum += W[i] * r * cubic_speed(c, m + r * X[i]);
        }
    }
    sum
}

pub fn cubic_length(c: &Cubic) -> f64 {
    cubic_length_to(c, 1.0)
}

/// The parameter at arc length `len` (clamped to the curve), by bisection as the apps do.
pub fn cubic_t_at_length(c: &Cubic, len: f64) -> f64 {
    let total = cubic_length(c);
    if len <= 0.0 {
        return 0.0;
    }
    if len >= total {
        return 1.0;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..60 {
        let mid = (lo + hi) / 2.0;
        if cubic_length_to(c, mid) > len {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    (lo + hi) / 2.0
}

/// Splits at `t` (de Casteljau).
pub fn cubic_split(c: &Cubic, t: f64) -> (Cubic, Cubic) {
    let l = |a: DVec2, b: DVec2| a.lerp(b, t);
    let (p01, p12, p23) = (l(c[0], c[1]), l(c[1], c[2]), l(c[2], c[3]));
    let (p012, p123) = (l(p01, p12), l(p12, p23));
    let m = l(p012, p123);
    ([c[0], p01, p012, m], [m, p123, p23, c[3]])
}

pub fn cubic_reverse(c: &Cubic) -> Cubic {
    [c[3], c[2], c[1], c[0]]
}

/// Points along the curve, ends included, close enough for intersections (chord error under
/// a hundredth of a millimetre).
pub fn cubic_flatten(c: &Cubic, out: &mut Vec<DVec2>) {
    let tol = 0.01 * PX_PER_MM;
    // Subdivisions from the control polygon's deviation (Wang's formula).
    let dd = ((c[0] - c[1] * 2.0 + c[2]).length()).max((c[1] - c[2] * 2.0 + c[3]).length());
    let n = ((6.0 * dd / (8.0 * tol)).sqrt().ceil() as usize).clamp(1, 4096);
    if out.last().is_none_or(|&l| l != c[0]) {
        out.push(c[0]);
    }
    for k in 1..=n {
        out.push(cubic_at(c, k as f64 / n as f64));
    }
}

/// The sweep from `f1` counter-clockwise to `f2`; equal angles are a whole circle.
pub fn arc_sweep(f1: f64, f2: f64) -> f64 {
    let s = angle_to(f1, f2);
    if s.abs() < 1e-9 { 360.0 } else { s }
}

/// A circular arc from angle `f1` counter-clockwise to `f2`, as cubics of at most 45° each.
pub fn arc_cubics(center: DVec2, r: f64, f1: f64, f2: f64) -> Vec<Cubic> {
    let sweep = arc_sweep(f1, f2);
    let n = ((sweep / 45.0).ceil() as usize).max(1);
    let step = sweep / n as f64;
    let k = 4.0 / 3.0 * (step.to_radians() / 4.0).tan() * r;
    (0..n)
        .map(|i| {
            let a = f1 + step * i as f64;
            let b = a + step;
            let (p0, p3) = (polar(center, a, r), polar(center, b, r));
            [p0, polar(p0, a + 90.0, k), polar(p3, b - 90.0, k), p3]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: DVec2, b: DVec2) -> bool {
        a.distance(b) < 1e-9
    }

    #[test]
    fn angles_count_counter_clockwise_on_screen() {
        let o = DVec2::ZERO;
        assert_eq!(angle(o, DVec2::new(1.0, 0.0)), 0.0);
        assert_eq!(angle(o, DVec2::new(0.0, -1.0)), 90.0);
        assert_eq!(angle(o, DVec2::new(0.0, 1.0)), 270.0);
        assert!(close(polar(o, 270.0, 2.0), DVec2::new(0.0, 2.0)));
        assert!(close(polar(o, 0.0, -2.0), DVec2::new(-2.0, 0.0)));
        assert!(close(
            rotate(o, DVec2::new(1.0, 0.0), 90.0),
            DVec2::new(0.0, -1.0)
        ));
        assert_eq!(angle_to(350.0, 10.0), 20.0);
    }

    #[test]
    fn intersections() {
        let x = line_intersection(
            DVec2::ZERO,
            DVec2::new(2.0, 2.0),
            DVec2::new(0.0, 2.0),
            DVec2::new(2.0, 0.0),
        );
        assert!(close(x.unwrap(), DVec2::new(1.0, 1.0)));
        let ps = line_circle(
            DVec2::ZERO,
            1.0,
            DVec2::new(-5.0, 0.0),
            DVec2::new(5.0, 0.0),
        );
        assert_eq!(ps.len(), 2);
        assert!(ps.iter().all(|p| (p.length() - 1.0).abs() < 1e-12));
        let cs = circle_circle(DVec2::ZERO, 1.0, DVec2::new(1.0, 0.0), 1.0).unwrap();
        assert_eq!(cs.len(), 2);
        assert!(cs.iter().all(|p| (p.x - 0.5).abs() < 1e-12));
        assert!(circle_circle(DVec2::ZERO, 1.0, DVec2::ZERO, 1.0).is_none());
        let ts = tangent_points(DVec2::new(2.0, 0.0), DVec2::ZERO, 1.0);
        assert_eq!(ts.len(), 2);
        assert!(ts.iter().all(|p| (p.length() - 1.0).abs() < 1e-9));
    }

    #[test]
    fn cubic_lengths_and_cuts() {
        let line: Cubic = [
            DVec2::ZERO,
            DVec2::new(1.0, 0.0),
            DVec2::new(2.0, 0.0),
            DVec2::new(3.0, 0.0),
        ];
        assert!((cubic_length(&line) - 3.0).abs() < 1e-9);
        let t = cubic_t_at_length(&line, 1.5);
        assert!((cubic_at(&line, t).x - 1.5).abs() < 1e-9);
        let (a, b) = cubic_split(&line, 0.5);
        assert!(close(a[3], b[0]));
        // A quarter circle of radius 10.
        let arc = arc_cubics(DVec2::ZERO, 10.0, 0.0, 90.0);
        let len: f64 = arc.iter().map(cubic_length).sum();
        assert!((len - 5.0 * std::f64::consts::PI).abs() < 1e-4, "{len}");
        assert!(close(arc.last().unwrap()[3], DVec2::new(0.0, -10.0)));
        let full = arc_cubics(DVec2::ZERO, 1.0, 30.0, 30.0);
        assert_eq!(full.len(), 8);
    }
}
