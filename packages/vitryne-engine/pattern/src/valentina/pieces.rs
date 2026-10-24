// SPDX-License-Identifier: AGPL-3.0-or-later
//! A pattern's pieces as Vitryne pieces.
//!
//! A piece's main path lists points and curves in order. A curve runs between its neighbours:
//! from the point before it if that point lies on it (else from where the curve before it
//! crosses it, else from its start) to the point after it, the way the apps cut it. The
//! outline is the sewing line (FORMAT.md, Pieces), counter-clockwise, in mm with y up:
//!   - a curve becomes `cubic` edges (`VTRY_curves`), a spline path's joints `point` nodes;
//!   - a node is a `corner` where the outline turns more than 15° (the DXF importer's rule),
//!     else a `notch` if it carries a passmark, else a `point`;
//!   - internal paths become `lines`, the grainline `grain`, and a mirror line (Valentina 0.9.7
//!     and later) unfolds the piece about it with a `fold` between its ends.
//!
//! A piece that needs an object the tools couldn't make is refused with the reason.

use glam::DVec2;
use roxmltree::Node;
use serde_json::Map;

use vitryne_format::{
    Edge, Fold, Grain, Id, IdGen, Line, Node as FNode, NodeType, Piece, round_mm,
};

use super::{
    attr_f64, child, formula,
    geom::{self, Cubic, PX_PER_MM},
    tools::{Curve, Draft},
};

/// A turn sharper than this makes a corner, degrees.
const CORNER_DEG: f64 = 15.0;

/// Vertices closer than this are one (the format refuses nodes under 0.01 mm apart), mm.
const SAME_MM: f64 = 0.02;

/// The edge from a vertex to the next: straight, or a cubic with its two controls.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Seg {
    Line,
    Cubic(DVec2, DVec2),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Vertex {
    pub p: DVec2,
    pub kind: NodeType,
    notch: bool,
    pub edge: Seg,
}

/// A piece before it gets ids: mm, y up, counter-clockwise.
#[derive(Debug, Clone)]
pub struct Shape {
    pub name: String,
    pub quantity: u32,
    pub outline: Vec<Vertex>,
    /// Open paths (the last vertex's edge is unused).
    pub lines: Vec<(Option<String>, Vec<Vertex>)>,
    /// Outline indices of the fold's ends.
    pub fold: Option<(usize, usize)>,
    pub grain: Option<(DVec2, DVec2)>,
    pub warnings: Vec<String>,
}

enum Item {
    Point { p: DVec2, notch: bool },
    Curve(Curve),
}

/// The ids and options of a path's nodes, excluded ones left out.
fn path_nodes<'a, 'i>(path: Node<'a, 'i>) -> Vec<Node<'a, 'i>> {
    let holder = child(path, "nodes").unwrap_or(path);
    holder
        .children()
        .filter(|c| c.has_tag_name("node"))
        .filter(|c| c.attribute("excluded") != Some("true"))
        .collect()
}

fn items(draft: &Draft, nodes: &[Node]) -> Result<Vec<Item>, String> {
    let mut out = Vec::new();
    for n in nodes {
        let id: u32 = n
            .attribute("idObject")
            .and_then(|v| v.trim().parse().ok())
            .ok_or("a path node without an object")?;
        let reverse = matches!(n.attribute("reverse"), Some("1" | "true"));
        match n.attribute("type").unwrap_or("NodePoint") {
            "NodePoint" => out.push(Item::Point {
                p: draft.point(id)?.p,
                notch: n.attribute("passmark") == Some("true"),
            }),
            "NodeArc" | "NodeSpline" | "NodeSplinePath" | "NodeElArc" => {
                let mut c = draft.curve(id)?.clone();
                if reverse {
                    c.segs = c.segs.iter().rev().map(geom::cubic_reverse).collect();
                    c.ends = (c.ends.1, c.ends.0);
                    c.arc = None;
                }
                out.push(Item::Curve(c));
            }
            other => return Err(format!("path node type {other} is not supported")),
        }
    }
    Ok(out)
}

fn on_curve(c: &Curve, p: DVec2) -> bool {
    c.points()
        .windows(2)
        .any(|w| geom::on_segment(p, w[0], w[1]))
}

