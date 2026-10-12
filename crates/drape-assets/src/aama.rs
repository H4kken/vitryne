//! DXF-AAMA (ASTM D6673) pattern pieces. Each piece is a BLOCK; what matters is on these
//! layers (the standard's layer table):
//!   1  boundary (cut line, closed polyline), and "Piece Name:" / "Quantity:" text
//!   2  turn points (corners of the boundary)
//!   4  notches (a slit LINE or a POINT on the boundary)
//!   6  mirror line (the piece is cut on the fold: unfolded here)
//!   7  grain line
//!   8  internal lines
//!   14 sew line (if present, it is the garment's real outline, and is used instead of 1)
//! Other layers (curve points 3, grade reference 5, drill holes 13, ...) are ignored, and
//! counted in the report. DXF carries no sewing information: seams come from garment.toml.
//!
//! Landmarks are the points garment.toml refers to: turn points, notches, fold ends, and the
//! points where an internal line meets the boundary, numbered in boundary order (CCW).

use glam::{DVec2, Vec2};
use serde::Serialize;

use crate::dxf::{self, Entity};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum LandmarkKind {
    Turn,
    Notch,
    /// End of the fold (mirror line) on the unfolded outline: e.g. centre-front neck and hem.
    FoldEnd,
    /// Where an internal line touches the boundary.
    LineEnd,
}

#[derive(Debug, Clone, Serialize)]
pub struct Landmark {
    /// Boundary vertex index.
    pub at: usize,
    pub kind: LandmarkKind,
}

