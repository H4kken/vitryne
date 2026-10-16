// SPDX-License-Identifier: AGPL-3.0-or-later
//! The entities of a file, one type per JSON part (FORMAT.md, Project to View), in the units
//! of the format: mm for every length, radians, SI for physics.
//!
//! Every struct keeps the members it doesn't know in `other` (unknown fields, `extensions`,
//! `extras`) and writes them back, so a newer file survives a round trip through this reader.
//! Optional members that are absent stay absent when written.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::id::Id;

/// Members this reader doesn't know, kept as they were.
pub type Other = Map<String, Value>;
pub type Vec2 = [f64; 2];
pub type Vec3 = [f64; 3];

fn is_false(b: &bool) -> bool {
    !*b
}

/// Rounds a length to 0.001 mm, as writers do (FORMAT.md, Numbers and JSON); `+ 0.0` turns
/// -0 into 0.
pub fn round_mm(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0 + 0.0
}

fn round2(p: &mut Vec2) {
    p.iter_mut().for_each(|x| *x = round_mm(*x));
}

fn round3(p: &mut Vec3) {
    p.iter_mut().for_each(|x| *x = round_mm(*x));
}

// ---- project.json -------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Layering order, closest to the body first.
    pub garments: Vec<Id>,
    pub avatar: Id,
    /// Every fabric part of the file, used or not.
    pub fabrics: Vec<Id>,
    /// Every appearance part of the file, used or not (format version 2).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub appearances: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulation: Option<ProjectSimulation>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSimulation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_vertices: Option<u32>,
    /// Sparse engine tuning: `SimSettings` names, the engine's units (SI, metres).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<Map<String, Value>>,
    #[serde(flatten)]
    pub other: Other,
}

// ---- garments/<id>.json -------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Garment {
    pub id: Id,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_ref: Option<Value>,
    /// The default fabric of its cuts.
    pub fabric: Id,
    /// The default appearance of its cuts; absent = the app's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulation: Option<GarmentSimulation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<Source>,
    pub pieces: Vec<Piece>,
    pub seams: Vec<Seam>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarmentSimulation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_vertices: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<Map<String, Value>>,
    /// The box the cloth can reach (mm, avatar space), where the body's collision field is built.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collision_bounds: Option<Bounds>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub min: Vec3,
    pub max: Vec3,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Attribution {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    /// An SPDX licence expression.
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(flatten)]
    pub other: Other,
}

/// An imported original (a DXF), for reference and re-import; nothing is read from it when
/// opening a file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: Id,
    /// e.g. `dxf-aama`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    /// The part holding the original, if it is kept in the file (role `source`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Piece {
    pub id: Id,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<PieceSource>,
    /// The sewing line, counter-clockwise, each node with the edge to the next.
    pub outline: Vec<Node>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<Line>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folds: Vec<Fold>,
    /// Warp direction; absent = +y.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grain: Option<Grain>,
    pub cuts: Vec<Cut>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PieceSource {
    pub source: Id,
    /// The piece's name in the source.
    pub piece: String,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Corner,
    Notch,
    Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: Id,
    #[serde(rename = "type")]
    pub kind: NodeType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub position: Vec2,
    /// To the next node (every outline node; every line node but the last).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge: Option<Edge>,
    #[serde(flatten)]
    pub other: Other,
}

pub const EDGE_POLYLINE: &str = "polyline";

/// v1 has `polyline` only: the points strictly between the node and the next. The type is kept
/// as a string so a newer edge type survives a round trip; geometry refuses it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    #[serde(rename = "type")]
    pub kind: String,
    pub points: Vec<Vec2>,
    #[serde(flatten)]
    pub other: Other,
}

impl Edge {
    pub fn polyline(points: Vec<Vec2>) -> Self {
        Self {
            kind: EDGE_POLYLINE.into(),
            points,
            other: Other::new(),
        }
    }
}

/// An internal line: an open path of nodes, each with the edge to the next except the last.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub nodes: Vec<Node>,
    #[serde(flatten)]
    pub other: Other,
}