/// Where curve `other` crosses `c`, away from `c`'s ends.
fn crossing(c: &Curve, other: &Curve) -> Option<DVec2> {
    let (pts, o) = (c.points(), other.points());
    for w in pts.windows(2) {
        for v in o.windows(2) {
            if let Some(x) = geom::segment_intersection(w[0], w[1], v[0], v[1])
                && !geom::same_point(x, c.first())
                && !geom::same_point(x, c.last())
            {
                return Some(x);
            }
        }
    }
    None
}

/// Where curve `i` starts (`end`: ends) given its neighbour.
fn curve_bound(c: &Curve, neighbour: Option<&Item>, end: bool) -> DVec2 {
    let fallback = if end { c.last() } else { c.first() };
    match neighbour {
        Some(Item::Point { p, .. }) if on_curve(c, *p) => *p,
        Some(Item::Curve(o)) => crossing(c, o).unwrap_or(fallback),
        _ => fallback,
    }
}

/// The part of `c` between `from` and `to` (points on it).
fn trim(c: &Curve, from: DVec2, to: DVec2) -> Vec<Cubic> {
    let (s0, s1) = (c.length_to(from), c.length_to(to));
    if s1 <= s0 + 1e-9 {
        return c.segs.clone();
    }
    let (left, _, _) = c.cut_at_length(s1);
    let head = Curve {
        segs: left,
        ..c.clone()
    };
    let (_, right, _) = head.cut_at_length(s0);
    right
}

/// The vertices of a path through `items` (px, y down); `closed` joins the last to the first.
fn vertices(items: &[Item], closed: bool) -> Vec<Vertex> {
    let n = items.len();
    let at = |i: isize| -> Option<&Item> {
        if closed {
            Some(&items[i.rem_euclid(n as isize) as usize])
        } else if i >= 0 && (i as usize) < n {
            Some(&items[i as usize])
        } else {
            None
        }
    };
    let mut out: Vec<Vertex> = Vec::new();
    let vertex = |p, notch, edge| Vertex {
        p,
        kind: NodeType::Point,
        notch,
        edge,
    };
    for (i, it) in items.iter().enumerate() {
        match it {
            Item::Point { p, notch } => out.push(vertex(*p, *notch, Seg::Line)),
            Item::Curve(c) => {
                let i = i as isize;
                let from = curve_bound(c, if n > 1 { at(i - 1) } else { None }, false);
                let to = curve_bound(c, if n > 1 { at(i + 1) } else { None }, true);
                let segs = trim(c, from, to);
                for s in &segs {
                    out.push(vertex(s[0], false, Seg::Cubic(s[1], s[2])));
                }
                let end = segs[segs.len() - 1][3];
                let next_start = match at(i + 1) {
                    Some(Item::Point { p, .. }) => Some(*p),
                    Some(Item::Curve(o)) => Some(curve_bound(o, Some(it), false)),
                    None => None,
                };
                if next_start.is_none_or(|q| !geom::same_point(q, end)) {
                    out.push(vertex(end, false, Seg::Line));
                }
            }
        }
    }
    // Merge repeats: the first keeps its place and notch, the second's edge goes on.
    let mut merged: Vec<Vertex> = Vec::new();
    for v in out {
        match merged.last_mut() {
            Some(last) if last.p.distance(v.p) < SAME_MM * PX_PER_MM => {
                last.notch |= v.notch;
                last.edge = v.edge;
            }
            _ => merged.push(v),
        }
    }
    if closed && merged.len() > 1 {
        let last = merged[merged.len() - 1].clone();
        if last.p.distance(merged[0].p) < SAME_MM * PX_PER_MM {
            merged[0].notch |= last.notch;
            merged.pop();
        }
    }
    merged
}

/// Scene pixels (y down) to mm (y up), on the format's grid.
fn mm(p: DVec2) -> DVec2 {
    DVec2::new(round_mm(p.x / PX_PER_MM), round_mm(-p.y / PX_PER_MM))
}

