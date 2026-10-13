// SPDX-License-Identifier: AGPL-3.0-or-later
//! A Vitryne file (docs/FORMAT.md) to the engine: the garment meshed and placed
//! (`GarmentDesc`), its fabric (`Material`), and the simulation settings it overrides.
//!
//! Each cut becomes a panel (pieces in order, their cuts in order), its outline split into
//! edges at every node; seams become chains of those edges. Lengths go from mm to metres.
//! What the v1 engine can't do yet (FORMAT.md, What M5 has to change in the engine): fabrics
//! are isotropic (the mean of warp and weft is used, with a warning when they differ), and a
//! garment has one fabric (cuts with their own fabric are refused).

use std::collections::BTreeMap;

use glam::{Vec2, Vec3};
use serde_json::{Map, Value};

use drape_core::{
    body::{BodyMesh, SdfParams},
    constraints::Material,
    engine::GarmentDesc,
    sim::{Schedule, SimSettings},
};
use vitryne_format::{
    Direction, Document, Fabric, Garment, Id, Kind, Pairing, Placement, Region, glb,
};

use crate::{
    garment::{DEFAULT_CAMERA, GarmentPattern, garment_desc},
    meshing::MeshedPattern,
    meshing::mesh_pattern,
    pattern::{EdgeRef, Panel, Pattern, PatternEdge, Seam},
    placement::{
        Basis, PlaceSpec, Resolved, default_avatar, place, positions, region_frame, resolve_all,
    },
    tshirt::tshirt_schedule,
};

/// Without a `targetVertices` anywhere.
pub const DEFAULT_TARGET_VERTICES: u32 = 10_000;
/// Added around the placed garment when it has no `collisionBounds`, m.
pub const DERIVED_BOUNDS_MARGIN: f32 = 0.15;

/// `simulation.engine` keys that aren't `SimSettings` fields: the garment's sewing ramp and
/// the SDF resolution.
const KEY_SCHEDULE: &str = "schedule";
const KEY_SDF_CELL: &str = "sdf_cell";
const KEY_SDF_BAND: &str = "sdf_band";

fn m(x: f64) -> f32 {
    (x / 1000.0) as f32
}

fn m2(p: [f64; 2]) -> Vec2 {
    Vec2::new(m(p[0]), m(p[1]))
}

/// A cut's pattern coordinates (mm) to its panel's (m): mirrored (x -> -x), then rotated by
/// its wrap placement's `rotation`.
fn cut_transform(cut: &vitryne_format::Cut) -> impl Fn([f64; 2]) -> Vec2 + use<> {
    let rotation = match &cut.placement {
        Placement::Wrap(w) => w.rotation.unwrap_or(0.0) as f32,
        Placement::Follow(_) => 0.0,
    };
    let (s, c) = rotation.sin_cos();
    let mirrored = cut.mirrored;
    move |q| {
        let q = m2(q);
        let q = if mirrored { Vec2::new(-q.x, q.y) } else { q };
        Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y)
    }
}

/// One garment of a file, ready to turn into an engine garment.
pub struct ProjectGarment<'a> {
    pub doc: &'a Document,
    pub garment: &'a Garment,
    pub fabric: &'a Fabric,
    /// The avatar's regions: the project's avatar, or the test avatar for a garment file.
    pub regions: &'a BTreeMap<String, Region>,
    /// Things the engine ignores or approximates, for the user.
    pub warnings: Vec<String>,
}