/// A fold line between two outline nodes (the piece is stored unfolded).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fold {
    pub id: Id,
    pub from: Id,
    pub to: Id,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Grain {
    pub from: Vec2,
    pub to: Vec2,
    #[serde(flatten)]
    pub other: Other,
}

/// One copy of a piece in the garment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cut {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The mirror image (x -> -x in the piece frame).
    #[serde(default, skip_serializing_if = "is_false")]
    pub mirrored: bool,
    /// Overrides the garment's fabric.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fabric: Option<Id>,
    /// Overrides the garment's appearance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Id>,
    pub placement: Placement,
    /// Where it sits in the 2D pattern view. Display only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Vec2>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(flatten)]
    pub other: Other,
}

/// Where a cut starts before sewing (FORMAT.md, Placement).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Placement {
    Wrap(Wrap),
    Follow(Follow),
}

/// Rolled onto a cylinder around one of the avatar's regions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wrap {
    pub region: String,
    /// Radians from the region's zero direction, towards `axis x zero`.
    pub angle: f64,
    /// mm.
    pub radius: f64,
    /// The piece's top edge along the axis, mm from the region's origin.
    pub top: f64,
    /// In-plane rotation before wrapping, radians counter-clockwise, after mirroring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    /// Long sleeves: radius from the pattern width below the widest row (`tube` x width / 2 pi).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tube: Option<f64>,
    #[serde(flatten)]
    pub other: Other,
}

/// On top of another cut: its region, anchor, top and tube, at its radius plus `lift`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Follow {
    pub cut: Id,
    /// mm.
    pub lift: f64,
    /// Radians; absent = the followed cut's angle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    /// The outline's order.
    Ccw,
    Cw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pairing {
    Nodes,
    Length,
}

/// A seam sews side `a` to side `b`; the start of `a` meets the start of `b`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Seam {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub a: Vec<Run>,
    pub b: Vec<Run>,
    /// Absent = `nodes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairing: Option<Pairing>,
    #[serde(flatten)]
    pub other: Other,
}

/// A stretch of one cut's outline between two of its nodes (with `direction`), or of one of its
/// internal lines (with `line`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub cut: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<Id>,
    pub from: Id,
    pub to: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<Direction>,
    #[serde(flatten)]
    pub other: Other,
}

impl Garment {
    pub fn piece_of_cut(&self, cut: &Id) -> Option<(&Piece, &Cut)> {
        self.pieces
            .iter()
            .find_map(|p| p.cuts.iter().find(|c| &c.id == cut).map(|c| (p, c)))
    }

    pub fn cuts(&self) -> impl Iterator<Item = (&Piece, &Cut)> {
        self.pieces
            .iter()
            .flat_map(|p| p.cuts.iter().map(move |c| (p, c)))
    }

    pub(crate) fn round_lengths(&mut self) {
        if let Some(b) = self
            .simulation
            .as_mut()
            .and_then(|s| s.collision_bounds.as_mut())
        {
            round3(&mut b.min);
            round3(&mut b.max);
        }
        for p in &mut self.pieces {
            let nodes = p
                .outline
                .iter_mut()
                .chain(p.lines.iter_mut().flat_map(|l| l.nodes.iter_mut()));
            for n in nodes {
                round2(&mut n.position);
                if let Some(e) = &mut n.edge {
                    e.points.iter_mut().for_each(round2);
                }
            }
            if let Some(g) = &mut p.grain {
                round2(&mut g.from);
                round2(&mut g.to);
            }
            for c in &mut p.cuts {
                match &mut c.placement {
                    Placement::Wrap(w) => {
                        w.radius = round_mm(w.radius);
                        w.top = round_mm(w.top);
                    }
                    Placement::Follow(f) => f.lift = round_mm(f.lift),
                }
                if let Some(pos) = c.layout.as_mut().and_then(|l| l.position.as_mut()) {
                    round2(pos);
                }
            }
        }
    }
}