fn to_mm(vs: &mut [Vertex]) {
    for v in vs {
        v.p = mm(v.p);
        if let Seg::Cubic(a, b) = v.edge {
            v.edge = Seg::Cubic(mm(a), mm(b));
        }
    }
}

/// The path as points, edges flattened as the format flattens them.
fn flat(vs: &[Vertex], closed: bool) -> Vec<DVec2> {
    let mut out = Vec::new();
    let n = vs.len();
    for (i, v) in vs.iter().enumerate() {
        out.push(v.p);
        if !closed && i + 1 == n {
            break;
        }
        let next = vs[(i + 1) % n].p;
        if let Seg::Cubic(a, b) = v.edge {
            out.extend(
                vitryne_format::flatten_cubic(v.p.into(), a.into(), b.into(), next.into())
                    .into_iter()
                    .map(DVec2::from),
            );
        }
    }
    out
}

fn area(pts: &[DVec2]) -> f64 {
    (0..pts.len())
        .map(|i| pts[i].perp_dot(pts[(i + 1) % pts.len()]))
        .sum::<f64>()
        / 2.0
}

/// The loop the other way round.
fn reversed(vs: &[Vertex]) -> Vec<Vertex> {
    let n = vs.len();
    (0..n)
        .map(|k| {
            let v = &vs[n - 1 - k];
            // The edge into the old vertex, turned round.
            let into = &vs[(2 * n - 2 - k) % n];
            Vertex {
                edge: match into.edge {
                    Seg::Cubic(a, b) => Seg::Cubic(b, a),
                    Seg::Line => Seg::Line,
                },
                ..v.clone()
            }
        })
        .collect()
}

/// Sets each vertex's kind from how sharply the path turns there.
fn classify(vs: &mut [Vertex], closed: bool) {
    let n = vs.len();
    for i in 0..n {
        let (has_prev, has_next) = (closed || i > 0, closed || i + 1 < n);
        let p = vs[i].p;
        let corner = has_prev && has_next && {
            let prev = &vs[(i + n - 1) % n];
            let next = vs[(i + 1) % n].p;
            let back = match prev.edge {
                Seg::Cubic(_, c2) if c2.distance(p) > 1e-9 => c2,
                Seg::Cubic(c1, _) if c1.distance(p) > 1e-9 => c1,
                _ => prev.p,
            };
            let ahead = match vs[i].edge {
                Seg::Cubic(c1, _) if c1.distance(p) > 1e-9 => c1,
                Seg::Cubic(_, c2) if c2.distance(p) > 1e-9 => c2,
                _ => next,
            };
            let (a, b) = (p - back, ahead - p);
            a.length() > 0.0 && b.length() > 0.0 && a.angle_to(b).abs().to_degrees() > CORNER_DEG
        };
        vs[i].kind = if corner {
            NodeType::Corner
        } else if vs[i].notch {
            NodeType::Notch
        } else {
            NodeType::Point
        };
    }
}

/// Closes slits drawn into a closed outline (a straight edge out to a vertex and straight back,
/// like a sleeve placket's cut): the outline must be a simple polygon. Returns how many.
fn close_slits(vs: &mut Vec<Vertex>) -> usize {
    let mut closed = 0;
    while vs.len() > 3 {
        let n = vs.len();
        let spike = (0..n).find(|&i| {
            let (prev, v, next) = (&vs[(i + n - 1) % n], &vs[i], vs[(i + 1) % n].p);
            let (a, b) = (v.p - prev.p, next - v.p);
            prev.edge == Seg::Line
                && v.edge == Seg::Line
                && a.length() > 1e-9
                && b.length() > 1e-9
                && a.angle_to(b).abs().to_degrees() > 179.0
        });
        let Some(i) = spike else {
            break;
        };
        vs.remove(i);
        closed += 1;
        // The two sides of the slit may now meet in one place.
        let n = vs.len();
        let (j, before) = (i % n, (i + n - 1) % n);
        if vs[before].p.distance(vs[j].p) < 0.5 {
            vs[before].edge = vs[j].edge;
            vs[before].notch |= vs[j].notch;
            vs.remove(j);
        }
    }
    closed
}