impl<'a> ProjectGarment<'a> {
    /// The first garment of a project (the MVP drapes one), or the garment of a garment file.
    pub fn new(doc: &'a Document) -> Result<Self, String> {
        let (garment, regions) = match (doc.kind, &doc.project) {
            (Kind::Project, Some(p)) => {
                let id = p.garments.first().ok_or("the project has no garment")?;
                let avatar = doc.project_avatar().ok_or("the project has no avatar")?;
                (doc.garment(id).ok_or("garment missing")?, &avatar.regions)
            }
            (Kind::Garment, _) => (&doc.garments[0], &default_avatar().regions),
            (kind, _) => return Err(format!("a {kind:?} file has no garment to drape")),
        };
        let mut warnings = Vec::new();
        if let Some(p) = &doc.project
            && p.garments.len() > 1
        {
            warnings.push(format!(
                "the project has {} garments; only the first ({}) is draped",
                p.garments.len(),
                garment.name
            ));
        }
        for (_, cut) in garment.cuts() {
            if cut.fabric.as_ref().is_some_and(|f| f != &garment.fabric) {
                return Err(format!(
                    "{}: cut {} has its own fabric; the engine takes one fabric per garment for now",
                    garment.name,
                    cut.name.as_deref().unwrap_or(cut.id.as_str())
                ));
            }
        }
        let fabric = doc
            .fabric(&garment.fabric)
            .ok_or("the garment's fabric is missing")?;
        if fabric.stretch.warp != fabric.stretch.weft || fabric.bending.warp != fabric.bending.weft
        {
            warnings.push(format!(
                "fabric {}: warp and weft differ; the engine is isotropic for now and uses their mean",
                fabric.name
            ));
        }
        Ok(Self {
            doc,
            garment,
            fabric,
            regions,
            warnings,
        })
    }

    /// The fabric as the engine takes it: per-edge stiffness k = (√3/2)·Y from the membrane
    /// stiffness Y (FORMAT.md, From garment.toml), means of warp and weft.
    pub fn material(&self) -> Material {
        let f = self.fabric;
        Material {
            density: f.density as f32,
            stretch_k: (3f64.sqrt() / 2.0 * 0.5 * (f.stretch.warp + f.stretch.weft)) as f32,
            bend_kb: (0.5 * (f.bending.warp + f.bending.weft)) as f32,
        }
    }

    /// `targetVertices`: the garment's, else the project's, else 10,000.
    pub fn target_vertices(&self) -> u32 {
        self.garment
            .simulation
            .as_ref()
            .and_then(|s| s.target_vertices)
            .or_else(|| {
                self.doc
                    .project
                    .as_ref()
                    .and_then(|p| p.simulation.as_ref())
                    .and_then(|s| s.target_vertices)
            })
            .unwrap_or(DEFAULT_TARGET_VERTICES)
    }