#[derive(Debug, Clone)]
pub struct InnerLine {
    pub pts: Vec<Vec2>,
    /// Vertex indices into `pts`: both ends and every turn (> 15°), in order.
    pub landmarks: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct Piece {
    pub name: String,
    pub quantity: u32,
    /// Closed outline in metres, counter-clockwise, no repeated end point.
    pub boundary: Vec<Vec2>,
    /// Sorted by `at`.
    pub landmarks: Vec<Landmark>,
    pub grain: Option<(Vec2, Vec2)>,
    /// True if the piece was cut on the fold and has been unfolded about its mirror line.
    pub unfolded: bool,
    pub inner: Vec<InnerLine>,
    /// The outline came from the sew line (layer 14) rather than the cut line (layer 1).
    pub from_sew_line: bool,
}

impl Piece {
    pub fn landmark_pos(&self, k: usize) -> Vec2 {
        self.boundary[self.landmarks[k].at]
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportReport {
    pub units_m: f64,
    pub pieces: Vec<String>,
    /// Blocks without a closed boundary on layer 1/14 (title blocks etc.).
    pub blocks_without_boundary: Vec<String>,
    /// Entities on layers this importer doesn't use: (layer, count).
    pub ignored_layers: Vec<(String, usize)>,
    pub skipped_entity_types: Vec<(String, usize)>,
    /// Arc (bulge) segments imported as straight chords.
    pub bulge_segments: usize,
    pub warnings: Vec<String>,
}

/// Distance under which a point counts as on the boundary or the mirror line, m.
const ON_TOL: f64 = 5e-4;

fn signed_area(p: &[DVec2]) -> f64 {
    (0..p.len())
        .map(|i| p[i].perp_dot(p[(i + 1) % p.len()]))
        .sum::<f64>()
        * 0.5
}

/// Nearest point on the closed polyline: (segment index, projected point, distance).
fn project(boundary: &[DVec2], p: DVec2) -> (usize, DVec2, f64) {
    let n = boundary.len();
    let mut best = (0, boundary[0], f64::MAX);
    for i in 0..n {
        let (a, b) = (boundary[i], boundary[(i + 1) % n]);
        let ab = b - a;
        let t = ((p - a).dot(ab) / ab.length_squared().max(1e-18)).clamp(0.0, 1.0);
        let q = a + t * ab;
        let d = q.distance(p);
        if d < best.2 {
            best = (i, q, d);
        }
    }
    best
}

/// Puts `p` on the boundary: snaps to a vertex within 0.1 mm, else splits the nearest segment.
/// Returns the boundary point used.
fn insert_on_boundary(boundary: &mut Vec<DVec2>, p: DVec2) -> DVec2 {
    let (i, q, _) = project(boundary, p);
    let n = boundary.len();
    for k in [i, (i + 1) % n] {
        if boundary[k].distance(q) < 1e-4 {
            return boundary[k];
        }
    }
    boundary.insert(i + 1, q);
    q
}

fn turn_deg(a: DVec2, b: DVec2, c: DVec2) -> f64 {
    let (u, v) = (b - a, c - b);
    u.perp_dot(v).atan2(u.dot(v)).abs().to_degrees()
}

struct Mirror {
    o: DVec2,
    d: DVec2,
}

impl Mirror {
    fn dist(&self, p: DVec2) -> f64 {
        self.d.perp_dot(p - self.o)
    }
    fn apply(&self, p: DVec2) -> DVec2 {
        let q = p - self.o;
        self.o + 2.0 * q.dot(self.d) * self.d - q
    }
}

/// Reads every piece of a DXF-AAMA file.
pub fn read(text: &str) -> Result<(Vec<Piece>, ImportReport), String> {
    read_with_units(text, None)
}

/// As `read`, with an explicit unit (metres per drawing unit) overriding `$INSUNITS`.
pub fn read_with_units(
    text: &str,
    units_m: Option<f64>,
) -> Result<(Vec<Piece>, ImportReport), String> {
    let d = dxf::parse(text)?;
    let unit = units_m.unwrap_or_else(|| d.unit_m());
    let mut report = ImportReport {
        units_m: unit,
        skipped_entity_types: d.skipped.iter().map(|(k, v)| (k.clone(), *v)).collect(),
        ..Default::default()
    };
    let mut ignored: std::collections::BTreeMap<String, usize> = Default::default();
    let mut pieces = Vec::new();
    // Pieces live in blocks; a file without blocks gets its ENTITIES read as one block.
    let loose = dxf::Block {
        name: "piece".into(),
        entities: d.entities.clone(),
    };
    let blocks: Vec<&dxf::Block> = if d.blocks.is_empty() {
        vec![&loose]
    } else {
        d.blocks.iter().collect()
    };
    for b in blocks {
        match piece_from_block(b, unit, &mut report, &mut ignored)? {
            Some(p) => {
                report.pieces.push(p.name.clone());
                pieces.push(p);
            }
            None => report.blocks_without_boundary.push(b.name.clone()),
        }
    }
    report.ignored_layers = ignored.into_iter().collect();
    Ok((pieces, report))
}

fn piece_from_block(
    b: &dxf::Block,
    unit: f64,
    report: &mut ImportReport,
    ignored: &mut std::collections::BTreeMap<String, usize>,
) -> Result<Option<Piece>, String> {
    let s = |p: DVec2| p * unit;
    let closed_on = |layer: &str| {
        b.entities
            .iter()
            .filter_map(|e| match e {
                Entity::Polyline {
                    layer: l,
                    pts,
                    closed,
                    bulges,
                } if l == layer
                    && (*closed
                        || (pts.len() > 3
                            && pts[0].distance(*pts.last().unwrap()) * unit < ON_TOL)) =>
                {
                    Some((pts, *bulges))
                }
                _ => None,
            })
            .max_by(|a, b| {
                signed_area(a.0)
                    .abs()
                    .partial_cmp(&signed_area(b.0).abs())
                    .unwrap()
            })
    };
    let (outline, from_sew_line) = match (closed_on("14"), closed_on("1")) {
        (Some(o), _) => (o, true),
        (None, Some(o)) => (o, false),
        (None, None) => return Ok(None),
    };
    report.bulge_segments += outline.1;
    let mut boundary: Vec<DVec2> = outline.0.iter().map(|&p| s(p)).collect();
    if boundary.len() > 1 && boundary[0].distance(*boundary.last().unwrap()) < ON_TOL {
        boundary.pop();
    }
    boundary.dedup_by(|a, b| a.distance(*b) < 1e-7);
    if signed_area(&boundary) < 0.0 {
        boundary.reverse();
    }

    let mut name = b.name.clone();
    let mut quantity = 1;
    let (mut turns, mut notches, mut mirror, mut grain, mut inner) =
        (Vec::new(), Vec::new(), None, None, Vec::new());
    for e in &b.entities {
        match (e.layer(), e) {
            ("1", Entity::Text { text, .. }) => {
                let t = text.trim();
                let lower = t.to_ascii_lowercase();
                if let Some(v) = lower.strip_prefix("piece name:") {
                    name = t[t.len() - v.len()..].trim().to_string();
                } else if let Some(v) = lower.strip_prefix("quantity:") {
                    quantity = v.trim().parse().unwrap_or(1);
                }
            }
            ("1" | "14", Entity::Polyline { .. }) => {}
            ("2", Entity::Point { p, .. }) => turns.push(s(*p)),
            ("4", Entity::Point { p, .. }) => notches.push(s(*p)),
            ("4", Entity::Line { a, b: bb, .. }) => {
                // The slit's end on the boundary marks the notch.
                let (a, bb) = (s(*a), s(*bb));
                notches.push(if project(&boundary, a).2 <= project(&boundary, bb).2 {
                    a
                } else {
                    bb
                });
            }
            ("6", Entity::Line { a, b: bb, .. }) => mirror = Some((s(*a), s(*bb))),
            ("7", Entity::Line { a, b: bb, .. }) => grain = Some((s(*a), s(*bb))),
            ("8", Entity::Polyline { pts, .. }) => {
                inner.push(pts.iter().map(|&p| s(p)).collect::<Vec<_>>())
            }
            ("8", Entity::Line { a, b: bb, .. }) => inner.push(vec![s(*a), s(*bb)]),
            (layer, _) => *ignored.entry(layer.to_string()).or_default() += 1,
        }
    }

    // Landmark positions; they are turned into vertex indices at the end.
    let mut marks: Vec<(DVec2, LandmarkKind)> = Vec::new();
    if turns.is_empty() {
        // No layer 2: corners are where the outline turns by more than 20°.
        let n = boundary.len();
        for i in 0..n {
            if turn_deg(
                boundary[(i + n - 1) % n],
                boundary[i],
                boundary[(i + 1) % n],
            ) > 20.0
            {
                marks.push((boundary[i], LandmarkKind::Turn));
            }
        }
    }
    for t in turns {
        if project(&boundary, t).2 > 1e-3 {
            report.warnings.push(format!(
                "{name}: turn point {t:?} is {:.1} mm off the boundary",
                project(&boundary, t).2 * 1000.0
            ));
            continue;
        }
        let q = insert_on_boundary(&mut boundary, t);
        marks.push((q, LandmarkKind::Turn));
    }
    for t in notches {
        if project(&boundary, t).2 > 2e-3 {
            report.warnings.push(format!(
                "{name}: notch {t:?} is {:.1} mm off the boundary",
                project(&boundary, t).2 * 1000.0
            ));
            continue;
        }
        let q = insert_on_boundary(&mut boundary, t);
        marks.push((q, LandmarkKind::Notch));
    }

    let mut unfolded = false;
    if let Some((a, bb)) = mirror {
        let m = Mirror {
            o: a,
            d: (bb - a).normalize(),
        };
        // A bad mirror line on one piece shouldn't stop the others from importing: keep this
        // piece as drawn (folded) and say so.
        let (b0, m0, i0) = (boundary.clone(), marks.clone(), inner.clone());
        match unfold(&mut boundary, &mut marks, &mut inner, &m) {
            Ok(()) => unfolded = true,
            Err(e) => {
                report.warnings.push(format!("{name}: not unfolded: {e}"));
                (boundary, marks, inner) = (b0, m0, i0);
            }
        }
        grain = grain.or(Some((a, bb)));
    }

    // Internal lines: ends that touch the boundary become boundary landmarks.
    let mut inner_lines = Vec::new();
    for mut line in inner {
        line.dedup_by(|a, b| a.distance(*b) < 1e-7);
        if line.len() < 2 {
            continue;
        }
        for end in [0, line.len() - 1] {
            if project(&boundary, line[end]).2 < ON_TOL {
                let q = insert_on_boundary(&mut boundary, line[end]);
                line[end] = q;
                marks.push((q, LandmarkKind::LineEnd));
            }
        }
        let mut lm = vec![0];
        for k in 1..line.len() - 1 {
            if turn_deg(line[k - 1], line[k], line[k + 1]) > 15.0 {
                lm.push(k);
            }
        }
        lm.push(line.len() - 1);
        inner_lines.push(InnerLine {
            pts: line.iter().map(|p| p.as_vec2()).collect(),
            landmarks: lm,
        });
    }

    let mut landmarks: Vec<Landmark> = marks
        .iter()
        .map(|(q, kind)| Landmark {
            at: boundary
                .iter()
                .position(|p| p == q)
                .expect("landmark is a boundary vertex"),
            kind: *kind,
        })
        .collect();
    landmarks.sort_by_key(|l| l.at);
    // One landmark per vertex; a turn point wins over a notch at the same place.
    landmarks.dedup_by(|later, first| {
        if later.at == first.at {
            if later.kind == LandmarkKind::Turn {
                first.kind = LandmarkKind::Turn;
            }
            true
        } else {
            false
        }
    });
    Ok(Some(Piece {
        name,
        quantity,
        boundary: boundary.iter().map(|p| p.as_vec2()).collect(),
        landmarks,
        grain: grain.map(|(a, b)| (a.as_vec2(), b.as_vec2())),
        unfolded,
        inner: inner_lines,
        from_sew_line,
    }))
}

/// Unfolds a cut-on-fold piece: the boundary must touch the mirror line along one run (the
/// fold) and lie on one side of it otherwise. The result is the kept half plus its mirror
/// image; landmarks and internal lines are mirrored too.
fn unfold(
    boundary: &mut Vec<DVec2>,
    marks: &mut Vec<(DVec2, LandmarkKind)>,
    inner: &mut Vec<Vec<DVec2>>,
    m: &Mirror,
) -> Result<(), String> {
    let n = boundary.len();
    let on: Vec<bool> = boundary.iter().map(|&p| m.dist(p).abs() < ON_TOL).collect();
    let s = (0..n)
        .find(|&i| on[i] && !on[(i + 1) % n])
        .ok_or("mirror line doesn't touch the boundary along a fold")?;
    let mut kept = vec![boundary[s]];
    let mut i = (s + 1) % n;
    while !on[i] {
        kept.push(boundary[i]);
        i = (i + 1) % n;
    }
    kept.push(boundary[i]);
    let e = i;
    // Everything from e back round to s must be the fold.
    let mut j = e;
    while j != s {
        if !on[j] {
            return Err("the outline crosses the mirror line more than once".into());
        }
        j = (j + 1) % n;
    }
    let side = m.dist(kept[1]).signum();
    if kept[1..kept.len() - 1]
        .iter()
        .any(|&p| m.dist(p).signum() != side)
    {
        return Err("the outline lies on both sides of the mirror line".into());
    }
    // Snap the fold ends onto the line, so the mirrored halves meet exactly.
    let snap = |p: DVec2| m.o + (p - m.o).dot(m.d) * m.d;
    let (ps, pe) = (snap(kept[0]), snap(*kept.last().unwrap()));
    for mk in marks.iter_mut() {
        if mk.0 == kept[0] {
            mk.0 = ps;
        } else if mk.0 == *kept.last().unwrap() {
            mk.0 = pe;
        }
    }
    *kept.first_mut().unwrap() = ps;
    *kept.last_mut().unwrap() = pe;
    let mut out = kept.clone();
    out.extend(kept[1..kept.len() - 1].iter().rev().map(|&p| m.apply(p)));
    *boundary = out;
    // Landmarks on the fold itself (fold corners) become the two fold ends.
    marks.retain(|(p, _)| m.dist(*p).abs() >= ON_TOL);
    let mirrored: Vec<_> = marks.iter().map(|&(p, k)| (m.apply(p), k)).collect();
    marks.extend(mirrored);
    marks.push((ps, LandmarkKind::FoldEnd));
    marks.push((pe, LandmarkKind::FoldEnd));
    // Internal lines: a line ending on the fold is joined with its image; others are copied.
    let mut lines = Vec::new();
    for mut l in inner.drain(..) {
        if m.dist(l[0]).abs() < ON_TOL {
            l.reverse();
        }
        if m.dist(*l.last().unwrap()).abs() < ON_TOL {
            let last = l.len() - 1;
            l[last] = snap(l[last]);
            let image: Vec<DVec2> = l[..last].iter().rev().map(|&p| m.apply(p)).collect();
            l.extend(image);
            lines.push(l);
        } else {
            lines.push(l.iter().map(|&p| m.apply(p)).collect());
            lines.push(l);
        }
    }
    *inner = lines;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dxf_block(name: &str, body: &str) -> String {
        format!(
            "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n8\n1\n2\n{name}\n70\n0\n10\n0\n20\n0\n3\n{name}\n{body}0\nENDBLK\n8\n1\n0\nENDSEC\n0\nEOF\n"
        )
    }
    fn poly(layer: u32, pts: &[(f64, f64)], closed: bool) -> String {
        let mut s = format!("0\nPOLYLINE\n8\n{layer}\n66\n1\n70\n{}\n", u8::from(closed));
        for (x, y) in pts {
            s += &format!("0\nVERTEX\n8\n{layer}\n10\n{x}\n20\n{y}\n");
        }
        s + &format!("0\nSEQEND\n8\n{layer}\n")
    }
    fn line(layer: u32, a: (f64, f64), b: (f64, f64)) -> String {
        format!(
            "0\nLINE\n8\n{layer}\n10\n{}\n20\n{}\n11\n{}\n21\n{}\n",
            a.0, a.1, b.0, b.1
        )
    }

    #[test]
    fn half_front_on_fold_unfolds_with_landmarks() {
        // Half a front: fold along x = 0 from (0,0) to (0,500); clockwise on purpose.
        let half = [
            (0.0, 0.0),
            (0.0, 500.0),
            (150.0, 520.0),
            (240.0, 300.0),
            (230.0, 0.0),
        ];
        let mut body = poly(1, &half, true);
        for p in [
            (0.0, 0.0),
            (0.0, 500.0),
            (150.0, 520.0),
            (240.0, 300.0),
            (230.0, 0.0),
        ] {
            body += &format!("0\nPOINT\n8\n2\n10\n{}\n20\n{}\n", p.0, p.1);
        }
        body += &line(4, (235.0, 150.0), (231.0, 150.0)); // notch slit, outer end first
        body += &line(6, (0.0, 20.0), (0.0, 480.0));
        body += &poly(8, &[(100.0, 0.0), (100.0, 100.0), (0.0, 100.0)], false); // pocket-like line
        body += "0\nTEXT\n8\n1\n10\n0\n20\n0\n40\n5\n1\nPiece Name: Front\n0\nTEXT\n8\n1\n10\n0\n20\n0\n40\n5\n1\nQuantity: 1\n";
        body += "0\nPOINT\n8\n13\n10\n50\n20\n50\n"; // drill hole: ignored
        let (pieces, rep) = read(&dxf_block("B", &body)).unwrap();
        assert_eq!(rep.pieces, vec!["Front"]);
        assert_eq!(rep.ignored_layers, vec![("13".to_string(), 1)]);
        let p = &pieces[0];
        assert!(p.unfolded);
        // Full width 0.48 m, symmetric, counter-clockwise.
        let xs: Vec<f32> = p.boundary.iter().map(|q| q.x).collect();
        assert!((xs.iter().cloned().fold(f32::MIN, f32::max) - 0.24).abs() < 1e-5);
        assert!((xs.iter().cloned().fold(f32::MAX, f32::min) + 0.24).abs() < 1e-5);
        let area: f32 = (0..p.boundary.len())
            .map(|i| p.boundary[i].perp_dot(p.boundary[(i + 1) % p.boundary.len()]))
            .sum::<f32>()
            * 0.5;
        assert!(area > 0.0);
        // Landmarks: 2 fold ends + 3 corners × 2 + 2 notches + 2 pocket-line ends on the hem.
        let count = |k| p.landmarks.iter().filter(|l| l.kind == k).count();
        assert_eq!(count(LandmarkKind::FoldEnd), 2);
        assert_eq!(count(LandmarkKind::Turn), 6);
        assert_eq!(count(LandmarkKind::Notch), 2);
        assert_eq!(count(LandmarkKind::LineEnd), 2);
        // The pocket line ends on the fold, so it is joined with its image into one line.
        assert_eq!(p.inner.len(), 1);
        let l = &p.inner[0];
        assert!(
            (l.pts[0] - Vec2::new(0.1, 0.0)).length() < 1e-6
                || (l.pts[0] - Vec2::new(-0.1, 0.0)).length() < 1e-6
        );
        assert_eq!(l.landmarks.len(), 4); // two ends + two corners
        assert!(p.landmarks.windows(2).all(|w| w[0].at < w[1].at));
    }

    #[test]
    fn mirror_line_off_the_outline_is_a_warning() {
        let mut body = poly(
            1,
            &[(10.0, 0.0), (100.0, 0.0), (100.0, 50.0), (10.0, 50.0)],
            true,
        );
        body += &line(6, (0.0, 0.0), (0.0, 50.0));
        let (pieces, rep) = read(&dxf_block("facing", &body)).unwrap();
        assert!(!pieces[0].unfolded);
        assert_eq!(pieces[0].boundary.len(), 4);
        assert!(
            rep.warnings[0].contains("not unfolded"),
            "{:?}",
            rep.warnings
        );
    }

    #[test]
    fn sew_line_wins_and_corners_are_detected_without_layer_2() {
        let mut body = poly(
            1,
            &[(-10.0, -10.0), (110.0, -10.0), (110.0, 60.0), (-10.0, 60.0)],
            true,
        );
        body += &poly(
            14,
            &[(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)],
            true,
        );
        let (pieces, _) = read(&dxf_block("rect", &body)).unwrap();
        let p = &pieces[0];
        assert!(p.from_sew_line);
        assert_eq!(p.name, "rect");
        assert_eq!(p.landmarks.len(), 4);
        assert!((p.boundary.iter().map(|q| q.x).fold(f32::MIN, f32::max) - 0.1).abs() < 1e-6);
    }
}