/// Points along the edge from `v` to `next` with their parameters (0 to 1).
fn edge_samples(v: &Vertex, next: DVec2) -> Vec<(f64, DVec2)> {
    match v.edge {
        Seg::Line => vec![(0.0, v.p), (1.0, next)],
        Seg::Cubic(a, b) => {
            let c = [v.p, a, b, next];
            let n = 128;
            (0..=n)
                .map(|k| {
                    let t = k as f64 / n as f64;
                    (t, geom::cubic_at(&c, t))
                })
                .collect()
        }
    }
}

/// Where edges `i` and `j` of a closed path cross: (parameter on i, on j, point).
fn edges_cross(vs: &[Vertex], i: usize, j: usize) -> Option<(f64, f64, DVec2)> {
    let n = vs.len();
    let (a, b) = (
        edge_samples(&vs[i], vs[(i + 1) % n].p),
        edge_samples(&vs[j], vs[(j + 1) % n].p),
    );
    for u in a.windows(2) {
        for w in b.windows(2) {
            let (d1, d2) = (u[1].1 - u[0].1, w[1].1 - w[0].1);
            let den = d1.perp_dot(d2);
            if den.abs() < 1e-12 {
                continue;
            }
            let s = (w[0].1 - u[0].1).perp_dot(d2) / den;
            let r = (w[0].1 - u[0].1).perp_dot(d1) / den;
            // Strictly inside both, so edges that only share a node don't count.
            if (1e-9..1.0 - 1e-9).contains(&s) && (1e-9..1.0 - 1e-9).contains(&r) {
                let ti = u[0].0 + s * (u[1].0 - u[0].0);
                let tj = w[0].0 + r * (w[1].0 - w[0].0);
                return Some((ti, tj, u[0].1 + d1 * s));
            }
        }
    }
    None
}

/// Cuts off small loops where the outline crosses itself over a few nodes (a line drawn a
/// little past the end of a curve): each is cut at the crossing. Returns how many.
fn trim_loops(vs: &mut Vec<Vertex>) -> usize {
    let mut trimmed = 0;
    let piece_area = area(&flat(vs, true)).abs();
    'again: while vs.len() > 4 {
        let n = vs.len();
        for i in 0..n {
            for gap in 2..=4.min(n - 2) {
                let j = (i + gap) % n;
                let Some((ti, tj, x)) = edges_cross(vs, i, j) else {
                    continue;
                };
                // The loop: from x along edge i's end, the nodes between, edge j's start.
                let mut lp = vec![x];
                lp.extend((1..=gap).map(|k| vs[(i + k) % n].p));
                if area(&lp).abs() > (0.01 * piece_area).max(1.0) {
                    continue;
                }
                vs.rotate_left(i);
                let next_j = vs[(gap + 1) % n].p;
                let (vi, vj) = (vs[0].clone(), vs[gap].clone());
                vs[0].edge = match vi.edge {
                    Seg::Cubic(a, b) => {
                        let (l, _) = geom::cubic_split(&[vi.p, a, b, vs[1].p], ti);
                        Seg::Cubic(l[1], l[2])
                    }
                    Seg::Line => Seg::Line,
                };
                let cross = Vertex {
                    p: x,
                    kind: NodeType::Point,
                    notch: false,
                    edge: match vj.edge {
                        Seg::Cubic(a, b) => {
                            let (_, r) = geom::cubic_split(&[vj.p, a, b, next_j], tj);
                            Seg::Cubic(r[1], r[2])
                        }
                        Seg::Line => Seg::Line,
                    },
                };
                vs.splice(1..=gap, [cross]);
                trimmed += 1;
                continue 'again;
            }
        }
        break;
    }
    trimmed
}