    /// The engine overrides: the project's, then the garment's on top.
    fn engine(&self) -> Map<String, Value> {
        let mut out = Map::new();
        let project = self
            .doc
            .project
            .as_ref()
            .and_then(|p| p.simulation.as_ref())
            .and_then(|s| s.engine.as_ref());
        let garment = self
            .garment
            .simulation
            .as_ref()
            .and_then(|s| s.engine.as_ref());
        for e in [project, garment].into_iter().flatten() {
            out.extend(e.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
        out
    }

    /// Applies the file to `settings`: the fabric's friction, then the engine overrides.
    /// Returns what couldn't be applied.
    pub fn apply_settings(&self, settings: &mut SimSettings) -> Vec<String> {
        settings.friction = self.fabric.friction as f32;
        let mut problems = Vec::new();
        let mut v = serde_json::to_value(*settings).expect("SimSettings serializes");
        for (k, val) in self.engine() {
            if [KEY_SCHEDULE, KEY_SDF_CELL, KEY_SDF_BAND].contains(&k.as_str()) {
                continue;
            }
            match v.get_mut(&k) {
                Some(slot) => {
                    let old = std::mem::replace(slot, val.clone());
                    if serde_json::from_value::<SimSettings>(v.clone()).is_err() {
                        v[&k] = old;
                        problems.push(format!("simulation.engine.{k}: bad value {val}, ignored"));
                    }
                }
                None => problems.push(format!(
                    "simulation.engine.{k}: not an engine setting, ignored"
                )),
            }
        }
        *settings = serde_json::from_value(v).expect("checked above");
        problems
    }

    fn schedule(&self) -> Result<Schedule, String> {
        match self.engine().get(KEY_SCHEDULE) {
            Some(v) => serde_json::from_value(v.clone())
                .map_err(|e| format!("simulation.engine.schedule: {e}")),
            None => Ok(tshirt_schedule()),
        }
    }

    /// The SDF box: `collisionBounds`, or the placed garment's bounding box plus a margin.
    fn sdf_params(&self, placed: &[Vec3]) -> SdfParams {
        let engine = self.engine();
        let num = |k: &str, default: f32| {
            engine
                .get(k)
                .and_then(Value::as_f64)
                .map_or(default, |x| x as f32)
        };
        let d = SdfParams::default();
        let (min, max) = match self
            .garment
            .simulation
            .as_ref()
            .and_then(|s| s.collision_bounds.as_ref())
        {
            Some(b) => (b.min.map(m), b.max.map(m)),
            None => {
                let (lo, hi) = placed.iter().fold(
                    (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)),
                    |(lo, hi), p| (lo.min(*p), hi.max(*p)),
                );
                let lo = (lo - DERIVED_BOUNDS_MARGIN).max(Vec3::new(f32::MIN, 0.0, f32::MIN));
                ((lo).to_array(), (hi + DERIVED_BOUNDS_MARGIN).to_array())
            }
        };
        SdfParams {
            cell: num(KEY_SDF_CELL, d.cell),
            band: num(KEY_SDF_BAND, d.band),
            min,
            max,
        }
    }

    pub fn camera(&self) -> (Vec3, f32) {
        match self.doc.view.as_ref().and_then(|v| v.camera.as_ref()) {
            Some(c) => (
                Vec3::new(m(c.target[0]), m(c.target[1]), m(c.target[2])),
                m(c.distance),
            ),
            None => DEFAULT_CAMERA,
        }
    }

    /// One panel per cut, its outline split into edges at every node (edge k runs from node k to
    /// k + 1, named after node k), plus the internal-line stretches seams use; and the seams.
    pub fn pattern(&self) -> Result<GarmentPattern, String> {
        let g = self.garment;
        let mut panels = Vec::new();
        let mut labels = Vec::new();
        let mut panel_of: BTreeMap<&Id, usize> = BTreeMap::new();
        for (piece, cut) in g.cuts() {
            let t = cut_transform(cut);
            let n = piece.outline.len();
            let mut edges = Vec::with_capacity(n);
            let mut lab = Vec::new();
            for (k, node) in piece.outline.iter().enumerate() {
                let next = &piece.outline[(k + 1) % n];
                let edge = node.edge.as_ref().ok_or("outline node without edge")?;
                let mut pts = vec![t(node.position)];
                pts.extend(edge.points.iter().map(|&q| t(q)));
                pts.push(t(next.position));
                let name = node.name.clone().unwrap_or_else(|| k.to_string());
                lab.push((pts[0], name.clone()));
                edges.push(PatternEdge::new(name, pts));
            }
            for line in &piece.lines {
                for (k, node) in line.nodes.iter().enumerate() {
                    let name = node
                        .name
                        .clone()
                        .unwrap_or_else(|| format!("line node {k}"));
                    lab.push((t(node.position), name));
                }
            }
            let name = cut.name.clone().unwrap_or_else(|| piece.name.clone());
            panel_of.insert(&cut.id, panels.len());
            panels.push(Panel::new(name, edges));
            labels.push(lab);
        }

        let mut seams = Vec::new();
        for s in &g.seams {
            let name = s.name.clone().unwrap_or_else(|| s.id.to_string());
            let mut chain = |runs: &[vitryne_format::Run]| -> Result<Vec<EdgeRef>, String> {
                let mut out = Vec::new();
                for run in runs {
                    let (piece, cut) = g
                        .piece_of_cut(&run.cut)
                        .ok_or_else(|| format!("seam {name}: unknown cut"))?;
                    let pi = panel_of[&cut.id];
                    match &run.line {
                        None => {
                            let at = |id: &Id| piece.outline.iter().position(|n| &n.id == id);
                            let (i, j) = at(&run.from).zip(at(&run.to)).ok_or_else(|| {
                                format!("seam {name}: run ends aren't outline nodes")
                            })?;
                            let m = piece.outline.len();
                            let mut k = i;
                            while k != j {
                                out.push(match run.direction {
                                    Some(Direction::Cw) => {
                                        k = (k + m - 1) % m;
                                        EdgeRef {
                                            panel: pi,
                                            edge: k,
                                            backward: true,
                                        }
                                    }
                                    _ => {
                                        let e = EdgeRef {
                                            panel: pi,
                                            edge: k,
                                            backward: false,
                                        };
                                        k = (k + 1) % m;
                                        e
                                    }
                                });
                            }
                        }
                        Some(line_id) => {
                            let line = piece
                                .lines
                                .iter()
                                .find(|l| &l.id == line_id)
                                .ok_or_else(|| format!("seam {name}: unknown line"))?;
                            let at = |id: &Id| line.nodes.iter().position(|n| &n.id == id);
                            let (i, j) = at(&run.from).zip(at(&run.to)).ok_or_else(|| {
                                format!("seam {name}: run ends aren't line nodes")
                            })?;
                            let (lo, hi) = (i.min(j), i.max(j));
                            // The polyline from node lo to node hi, in the cut's frame.
                            let t = cut_transform(cut);
                            let mut pts = Vec::new();
                            for node in &line.nodes[lo..hi] {
                                pts.push(t(node.position));
                                let e = node.edge.as_ref().ok_or("line node without edge")?;
                                pts.extend(e.points.iter().map(|&q| t(q)));
                            }
                            pts.push(t(line.nodes[hi].position));
                            let k = match panels[pi].inner.iter().position(|e| e.pts == pts) {
                                Some(k) => k,
                                None => {
                                    let label = format!(
                                        "{}: {}-{}",
                                        line.name.as_deref().unwrap_or("line"),
                                        lo,
                                        hi
                                    );
                                    panels[pi].inner.push(PatternEdge::new(label, pts));
                                    panels[pi].inner.len() - 1
                                }
                            };
                            out.push(EdgeRef {
                                panel: pi,
                                edge: panels[pi].inner_index(k),
                                backward: i > j,
                            });
                        }
                    }
                }
                Ok(out)
            };
            let a = chain(&s.a)?;
            let b = chain(&s.b)?;
            seams.push(Seam {
                name,
                a,
                b,
                reversed: false,
                by_length: s.pairing == Some(Pairing::Length),
            });
        }
        Ok(GarmentPattern {
            pattern: Pattern { panels, seams },
            labels,
        })
    }

    /// Edge length for about `verts` vertices (see `garment::Garment::edge_for_vertices`).
    pub fn edge_for_vertices(&self, verts: u32) -> Result<f32, String> {
        let area = self.pattern()?.pattern.area();
        Ok((2.0 * area / (3f32.sqrt() * verts as f32)).sqrt())
    }

    fn place_specs(&self) -> Result<Vec<PlaceSpec>, String> {
        let placements: Vec<(&vitryne_format::Cut, &Placement)> = self
            .garment
            .cuts()
            .map(|(_, c)| (c, &c.placement))
            .collect();
        place_specs(&self.garment.name, self.regions, &placements)
    }

    /// Meshes and places the garment (`edge`: target triangle edge length, m), and keeps what
    /// placing it again needs (`Placer`).
    pub fn build_with_placer(&self, edge: f32) -> Result<(GarmentDesc, Placer), String> {
        let gp = self.pattern()?;
        let pat = &gp.pattern;
        let mp = mesh_pattern(pat, edge);
        let placer = Placer {
            uv: mp.uv.clone(),
            panel_vertices: mp.panel_vertices.clone(),
            outlines: pat.panels.iter().map(|p| p.outline()).collect(),
            names: pat.panels.iter().map(|p| p.name.clone()).collect(),
            cuts: self.garment.cuts().map(|(_, c)| c.clone()).collect(),
            regions: self.regions.clone(),
        };
        Ok((self.finish(pat, mp, edge)?, placer))
    }
}

/// Each cut's `PlaceSpec`, in the garment's cut order (`placements[i]`: cut i and the placement
/// to use for it).
fn place_specs(
    garment: &str,
    regions: &BTreeMap<String, Region>,
    placements: &[(&vitryne_format::Cut, &Placement)],
) -> Result<Vec<PlaceSpec>, String> {
    let index: BTreeMap<&Id, usize> = placements
        .iter()
        .enumerate()
        .map(|(i, (c, _))| (&c.id, i))
        .collect();
    placements
        .iter()
        .map(|&(cut, placement)| {
            let at = |m: String| {
                format!(
                    "{}: cut {}: {m}",
                    garment,
                    cut.name.as_deref().unwrap_or(cut.id.as_str())
                )
            };
            Ok(match placement {
                Placement::Wrap(w) => PlaceSpec::Wrap {
                    frame: region_frame(regions, &w.region).map_err(at)?,
                    angle: w.angle as f32,
                    radius: m(w.radius),
                    top: m(w.top),
                    tube: w.tube.map(|x| x as f32),
                },
                Placement::Follow(f) => PlaceSpec::Follow {
                    of: *index
                        .get(&f.cut)
                        .ok_or_else(|| at("follows an unknown cut".into()))?,
                    angle: f.angle.map(|a| a as f32),
                    lift: m(f.lift),
                },
            })
        })
        .collect()
}

impl ProjectGarment<'_> {
    /// Where cut `cut`'s outline goes with `placement` instead of its own (the other cuts as
    /// they are), m. Cheap: no meshing.
    pub fn placed_outline(&self, cut: &Id, placement: &Placement) -> Result<Vec<Vec3>, String> {
        let gp = self.pattern()?;
        let cuts: Vec<&vitryne_format::Cut> = self.garment.cuts().map(|(_, c)| c).collect();
        let i = cuts
            .iter()
            .position(|c| &c.id == cut)
            .ok_or_else(|| format!("no cut {cut}"))?;
        let turn = match (placement, &cuts[i].placement) {
            (Placement::Wrap(a), Placement::Wrap(b)) => {
                (a.rotation.unwrap_or(0.0) - b.rotation.unwrap_or(0.0)) as f32
            }
            (Placement::Wrap(a), Placement::Follow(_)) => a.rotation.unwrap_or(0.0) as f32,
            (Placement::Follow(_), _) => 0.0,
        };
        let (s, c) = turn.sin_cos();
        let mut outlines: Vec<Vec<Vec2>> = gp.pattern.panels.iter().map(|p| p.outline()).collect();
        outlines[i] = outlines[i]
            .iter()
            .map(|q| Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y))
            .collect();
        let pairs: Vec<(&vitryne_format::Cut, &Placement)> = cuts
            .iter()
            .enumerate()
            .map(|(k, c)| (*c, if k == i { placement } else { &c.placement }))
            .collect();
        let specs = place_specs(&self.garment.name, self.regions, &pairs)?;
        let names: Vec<&str> = gp.pattern.panels.iter().map(|p| p.name.as_str()).collect();
        let resolved = resolve_all(&outlines, &names, &specs)?;
        Ok(outlines[i].iter().map(|&q| resolved[i].at(q)).collect())
    }

    /// Meshes and places the garment (`edge`: target triangle edge length, m).
    pub fn build(&self, edge: f32) -> Result<GarmentDesc, String> {
        let gp = self.pattern()?;
        let pat = &gp.pattern;
        let mp = mesh_pattern(pat, edge);
        self.finish(pat, mp, edge)
    }

    fn finish(
        &self,
        pat: &Pattern,
        mut mp: MeshedPattern,
        edge: f32,
    ) -> Result<GarmentDesc, String> {
        place(&mut mp, pat, &self.place_specs()?)?;
        let sdf = self.sdf_params(&mp.mesh.pos);
        let material = self.material();
        let description = serde_json::json!({ "garment": self.garment.name, "edge": edge,
            "fabric": { "name": self.fabric.name, "density": material.density, "stretch_k": material.stretch_k, "bend_kb": material.bend_kb } });
        Ok(garment_desc(
            &self.garment.name,
            description,
            pat,
            mp,
            Some(self.schedule()?),
            sdf,
            self.camera(),
        ))
    }
}