// ---- fabrics/<id>.json --------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Woven,
    Knit,
    Nonwoven,
}

/// The physical behaviour of a fabric, independent of mesh resolution and solver.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fabric {
    pub id: Id,
    pub name: String,
    pub category: Category,
    /// kg/m².
    pub density: f64,
    /// mm; not used by the v1 engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thickness: Option<f64>,
    pub stretch: Stretch,
    pub bending: Bending,
    /// Coulomb coefficient against the body.
    pub friction: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_ref: Option<Value>,
    #[serde(flatten)]
    pub other: Other,
}

/// Tensile stiffness along the grain (warp) and across it (weft), and in-plane shear, N/m.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stretch {
    pub warp: f64,
    pub weft: f64,
    pub shear: f64,
    #[serde(flatten)]
    pub other: Other,
}

/// Bending rigidity per unit width, N·m.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bending {
    pub warp: f64,
    pub weft: f64,
    /// Absent = the mean of warp and weft.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bias: Option<f64>,
    #[serde(flatten)]
    pub other: Other,
}

// ---- appearances/<id>.json ----------------------------------------------------------------

/// How a fabric looks (FORMAT.md, Appearance): its colour for now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub id: Id,
    pub name: String,
    /// sRGB, `#rrggbb`.
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_ref: Option<Value>,
    #[serde(flatten)]
    pub other: Other,
}

impl Appearance {
    /// The colour as sRGB 0..1, or none if it isn't `#rrggbb`.
    pub fn rgb(&self) -> Option<[f32; 3]> {
        parse_hex_color(&self.color)
    }
}

/// `#rrggbb` (either case) as sRGB 0..1.
pub fn parse_hex_color(s: &str) -> Option<[f32; 3]> {
    let hex = s.strip_prefix('#').filter(|h| h.len() == 6)?;
    let mut out = [0.0; 3];
    for (i, c) in out.iter_mut().enumerate() {
        *c = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()? as f32 / 255.0;
    }
    Some(out)
}

// ---- avatars/<id>/avatar.json -------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Avatar {
    pub id: Id,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_ref: Option<Value>,
    /// The part holding the mesh: glTF binary, metres, avatar space.
    pub mesh: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pose: Option<String>,
    /// mm, informational in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measurements: Option<Map<String, Value>>,
    pub regions: BTreeMap<String, Region>,
    #[serde(flatten)]
    pub other: Other,
}

/// A frame to wrap pieces around (FORMAT.md, Regions). Positions in mm; directions unitless.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Region {
    /// A straight line through `origin` along `axis` (towards the top of the pieces).
    Axis(AxisRegion),
    /// A centreline through `points` (the first is the origin), a Catmull-Rom curve.
    Path(PathRegion),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AxisRegion {
    pub origin: Vec3,
    pub axis: Vec3,
    /// The direction of angle 0.
    pub zero: Vec3,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathRegion {
    pub points: Vec<Vec3>,
    pub zero: Vec3,
    #[serde(flatten)]
    pub other: Other,
}

impl Avatar {
    pub(crate) fn round_lengths(&mut self) {
        for r in self.regions.values_mut() {
            match r {
                Region::Axis(a) => round3(&mut a.origin),
                Region::Path(p) => p.points.iter_mut().for_each(round3),
            }
        }
    }
}

impl Fabric {
    pub(crate) fn round_lengths(&mut self) {
        self.thickness = self.thickness.map(round_mm);
    }
}

// ---- view.json ----------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct View {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<Camera>,
    #[serde(flatten)]
    pub other: Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    /// mm.
    pub target: Vec3,
    /// mm.
    pub distance: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yaw: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pitch: Option<f64>,
    #[serde(flatten)]
    pub other: Other,
}

impl View {
    pub(crate) fn round_lengths(&mut self) {
        if let Some(c) = &mut self.camera {
            round3(&mut c.target);
            c.distance = round_mm(c.distance);
        }
    }
}