/// Unfolds a closed counter-clockwise path about its edge from `a` to the next vertex (the
/// mirror line): the path from that next vertex round to `a`, then its mirror image back.
/// Returns the path and the fold's ends.
fn unfold(vs: &[Vertex], a: usize) -> (Vec<Vertex>, usize, usize) {
    let n = vs.len();
    let b = (a + 1) % n;
    let (o, d) = (vs[a].p, vs[b].p);
    let m = |p: DVec2| geom::mirror(o, d, p);
    // An edge k-1 -> k, mirrored and run backwards (from the image of k to that of k-1).
    let back = |e: Seg| match e {
        Seg::Cubic(c1, c2) => Seg::Cubic(m(c2), m(c1)),
        Seg::Line => Seg::Line,
    };
    let half: Vec<Vertex> = (0..n).map(|k| vs[(b + k) % n].clone()).collect();
    let last = n - 1;
    let mut out = half.clone();
    out[last].edge = back(half[last - 1].edge);
    for k in (1..last).rev() {
        out.push(Vertex {
            p: m(half[k].p),
            edge: back(half[k - 1].edge),
            ..half[k].clone()
        });
    }
    (out, last, 0)
}

/// Reads one piece.
pub fn build(draft: &Draft, el: Node, modeling: &[Node]) -> Result<Shape, String> {
    let name = el.attribute("name").unwrap_or("Piece").trim().to_string();
    let mut warnings = Vec::new();
    let nodes = path_nodes(el);
    let its = items(draft, &nodes)?;
    if its.is_empty() {
        return Err("it has no outline".into());
    }
    let mut outline = vertices(&its, true);
    if outline.len() < 3 {
        return Err("its outline has fewer than three points".into());
    }
    // Mirror line ends, as positions (px).
    let mirror = child(el, "mirrorLine").and_then(|m| {
        let id = |a: &str| m.attribute(a).and_then(|v| v.parse::<u32>().ok());
        Some((
            draft.point(id("p1")?).ok()?.p,
            draft.point(id("p2")?).ok()?.p,
        ))
    });
    to_mm(&mut outline);
    if close_slits(&mut outline) > 0 {
        warnings.push(format!(
            "{name}: a slit cut into its outline is closed (sew or cut it after draping)"
        ));
    }
    if area(&flat(&outline, true)) < 0.0 {
        outline = reversed(&outline);
    }
    if trim_loops(&mut outline) > 0 {
        warnings.push(format!(
            "{name}: a small overlap where its outline crossed itself is trimmed"
        ));
    }
    let mut fold = None;
    if let Some((m1, m2)) = mirror {
        let (m1, m2) = (mm(m1), mm(m2));
        let find = |q: DVec2| outline.iter().position(|v| v.p.distance(q) < 0.01);
        match (find(m1), find(m2)) {
            (Some(i), Some(j)) if (i + 1) % outline.len() == j || (j + 1) % outline.len() == i => {
                let a = if (i + 1) % outline.len() == j { i } else { j };
                let (o, f1, f2) = unfold(&outline, a);
                outline = o;
                fold = Some((f1, f2));
            }
            _ => warnings.push(format!(
                "{name}: its mirror line isn't an edge of the outline; imported as drawn (half)"
            )),
        }
    }
    classify(&mut outline, true);
    if let Some((a, b)) = fold {
        for k in [a, b] {
            if outline[k].kind != NodeType::Corner {
                outline[k].kind = NodeType::Point;
            }
        }
    }
    // Internal paths, by id, from the block's <modeling>.
    let mut lines = Vec::new();
    if let Some(ip) = child(el, "iPaths") {
        for rec in ip.children().filter(|c| c.has_tag_name("record")) {
            let Some(pid) = rec.attribute("path") else {
                continue;
            };
            let Some(path) = modeling
                .iter()
                .find(|p| p.has_tag_name("path") && p.attribute("id") == Some(pid))
            else {
                warnings.push(format!("{name}: internal path {pid} not found"));
                continue;
            };
            match items(draft, &path_nodes(*path)).map(|its| vertices(&its, false)) {
                Ok(mut vs) if vs.len() >= 2 => {
                    to_mm(&mut vs);
                    classify(&mut vs, false);
                    lines.push((path.attribute("name").map(str::to_string), vs));
                }
                Ok(_) => {}
                Err(e) => warnings.push(format!(
                    "{name}: internal path {} left out ({e})",
                    path.attribute("name").unwrap_or(pid)
                )),
            }
        }
    }
    let grain = grain(draft, el, &outline);
    let quantity = child(el, "data")
        .map(|d| attr_f64(d, "quantity", 1.0))
        .transpose()?
        .map_or(1, |q| q.max(1.0) as u32);
    if el.attribute("seamAllowanceBuiltIn") == Some("true") {
        warnings.push(format!(
            "{name}: its outline includes the seam allowance, so it drapes larger than sewn"
        ));
    }
    // Put the piece's corner of its box at the origin.
    let lo = flat(&outline, true)
        .iter()
        .fold(DVec2::splat(f64::MAX), |a, p| a.min(*p));
    let shift = |p: DVec2| DVec2::new(round_mm(p.x - lo.x), round_mm(p.y - lo.y));
    let move_all = |vs: &mut Vec<Vertex>| {
        for v in vs.iter_mut() {
            v.p = shift(v.p);
            if let Seg::Cubic(a, b) = v.edge {
                v.edge = Seg::Cubic(shift(a), shift(b));
            }
        }
    };
    move_all(&mut outline);
    for (_, l) in &mut lines {
        move_all(l);
    }
    let shape = Shape {
        name,
        quantity,
        outline,
        lines,
        fold,
        grain: grain.map(|(a, b)| (shift(a), shift(b))),
        warnings,
    };
    // The format's own test: a simple counter-clockwise polygon, as meshed.
    let mut ids = IdGen::new(0, b"check");
    let source = ids.next_id();
    vitryne_format::check_outline_shape(&shape.to_piece(&source, &mut ids).outline)?;
    Ok(shape)
}