/// What placing a meshed garment again needs, without meshing it again: the editor moves a
/// cut and sees it move at once (docs/ARCHITECTURE.md, Placement).
#[derive(Clone)]
pub struct Placer {
    uv: Vec<Vec2>,
    panel_vertices: Vec<std::ops::Range<u32>>,
    /// Each panel's outline, in its cut's frame (mirrored, rotated) as meshed.
    outlines: Vec<Vec<Vec2>>,
    names: Vec<String>,
    /// The cuts as meshed, one per panel.
    cuts: Vec<vitryne_format::Cut>,
    regions: BTreeMap<String, Region>,
}

/// The garment's wraps with one cut's placement replaced (see `Placer::resolve`): each panel's
/// wrap and outline, and how much that cut turned, radians.
struct Replaced {
    resolved: Vec<Resolved>,
    outlines: Vec<Vec<Vec2>>,
    turn: f32,
}

/// A cut's centre on the body and how it moves (see `Placer::gizmo`).
#[derive(Debug, Clone, Copy)]
pub struct Gizmo {
    pub basis: Basis,
    /// The cut's width and height, m.
    pub size: Vec2,
    /// The cylinder's radius there, m.
    pub radius: f32,
}

impl Placer {
    pub fn cut_ids(&self) -> Vec<String> {
        self.cuts.iter().map(|c| c.id.to_string()).collect()
    }

