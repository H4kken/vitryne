// SPDX-License-Identifier: AGPL-3.0-or-later
//! DXF-AAMA (ASTM D6673) export of a garment's pieces (M13), so a pattern made or fixed in
//! Vitryne goes back to cutting and CAD tools. The file has the shape `aama::read` reads and
//! `tools/patterns/export-aama.mjs` writes: R12 entities only, one BLOCK per piece, INSERTed
//! side by side in ENTITIES, units mm (`$INSUNITS` 4), on the standard's layers:
//!   1  boundary (closed POLYLINE) and the "Piece Name:", "Quantity:", "Material:" text
//!   2  turn points (POINT): the outline's `corner` nodes
//!   4  notches (LINE, a 4 mm slit into the piece from the notch)
//!   6  mirror line, for a piece written folded
//!   7  grain line
//!   8  internal lines (open POLYLINE)
//!
//! The boundary is the sewing line: there is no seam allowance until the format has
//! `VTRY_seam_allowance` (FORMAT.md, Extensions), and the report says so.
//!
//! **Cut on the fold.** A piece with one fold is written as its half from the fold's start,
//! with the mirror line, when the other half is the mirror image within 0.01 mm (vertices, node
//! types and internal lines); importing it unfolds it into the same piece. Otherwise it is
//! written unfolded, and the report says why.
//!
//! **Round trip.** Each outline is written from its first node, counter-clockwise, so the
//! importer numbers the landmarks as the file did and a `garment.toml` written for the original
//! DXF still applies (test `tests/aama_round_trip.rs`). `point` nodes that are neither a fold
//! end nor where an internal line meets the outline have no layer in DXF-AAMA: they are written
//! as plain outline vertices, and the report names them. Seams, placement and fabric physics
//! have no place in DXF-AAMA either; the project file keeps them.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use glam::DVec2;
use serde::Serialize;
use vitryne_format::{Document, Garment, Id, Kind, Node, NodeType, Piece};

/// How far the two halves of a fold may differ for the piece to be written folded, mm.
pub const FOLD_TOL_MM: f64 = 0.01;
/// The importer's on-the-line distance (`aama::ON_TOL`), mm: a vertex of the kept half this
/// close to the mirror line would be read as part of the fold.
const ON_LINE_MM: f64 = 0.5;
/// Notch slit length, mm (as the sample DXFs have them).
const SLIT_MM: f64 = 4.0;
/// Gap between pieces laid out side by side, mm.
const GAP_MM: f64 = 50.0;
const TEXT_HEIGHT_MM: f64 = 5.0;