/// The grainline (mm, y up): from its bottom pin to its top pin, or at its angle through its
/// centre pin or the piece's middle.
fn grain(draft: &Draft, el: Node, outline: &[Vertex]) -> Option<(DVec2, DVec2)> {
    let g = child(el, "grainline")?;
    let on = match g.attribute("enabled") {
        Some(v) => v == "true",
        None => g.attribute("visible") == Some("true"),
    };
    if !on {
        return None;
    }
    let pin = |a: &str| {
        g.attribute(a)
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|v| *v != 0)
            .and_then(|id| draft.point(id).ok())
            .map(|p| mm(p.p))
    };
    if let (Some(bottom), Some(top)) = (pin("bottomPin"), pin("topPin"))
        && bottom.distance(top) > 1.0
    {
        return Some((bottom, top));
    }
    let deg = formula::eval(g.attribute("rotation").unwrap_or("90"), &|n: &str| {
        draft.value(n)
    })
    .ok()?;
    let centre = pin("centerPin").unwrap_or_else(|| {
        let pts = flat(outline, true);
        let (lo, hi) = pts.iter().fold(
            (DVec2::splat(f64::MAX), DVec2::splat(f64::MIN)),
            |(lo, hi), p| (lo.min(*p), hi.max(*p)),
        );
        (lo + hi) / 2.0
    });
    let d = DVec2::new(deg.to_radians().cos(), deg.to_radians().sin()) * 50.0;
    Some((centre - d, centre + d))
}

impl Shape {
    /// The outline flattened, for a thumbnail, whole mm.
    pub fn thumbnail(&self) -> Vec<[f64; 2]> {
        flat(&self.outline, true)
            .iter()
            .map(|p| [p.x.round() + 0.0, p.y.round() + 0.0])
            .collect()
    }

    fn nodes(vs: &[Vertex], open: bool, ids: &mut IdGen) -> Vec<FNode> {
        let n = vs.len();
        vs.iter()
            .enumerate()
            .map(|(i, v)| FNode {
                id: ids.next_id(),
                kind: v.kind,
                name: None,
                position: v.p.into(),
                edge: (!open || i + 1 < n).then(|| match v.edge {
                    Seg::Cubic(a, b) => Edge::cubic(a.into(), b.into()),
                    Seg::Line => Edge::polyline(Vec::new()),
                }),
                other: Map::new(),
            })
            .collect()
    }