    fn rotation(p: &Placement) -> f32 {
        match p {
            Placement::Wrap(w) => w.rotation.unwrap_or(0.0) as f32,
            Placement::Follow(_) => 0.0,
        }
    }

    /// Each panel's wrap with cut `cut`'s placement replaced by `placement`, and that panel's
    /// pattern turned by the change in rotation (the rest of the pattern is as meshed).
    fn resolve(&self, cut: usize, placement: &Placement) -> Result<Replaced, String> {
        if cut >= self.cuts.len() {
            return Err(format!("no cut {cut}"));
        }
        let turn = Self::rotation(placement) - Self::rotation(&self.cuts[cut].placement);
        let (s, c) = turn.sin_cos();
        let rot = move |q: Vec2| Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y);
        let mut outlines = self.outlines.clone();
        outlines[cut] = outlines[cut].iter().map(|&q| rot(q)).collect();
        let pairs: Vec<(&vitryne_format::Cut, &Placement)> = self
            .cuts
            .iter()
            .enumerate()
            .map(|(i, c)| (c, if i == cut { placement } else { &c.placement }))
            .collect();
        // Only the garment's name is used, in errors.
        let specs = place_specs("the garment", &self.regions, &pairs)?;
        let names: Vec<&str> = self.names.iter().map(String::as_str).collect();
        Ok(Replaced {
            resolved: resolve_all(&outlines, &names, &specs)?,
            outlines,
            turn,
        })
    }

    /// Every vertex's start position with cut `cut` (in panel order) placed at `placement`.
    pub fn positions(&self, cut: usize, placement: &Placement) -> Result<Vec<Vec3>, String> {
        let Replaced { resolved, turn, .. } = self.resolve(cut, placement)?;
        let (s, c) = turn.sin_cos();
        let mut uv = self.uv.clone();
        for v in self.panel_vertices[cut].clone() {
            let q = uv[v as usize];
            uv[v as usize] = Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y);
        }
        Ok(positions(&uv, &self.panel_vertices, &resolved))
    }

    /// The cuts as meshed, in panel order.
    pub fn cuts(&self) -> &[vitryne_format::Cut] {
        &self.cuts
    }

    /// The middle of cut `cut` on the body when placed at `placement` (half-way down from
    /// its anchor, the top centre), and the directions it moves in.
    pub fn gizmo(&self, cut: usize, placement: &Placement) -> Result<Gizmo, String> {
        let Replaced {
            resolved, outlines, ..
        } = self.resolve(cut, placement)?;
        let (lo, hi) = outlines[cut].iter().fold(
            (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)),
            |(lo, hi), q| (lo.min(*q), hi.max(*q)),
        );
        let r = &resolved[cut];
        let mid = Vec2::new(r.anchor().x, 0.5 * (lo.y + hi.y));
        Ok(Gizmo {
            basis: r.basis_at(mid),
            size: hi - lo,
            radius: r.radius_at(mid.y),
        })
    }
}

/// The avatar mesh of a project (its glTF part, metres).
pub fn avatar_mesh(doc: &Document) -> Result<Option<BodyMesh>, String> {
    let Some(avatar) = doc.project_avatar() else {
        return Ok(None);
    };
    let file = doc
        .files
        .get(&avatar.mesh)
        .ok_or_else(|| format!("avatar mesh {} missing", avatar.mesh))?;
    let mesh = glb::read(&file.bytes).map_err(|e| format!("{}: {e}", avatar.mesh))?;
    Ok(Some(BodyMesh::new(
        mesh.positions.iter().map(|&p| Vec3::from(p)).collect(),
        mesh.indices.as_chunks::<3>().0.to_vec(),
    )))
}