/// A garment's pieces as a DXF-AAMA file, and what the export did.
#[derive(Debug, Clone)]
pub struct DxfExport {
    pub text: String,
    pub report: ExportReport,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ExportReport {
    pub pieces: Vec<PieceReport>,
    /// For the person exporting: what the DXF doesn't hold, and why a piece came out as it did.
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PieceReport {
    pub name: String,
    /// The DXF block's name (unique, sanitised).
    pub block: String,
    /// "Quantity:", the piece's number of cuts.
    pub quantity: usize,
    /// Written as a half with a mirror line.
    pub folded: bool,
}

/// The project's first garment (the MVP has one) or a garment file's garment.
pub fn export_document(doc: &Document) -> Result<DxfExport, String> {
    let garment = match (doc.kind, &doc.project) {
        (Kind::Project, Some(p)) => {
            let id = p.garments.first().ok_or("the project has no garment")?;
            doc.garment(id).ok_or("garment missing")?
        }
        (Kind::Garment, _) => doc.garments.first().ok_or("the file has no garment")?,
        (kind, _) => return Err(format!("a {kind:?} file has no garment to export")),
    };
    let mut out = export_garment(garment, |id| doc.fabric(id).map(|f| f.name.clone()))?;
    if let Some(p) = &doc.project
        && p.garments.len() > 1
    {
        out.report.notes.push(format!(
            "The project has {} garments; only the first ({}) is exported.",
            p.garments.len(),
            garment.name
        ));
    }
    Ok(out)
}

/// One garment's pieces. `fabric_name` names a fabric id (for the "Material:" text).
pub fn export_garment(
    g: &Garment,
    fabric_name: impl Fn(&Id) -> Option<String>,
) -> Result<DxfExport, String> {
    if g.pieces.is_empty() {
        return Err("the garment has no pieces to export yet".into());
    }
    let mut report = ExportReport::default();
    report.notes.push(
        "No seam allowance: each outline is the sewing line. Add the allowance in your CAD tool \
         before cutting."
            .into(),
    );
    report.notes.push(
        "Seams, placement on the body and fabric physics are not in the DXF; the project file \
         keeps them."
            .into(),
    );
    let mut blocks = String::new();
    let mut inserts = Vec::new();
    let mut names = BTreeSet::new();
    let mut x = 0.0;
    for piece in &g.pieces {
        if piece.cuts.is_empty() {
            report
                .notes
                .push(format!("{}: not cut, not exported.", piece.name));
            continue;
        }
        let block = block_name(&piece.name, &mut names);
        let shape = shape(piece, &mut report.notes)?;
        let (lo, hi) = bounds(&shape.boundary);
        let material = material(g, piece, &fabric_name, &mut report.notes);
        write_block(&mut blocks, &block, piece, &shape, material.as_deref());
        inserts.push((block.clone(), DVec2::new(x - lo.x, -lo.y)));
        x += hi.x - lo.x + GAP_MM;
        let quantity = piece.cuts.len();
        if quantity > 1 && piece.cuts.iter().all(|c| !c.mirrored) {
            report.notes.push(format!(
                "{}: {quantity} cuts, none mirrored; cutting rooms usually read \"Quantity: \
                 {quantity}\" as mirrored pairs.",
                piece.name
            ));
        }
        report.pieces.push(PieceReport {
            name: piece.name.clone(),
            block,
            quantity,
            folded: shape.mirror.is_some(),
        });
    }
    if report.pieces.is_empty() {
        return Err(format!("{}: no cut pieces to export", g.name));
    }

    let mut w = Dxf::default();
    w.pair(0, "SECTION");
    w.pair(2, "HEADER");
    w.pair(9, "$ACADVER");
    w.pair(1, "AC1009");
    w.pair(9, "$INSUNITS");
    w.pair(70, 4);
    w.pair(9, "$MEASUREMENT");
    w.pair(70, 1);
    w.pair(0, "ENDSEC");
    w.pair(0, "SECTION");
    w.pair(2, "BLOCKS");
    w.0.push_str(&blocks);
    w.pair(0, "ENDSEC");
    w.pair(0, "SECTION");
    w.pair(2, "ENTITIES");
    for (name, at) in &inserts {
        w.pair(0, "INSERT");
        w.pair(8, "1");
        w.pair(2, name);
        w.xy(10, *at);
    }
    w.pair(0, "ENDSEC");
    w.pair(0, "EOF");
    Ok(DxfExport { text: w.0, report })
}

/// What one block draws, in mm, in the piece's frame.
struct Shape {
    /// Counter-clockwise, no repeated end point.
    boundary: Vec<DVec2>,
    turns: Vec<DVec2>,
    /// Boundary vertex index of each notch.
    notches: Vec<usize>,
    mirror: Option<(DVec2, DVec2)>,
    lines: Vec<Vec<DVec2>>,
}

fn v(p: [f64; 2]) -> DVec2 {
    DVec2::new(p[0], p[1])
}

/// Every vertex of a node path (outline or line), curves flattened (`Edge::interior`; DXF-AAMA
/// has polylines only), and where each node is in it.
fn path(nodes: &[Node], what: &str) -> Result<(Vec<DVec2>, Vec<usize>), String> {
    let mut pts = Vec::new();
    let mut at = Vec::new();
    for (k, n) in nodes.iter().enumerate() {
        at.push(pts.len());
        pts.push(v(n.position));
        if let Some(e) = &n.edge {
            let next = nodes[(k + 1) % nodes.len()].position;
            let inner = e
                .interior(n.position, next)
                .map_err(|m| format!("{what}: {m}"))?;
            pts.extend(inner.into_iter().map(v));
        }
    }
    Ok((pts, at))
}

fn line_points(piece: &Piece) -> Result<Vec<Vec<DVec2>>, String> {
    piece
        .lines
        .iter()
        .map(|l| Ok(path(&l.nodes, &piece.name)?.0))
        .collect()
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

fn same(a: &[DVec2], b: &[DVec2]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(p, q)| p.distance(*q) <= FOLD_TOL_MM)
}

fn shape(piece: &Piece, notes: &mut Vec<String>) -> Result<Shape, String> {
    let name = &piece.name;
    let (ring, at) = path(&piece.outline, name)?;
    let lines = line_points(piece)?;
    let n = ring.len();
    if n < 3 {
        return Err(format!("{name}: an outline needs at least 3 points"));
    }
    let kind_at = |i: usize| {
        at.iter()
            .position(|&a| a == i % n)
            .map(|k| piece.outline[k].kind)
    };
    let node_index = |id: &Id| piece.outline.iter().position(|nd| &nd.id == id);

    // `point` nodes the importer makes again: internal line ends, and fold ends if folded.
    let line_ends: Vec<DVec2> = lines
        .iter()
        .flat_map(|l| [l[0], *l.last().unwrap()])
        .collect();
    let lost_points = |fold_ends: &[usize]| -> Vec<String> {
        piece
            .outline
            .iter()
            .enumerate()
            .filter(|(k, nd)| {
                nd.kind == NodeType::Point
                    && !fold_ends.contains(k)
                    && !line_ends.iter().any(|e| e.distance(v(nd.position)) < 1e-6)
            })
            .map(|(k, nd)| nd.name.clone().unwrap_or_else(|| format!("node {k}")))
            .collect()
    };

    let folded = match piece.folds.as_slice() {
        [] => None,
        [f] => match (node_index(&f.from), node_index(&f.to)) {
            (Some(a), Some(b)) => {
                // Start from the fold end that is the first node, if one is: an imported
                // cut-on-fold piece's outline starts there.
                let (s, e) = if b == 0 { (b, a) } else { (a, b) };
                match fold_half(&ring, &at, s, e, &kind_at, &lines) {
                    Ok(half) => Some((half, [s, e])),
                    Err(why) => {
                        notes.push(format!(
                            "{name}: written unfolded (its fold is not kept): {why}."
                        ));
                        None
                    }
                }
            }
            _ => return Err(format!("{name}: a fold's node is not on the outline")),
        },
        _ => {
            notes.push(format!(
                "{name}: written unfolded: it has {} folds, DXF-AAMA one mirror line.",
                piece.folds.len()
            ));
            None
        }
    };

    let (shape, fold_ends) = match folded {
        Some((half, ends)) => (half, ends.to_vec()),
        None => {
            // From the first node; if the closing segment is shorter than the importer's
            // closing tolerance it would drop the last vertex, so start a little earlier (still
            // after the last node, so the landmark numbering is unchanged).
            let last_node = *at.last().unwrap();
            let mut start = 0;
            while ring[start].distance(ring[(start + n - 1) % n]) < ON_LINE_MM {
                let prev = (start + n - 1) % n;
                if prev == last_node {
                    start = 0;
                    break;
                }
                start = prev;
            }
            let boundary: Vec<DVec2> = (0..n).map(|i| ring[(start + i) % n]).collect();
            let turns = (0..n)
                .filter(|&i| kind_at(i) == Some(NodeType::Corner))
                .map(|i| ring[i])
                .collect();
            let notches = (0..n)
                .filter(|&i| kind_at((start + i) % n) == Some(NodeType::Notch))
                .collect();
            (
                Shape {
                    boundary,
                    turns,
                    notches,
                    mirror: None,
                    lines,
                },
                Vec::new(),
            )
        }
    };
    let lost = lost_points(&fold_ends);
    if !lost.is_empty() {
        notes.push(format!(
            "{name}: {} written as plain outline points (DXF-AAMA has no layer for a point \
             that is not a corner or a notch).",
            lost.join(", ")
        ));
    }
    if shape.turns.is_empty() {
        notes.push(format!(
            "{name}: no corners; a reader may find its own where the outline turns sharply."
        ));
    }
    Ok(shape)
}

/// The half of an unfolded piece from outline node `s` round to node `e` (the fold ends),
/// with its mirror line, if the other half is its mirror image as `aama::read` would make it.
fn fold_half(
    ring: &[DVec2],
    at: &[usize],
    s: usize,
    e: usize,
    kind_at: &dyn Fn(usize) -> Option<NodeType>,
    lines: &[Vec<DVec2>],
) -> Result<Shape, String> {
    let n = ring.len();
    let (vs, ve) = (at[s], at[e]);
    let (a, b) = (ring[vs], ring[ve]);
    if a.distance(b) < 1.0 {
        return Err("the fold is shorter than 1 mm".into());
    }
    let m = Mirror {
        o: a,
        d: (b - a).normalize(),
    };
    let len = (ve + n - vs) % n + 1;
    if 2 * (len - 1) != n {
        return Err("the halves have different numbers of points".into());
    }
    let kept: Vec<DVec2> = (0..len).map(|k| ring[(vs + k) % n]).collect();
    let other: Vec<DVec2> = (0..len).map(|k| ring[(ve + k) % n]).collect();
    let image: Vec<DVec2> = kept.iter().rev().map(|&p| m.apply(p)).collect();
    if !same(&other, &image) {
        let worst = other
            .iter()
            .zip(&image)
            .map(|(p, q)| p.distance(*q))
            .fold(0.0, f64::max);
        return Err(format!(
            "its halves differ by up to {worst:.3} mm (more than {FOLD_TOL_MM} mm)"
        ));
    }
    for k in 1..len - 1 {
        if kind_at(vs + k) != kind_at(ve + len - 1 - k) {
            return Err("its halves have different corners or notches".into());
        }
    }
    let side = m.dist(kept[1]).signum();
    if kept[1..len - 1]
        .iter()
        .any(|&p| m.dist(p).abs() < ON_LINE_MM || m.dist(p).signum() != side)
    {
        return Err("its outline comes within 0.5 mm of the fold line".into());
    }

    // Internal lines, in the order the importer makes them again: a line across the fold is
    // its half up to the fold then the mirror image; any other line comes as (image, line).
    let on_kept = |l: &[DVec2]| {
        l.iter()
            .all(|&p| m.dist(p).abs() >= ON_LINE_MM && m.dist(p).signum() == side)
    };
    let mut half_lines = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let l = &lines[i];
        let c = l.len() / 2;
        if l.len() % 2 == 1 && m.dist(l[c]).abs() < ON_LINE_MM && on_kept(&l[..c]) {
            let mirrored: Vec<DVec2> = l[..c].iter().rev().map(|&p| m.apply(p)).collect();
            if same(&l[c + 1..], &mirrored) {
                half_lines.push(l[..=c].to_vec());
                i += 1;
                continue;
            }
        }
        if let Some(next) = lines.get(i + 1)
            && on_kept(next)
        {
            let mirrored: Vec<DVec2> = next.iter().map(|&p| m.apply(p)).collect();
            if same(l, &mirrored) {
                half_lines.push(next.clone());
                i += 2;
                continue;
            }
        }
        return Err("its internal lines are not symmetric about the fold".into());
    }

    let turns = (0..len)
        .filter(|&k| k == 0 || k == len - 1 || kind_at(vs + k) == Some(NodeType::Corner))
        .map(|k| kept[k])
        .collect();
    let notches = (1..len - 1)
        .filter(|&k| kind_at(vs + k) == Some(NodeType::Notch))
        .collect();
    Ok(Shape {
        boundary: kept,
        turns,
        notches,
        mirror: Some((a, b)),
        lines: half_lines,
    })
}

/// The fabric name for "Material:", if every cut of the piece is in the same fabric.
fn material(
    g: &Garment,
    piece: &Piece,
    fabric_name: &impl Fn(&Id) -> Option<String>,
    notes: &mut Vec<String>,
) -> Option<String> {
    let fabrics: BTreeSet<&Id> = piece
        .cuts
        .iter()
        .map(|c| c.fabric.as_ref().unwrap_or(&g.fabric))
        .collect();
    if fabrics.len() > 1 {
        notes.push(format!(
            "{}: its cuts are in {} fabrics; no \"Material:\" is written.",
            piece.name,
            fabrics.len()
        ));
        return None;
    }
    fabrics.first().and_then(|id| fabric_name(id))
}

fn bounds(p: &[DVec2]) -> (DVec2, DVec2) {
    p.iter().fold(
        (DVec2::splat(f64::MAX), DVec2::splat(f64::MIN)),
        |(lo, hi), q| (lo.min(*q), hi.max(*q)),
    )
}

/// DXF block names allow letters, digits, `-`, `_` and `$`; unique within the file.
fn block_name(name: &str, taken: &mut BTreeSet<String>) -> String {
    let base: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '$' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let base = if base.is_empty() {
        "piece".into()
    } else {
        base
    };
    let mut b = base.clone();
    let mut k = 2;
    while !taken.insert(b.to_ascii_uppercase()) {
        b = format!("{base}_{k}");
        k += 1;
    }
    b
}

/// A text value on one line (a DXF value can't hold a line break).
fn one_line(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

#[derive(Default)]
struct Dxf(String);

impl Dxf {
    fn pair(&mut self, code: i32, value: impl std::fmt::Display) {
        let _ = write!(self.0, "{code}\n{value}\n");
    }
    /// A coordinate, mm on the format's 0.001 mm grid.
    fn num(&mut self, code: i32, x: f64) {
        self.pair(code, format!("{:.3}", (x * 1000.0).round() / 1000.0 + 0.0));
    }
    fn xy(&mut self, code: i32, p: DVec2) {
        self.num(code, p.x);
        self.num(code + 10, p.y);
        self.num(code + 20, 0.0);
    }
    fn polyline(&mut self, layer: &str, pts: &[DVec2], closed: bool) {
        self.pair(0, "POLYLINE");
        self.pair(8, layer);
        self.pair(66, 1);
        self.xy(10, DVec2::ZERO);
        self.pair(70, u8::from(closed));
        for &p in pts {
            self.pair(0, "VERTEX");
            self.pair(8, layer);
            self.xy(10, p);
        }
        self.pair(0, "SEQEND");
        self.pair(8, layer);
    }
    fn line(&mut self, layer: &str, a: DVec2, b: DVec2) {
        self.pair(0, "LINE");
        self.pair(8, layer);
        self.xy(10, a);
        self.xy(11, b);
    }
    fn point(&mut self, layer: &str, p: DVec2) {
        self.pair(0, "POINT");
        self.pair(8, layer);
        self.xy(10, p);
    }
    fn text(&mut self, layer: &str, p: DVec2, s: &str) {
        self.pair(0, "TEXT");
        self.pair(8, layer);
        self.xy(10, p);
        self.num(40, TEXT_HEIGHT_MM);
        self.pair(1, s);
    }
}

fn write_block(out: &mut String, block: &str, piece: &Piece, s: &Shape, material: Option<&str>) {
    let mut w = Dxf::default();
    w.pair(0, "BLOCK");
    w.pair(8, "1");
    w.pair(2, block);
    w.pair(70, 0);
    w.xy(10, DVec2::ZERO);
    w.pair(3, block);
    w.polyline("1", &s.boundary, true);
    for &p in &s.turns {
        w.point("2", p);
    }
    let n = s.boundary.len();
    for &i in &s.notches {
        // Into the piece: the outline is counter-clockwise, so inside is on the left.
        let (prev, here, next) = (
            s.boundary[(i + n - 1) % n],
            s.boundary[i],
            s.boundary[(i + 1) % n],
        );
        let t = (here - prev).normalize_or_zero() + (next - here).normalize_or_zero();
        let inward = t.perp().normalize_or(DVec2::Y);
        w.line("4", here, here + SLIT_MM * inward);
    }
    if let Some((a, b)) = s.mirror {
        w.line("6", a, b);
    }
    match &piece.grain {
        Some(g) => w.line("7", v(g.from), v(g.to)),
        None => {
            // Absent means +y (FORMAT.md); cutting tools want one drawn.
            let (lo, hi) = bounds(&s.boundary);
            let c = (lo + hi) * 0.5;
            let h = (hi.y - lo.y) * 0.3;
            w.line("7", c - DVec2::Y * h, c + DVec2::Y * h);
        }
    }
    for l in &s.lines {
        w.polyline("8", l, false);
    }
    let (lo, hi) = bounds(&s.boundary);
    let at = DVec2::new(lo.x + 0.1 * (hi.x - lo.x), hi.y - 0.15 * (hi.y - lo.y));
    let mut texts = vec![
        format!("Piece Name: {}", one_line(&piece.name)),
        format!("Quantity: {}", piece.cuts.len()),
    ];
    if let Some(m) = material {
        texts.push(format!("Material: {}", one_line(m)));
    }
    texts.push("Annotation: sewing line, no seam allowance (Vitryne)".into());
    for (k, t) in texts.iter().enumerate() {
        w.text("1", at - DVec2::Y * (k as f64 * 2.0 * TEXT_HEIGHT_MM), t);
    }
    w.pair(0, "ENDBLK");
    w.pair(8, "1");
    out.push_str(&w.0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aama::{self, LandmarkKind};

    fn root() -> &'static str {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../..")
    }

    fn example(name: &str) -> Document {
        Document::open(std::path::Path::new(&format!(
            "{}/examples/{name}.vtry",
            root()
        )))
        .unwrap()
        .doc
    }

    #[test]
    fn tshirt_front_and_back_fold_and_the_sleeve_is_a_pair() {
        let out = export_document(&example("tshirt")).unwrap();
        let by = |n: &str| out.report.pieces.iter().find(|p| p.name == n).unwrap();
        assert!(by("front").folded && by("back").folded);
        assert_eq!(by("sleeve").quantity, 2);
        assert!(out.text.contains("$INSUNITS\n70\n4\n"));
        assert!(out.text.contains("Quantity: 2"));
        assert!(
            out.report
                .notes
                .iter()
                .any(|n| n.contains("cap top (shoulder point)")),
            "{:?}",
            out.report.notes
        );
    }

    /// Without a sidecar: the importer finds every corner, notch, fold end and line end the
    /// file has, at the same places.
    #[test]
    fn reimport_finds_the_same_landmarks() {
        for name in ["tshirt", "trousers", "hoodie"] {
            let doc = example(name);
            let g = &doc.garments[0];
            let out = export_document(&doc).unwrap();
            let (pieces, rep) = aama::read(&out.text).unwrap();
            assert!(rep.warnings.is_empty(), "{name}: {:?}", rep.warnings);
            assert_eq!(pieces.len(), g.pieces.len(), "{name}");
            for (p, q) in g.pieces.iter().zip(&pieces) {
                assert_eq!(p.name, q.name);
                assert_eq!(p.cuts.len() as u32, q.quantity);
                assert_eq!(!p.folds.is_empty(), q.unfolded, "{name} {}", p.name);
                let want: Vec<(NodeType, DVec2)> = p
                    .outline
                    .iter()
                    .map(|nd| (nd.kind, v(nd.position)))
                    .collect();
                for l in &q.landmarks {
                    let kind = match l.kind {
                        LandmarkKind::Turn => NodeType::Corner,
                        LandmarkKind::Notch => NodeType::Notch,
                        _ => NodeType::Point,
                    };
                    let at = q.boundary[l.at].as_dvec2() * 1000.0;
                    assert!(
                        want.iter()
                            .any(|(k, w)| *k == kind && w.distance(at) <= FOLD_TOL_MM),
                        "{name} {}: landmark {kind:?} at {at:?} not in the file",
                        p.name
                    );
                }
                assert_eq!(p.lines.len(), q.inner.len(), "{name} {}", p.name);
            }
        }
    }

    #[test]
    fn asymmetric_fold_is_written_unfolded() {
        let mut doc = example("tshirt");
        let front = &mut doc.garments[0].pieces[0];
        assert!(!front.folds.is_empty());
        // Move one corner of one half by 1 mm.
        let k = front
            .outline
            .iter()
            .position(|nd| nd.kind == NodeType::Corner)
            .unwrap();
        front.outline[k].position[0] += 1.0;
        let out = export_document(&doc).unwrap();
        assert!(!out.report.pieces[0].folded);
        assert!(
            out.report
                .notes
                .iter()
                .any(|n| n.starts_with("front: written unfolded")),
            "{:?}",
            out.report.notes
        );
        let (pieces, _) = aama::read(&out.text).unwrap();
        assert!(!pieces[0].unfolded);
        assert_eq!(
            pieces[0].boundary.len(),
            doc.garments[0].pieces[0]
                .outline
                .iter()
                .map(|nd| 1 + nd
                    .edge
                    .as_ref()
                    .map_or(0, |e| e.points.as_ref().map_or(0, Vec::len)))
                .sum::<usize>()
        );
    }

    /// DXF-AAMA has polylines only: a cubic edge is written flattened, the same points every
    /// other reader of the file uses (`Edge::interior`).
    #[test]
    fn a_curved_edge_is_written_flattened() {
        let mut doc = example("tshirt");
        let piece = doc.garments[0]
            .pieces
            .iter_mut()
            .find(|p| p.folds.is_empty())
            .unwrap();
        let name = piece.name.clone();
        let n = piece.outline.len();
        let k = (0..n)
            .find(|&k| {
                piece.outline[k]
                    .edge
                    .as_ref()
                    .is_some_and(|e| e.points.as_ref().is_some_and(Vec::is_empty))
            })
            .unwrap();
        let (a, b) = (
            piece.outline[k].position,
            piece.outline[(k + 1) % n].position,
        );
        let l = (b[0] - a[0]).hypot(b[1] - a[1]);
        let out = [(b[1] - a[1]) / l * 4.0, -(b[0] - a[0]) / l * 4.0];
        let at = |t: f64| {
            [
                vitryne_format::round_mm(a[0] + (b[0] - a[0]) * t + out[0]),
                vitryne_format::round_mm(a[1] + (b[1] - a[1]) * t + out[1]),
            ]
        };
        piece.outline[k].edge = Some(vitryne_format::Edge::cubic(at(1.0 / 3.0), at(2.0 / 3.0)));
        let curve = piece.outline[k]
            .edge
            .as_ref()
            .unwrap()
            .interior(a, b)
            .unwrap();
        assert!(curve.len() > 3, "{}", curve.len());
        let want = vitryne_format::outline_points(&piece.outline).unwrap();
        assert!(
            doc.validate().errors.is_empty(),
            "{:?}",
            doc.validate().errors
        );

        let out = export_document(&doc).unwrap();
        let (pieces, _) = aama::read(&out.text).unwrap();
        let got = pieces.iter().find(|p| p.name == name).unwrap();
        assert_eq!(got.boundary.len(), want.len());
        for q in &curve {
            let q = glam::Vec2::new(q[0] as f32, q[1] as f32) * 0.001;
            let near = got
                .boundary
                .iter()
                .map(|p| p.distance(q))
                .fold(f32::MAX, f32::min);
            assert!(near < 1e-5, "{q:?} is {near} m from the written outline");
        }
    }

    #[test]
    fn block_names_are_clean_and_unique() {
        let mut taken = BTreeSet::new();
        assert_eq!(block_name("Front / left", &mut taken), "Front___left");
        assert_eq!(block_name("front _ left", &mut taken), "front___left_2");
        assert_eq!(block_name("  ", &mut taken), "piece");
        assert_eq!(one_line("a\nb\r"), "a b");
    }
}