    /// The piece with fresh ids, no cuts yet.
    pub fn to_piece(&self, source: &Id, ids: &mut IdGen) -> Piece {
        let outline = Self::nodes(&self.outline, false, ids);
        let folds = self
            .fold
            .map(|(a, b)| Fold {
                id: ids.next_id(),
                from: outline[a].id.clone(),
                to: outline[b].id.clone(),
                other: Map::new(),
            })
            .into_iter()
            .collect();
        let lines = self
            .lines
            .iter()
            .map(|(name, vs)| Line {
                id: ids.next_id(),
                name: name.clone(),
                nodes: Self::nodes(vs, true, ids),
                other: Map::new(),
            })
            .collect();
        Piece {
            id: ids.next_id(),
            name: self.name.clone(),
            source: Some(vitryne_format::PieceSource {
                source: source.clone(),
                piece: self.name.clone(),
                other: Map::new(),
            }),
            outline,
            lines,
            folds,
            grain: self.grain.map(|(a, b)| Grain {
                from: a.into(),
                to: b.into(),
                other: Map::new(),
            }),
            cuts: Vec::new(),
            other: Map::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::valentina::xml::Pattern;
    use roxmltree::Document;
    use std::collections::HashMap;

    fn shapes(text: &str) -> Vec<Result<Shape, String>> {
        let doc = Document::parse(text).unwrap();
        let p = Pattern::read(&doc).unwrap();
        let d = Draft::run(&p, HashMap::new());
        let modeling: Vec<Node> = p
            .sections("modeling")
            .iter()
            .flat_map(|m| m.children())
            .collect();
        p.pieces()
            .into_iter()
            .map(|(_, el)| build(&d, el, &modeling))
            .collect()
    }

    /// A 10 cm square with its top edge a curve dipping 2 cm, drawn clockwise on screen.
    const SQUARE: &str = r##"<pattern><version>0.9.2</version><unit>cm</unit>
    <draw name="A"><calculation>
        <point type="single" id="1" name="A" x="0" y="0"/>
        <point type="endLine" id="2" name="B" basePoint="1" angle="0" length="10"/>
        <point type="endLine" id="3" name="C" basePoint="2" angle="270" length="10"/>
        <point type="endLine" id="4" name="D" basePoint="1" angle="270" length="10"/>
        <point type="alongLine" id="5" name="E" firstPoint="4" secondPoint="3" length="5"/>
        <spline type="simpleInteractive" id="6" point1="1" point4="2" angle1="300" angle2="240" length1="3" length2="3"/>
    </calculation><modeling>
        <path id="20" type="2" name="middle"><nodes>
            <node type="NodePoint" idObject="1"/><node type="NodePoint" idObject="5"/>
        </nodes></path>
    </modeling><details>
        <detail id="10" name="Front" version="2" seamAllowanceBuiltIn="true">
            <data quantity="2"/>
            <grainline enabled="true" rotation="90"/>
            <nodes>
                <node type="NodeSpline" idObject="6"/>
                <node type="NodePoint" idObject="3"/>
                <node type="NodePoint" idObject="5" passmark="true"/>
                <node type="NodePoint" idObject="4"/>
            </nodes>
            <iPaths><record path="20"/></iPaths>
        </detail>
        <detail id="11" name="Folded" version="2">
            <nodes>
                <node type="NodePoint" idObject="1"/><node type="NodePoint" idObject="2"/>
                <node type="NodePoint" idObject="3"/><node type="NodePoint" idObject="4"/>
            </nodes>
            <mirrorLine p1="1" p2="4"/>
        </detail>
        <detail id="12" name="Broken" version="2">
            <nodes><node type="NodePoint" idObject="99"/></nodes>
        </detail>
    </details></draw></pattern>"##;

    #[test]
    fn outline_corners_notches_and_curves() {
        let all = shapes(SQUARE);
        let s = all[0].as_ref().unwrap();
        assert_eq!(s.name, "Front");
        assert_eq!(s.quantity, 2);
        assert_eq!(s.outline.len(), 5);
        let kinds: Vec<NodeType> = s.outline.iter().map(|v| v.kind).collect();
        assert_eq!(kinds.iter().filter(|k| **k == NodeType::Corner).count(), 4);
        assert_eq!(kinds.iter().filter(|k| **k == NodeType::Notch).count(), 1);
        assert_eq!(
            s.outline
                .iter()
                .filter(|v| matches!(v.edge, Seg::Cubic(..)))
                .count(),
            1
        );
        // Counter-clockwise, 100 mm across, starting at its box's corner.
        assert!(area(&flat(&s.outline, true)) > 0.0);
        let xs: Vec<f64> = s.outline.iter().map(|v| v.p.x).collect();
        assert!(xs.iter().any(|x| (*x - 100.0).abs() < 1e-6));
        assert!(xs.iter().any(|x| x.abs() < 1e-6));
        assert_eq!(s.lines.len(), 1);
        assert_eq!(s.lines[0].0.as_deref(), Some("middle"));
        let (a, b) = s.grain.unwrap();
        assert!((b - a).normalize().dot(DVec2::Y) > 0.999);
        assert!(s.warnings.iter().any(|w| w.contains("seam allowance")));
    }

    #[test]
    fn mirror_line_unfolds() {
        let all = shapes(SQUARE);
        let s = all[1].as_ref().unwrap();
        // The square unfolded about its left side: 200 mm wide, six vertices.
        assert_eq!(s.outline.len(), 6);
        let w = s.outline.iter().map(|v| v.p.x).fold(0.0, f64::max);
        assert!((w - 200.0).abs() < 1e-6, "{w}");
        let (a, b) = s.fold.unwrap();
        assert!((s.outline[a].p.x - 100.0).abs() < 1e-6);
        assert!((s.outline[b].p.x - 100.0).abs() < 1e-6);
        assert!(area(&flat(&s.outline, true)) > 0.0);
    }

    #[test]
    fn slits_close() {
        let v = |x: f64, y: f64| Vertex {
            p: DVec2::new(x, y),
            kind: NodeType::Point,
            notch: false,
            edge: Seg::Line,
        };
        // A square with a slit up from the middle of its bottom edge.
        let mut vs = vec![
            v(0.0, 0.0),
            v(50.0, 0.0),
            v(50.0, 60.0),
            v(50.1, 0.0),
            v(100.0, 0.0),
            v(100.0, 100.0),
            v(0.0, 100.0),
        ];
        assert_eq!(close_slits(&mut vs), 1);
        assert_eq!(vs.len(), 5);
        assert!(vs.iter().all(|x| x.p.y != 60.0));
    }

    #[test]
    fn small_loops_are_trimmed() {
        let v = |x: f64, y: f64| Vertex {
            p: DVec2::new(x, y),
            kind: NodeType::Point,
            notch: false,
            edge: Seg::Line,
        };
        // A square whose right side overshoots the top by 2 mm and comes back in.
        let mut vs = vec![
            v(0.0, 0.0),
            v(100.0, 0.0),
            v(100.0, 102.0),
            v(98.0, 100.0),
            v(0.0, 100.0),
        ];
        assert!(edges_cross(&vs, 1, 3).is_none());
        let mut crossing = vec![
            v(0.0, 0.0),
            v(100.0, 0.0),
            v(100.0, 102.0),
            v(102.0, 100.0),
            v(0.0, 100.0),
        ];
        assert_eq!(trim_loops(&mut crossing), 1);
        assert_eq!(crossing.len(), 4);
        assert!(
            crossing
                .iter()
                .any(|x| x.p.distance(DVec2::new(100.0, 100.0)) < 1e-9)
        );
        assert_eq!(trim_loops(&mut vs), 0);
    }

    #[test]
    fn broken_pieces_say_why() {
        let all = shapes(SQUARE);
        assert!(all[2].as_ref().unwrap_err().contains("99"));
    }

    #[test]
    fn to_piece_gives_ids_and_edges() {
        let all = shapes(SQUARE);
        let mut ids = IdGen::new(0, b"t");
        let src = ids.next_id();
        let p = all[0].as_ref().unwrap().to_piece(&src, &mut ids);
        assert_eq!(p.outline.len(), 5);
        assert!(p.outline.iter().all(|n| n.edge.is_some()));
        assert!(
            p.outline
                .iter()
                .any(|n| n.edge.as_ref().unwrap().is_cubic())
        );
        assert_eq!(p.lines[0].nodes.last().unwrap().edge, None);
        let folded = all[1].as_ref().unwrap().to_piece(&src, &mut ids);
        assert_eq!(folded.folds.len(), 1);
    }
}
