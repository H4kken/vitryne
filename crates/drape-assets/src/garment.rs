// SPDX-License-Identifier: AGPL-3.0-or-later
//! A garment from a DXF-AAMA pattern plus a `garment.toml` sidecar. DXF carries the pieces;
//! the sidecar says which pieces are cut (and mirrored), where each one starts around the
//! avatar, and which landmark runs are sewn together (DXF has no sewing information).
//!
//! Landmark references (see `aama` for what a landmark is):
//!   "front:3-5"     the boundary of piece instance `front` from landmark 3 to landmark 5,
//!                   going forward (counter-clockwise in the DXF piece; a mirrored instance
//!                   uses the mirror image of the same run)
//!   "front:L0:2-3"  internal line 0 of `front`, from its landmark 2 to 3 (3-2 runs backwards)
//!   "!front:3-5"    the same run, traversed backwards (from 5 to 3)
//!   ["a:1-2", "b:3-4"] several runs sewn as one chain (they may span pieces)
//!   "sleeve:2-3+0.5" a boundary landmark may be fractional: `3+0.5` is the point halfway (by
//!                   length) from landmark 3 to landmark 4, e.g. a sleeve-cap top with no notch
//! `drape garment-svg <garment.toml>` draws every piece with its landmark numbers.
//!
//! Placement: each piece is wrapped on a cylinder around a body frame (torso, arm_l, arm_r,
//! bentarm_l, bentarm_r, longarm_l, longarm_r, leg_l, leg_r, head, head_over; `_l` = the
//! wearer's left = world +X), which are the test avatar's regions under their sidecar names
//! (`placement::SIDECAR_REGIONS`).
//!
//! `drape convert` turns a sidecar and its DXF into a project file (`convert`); the optional
//! `title`, `[attribution]`, `[fabric]`, `[names]` and `label`s are only used there.

use std::collections::BTreeMap;

use glam::{Vec2, Vec3};
use serde::{Deserialize, Serialize};

use drape_core::{constraints::Material, engine::GarmentDesc, sim::Schedule};

use crate::{
    aama::{self, ImportReport, Piece},
    meshing::{MeshedPattern, mesh_pattern},
    pattern::{EdgeRef, Panel, Pattern, PatternEdge, Seam},
    placement::{PlaceSpec, default_avatar, place, region_frame, sidecar_region},
    tshirt::{SdfParams, tshirt_schedule},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GarmentSpec {
    pub name: String,
    /// DXF-AAMA file, relative to the toml.
    pub dxf: String,
    /// Metres per DXF unit; overrides the file's `$INSUNITS`.
    #[serde(default)]
    pub units_m: Option<f64>,
    /// Body SDF box; default: the T-shirt's.
    #[serde(default)]
    pub sdf: Option<SdfParams>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    /// Engine overrides for the project file (`simulation.engine`, drape-core `SimSettings`
    /// names), e.g. `self_collision = true`. Only `drape convert` uses them.
    #[serde(default)]
    pub engine: Option<serde_json::Map<String, serde_json::Value>>,
    /// Fabric; default `Material::cotton()` (the spike-1 jersey placeholder).
    #[serde(default)]
    pub material: Option<MaterialSpec>,
    /// Viewer camera target (x, y, z) and distance.
    #[serde(default)]
    pub camera: Option<[f32; 4]>,
    /// The garment's name in a project file (default: `name`).
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub attribution: Option<AttributionSpec>,
    /// What the project file says about the fabric (`[material]` gives its physics).
    #[serde(default)]
    pub fabric: Option<FabricSpec>,
    /// Names of the landmarks in a project file, by DXF piece: `front = ["centre front hem",
    /// ...]` in landmark order, `"sleeve:3+0.5" = "cap top"` for a fractional landmark,
    /// `"front:L0" = [...]` for the landmarks of internal line 0.
    #[serde(default)]
    pub names: BTreeMap<String, Names>,
    pub piece: Vec<PieceSpec>,
    #[serde(default)]
    pub seam: Vec<SeamSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AttributionSpec {
    pub title: Option<String>,
    pub creator: Option<String>,
    /// SPDX licence expression.
    pub license: String,
    pub source: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FabricSpec {
    pub name: String,
    /// woven | knit | nonwoven
    pub category: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Names {
    List(Vec<String>),
    One(String),
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialSpec {
    /// kg/m²
    pub density: f32,
    /// Edge stiffness, N/m.
    pub stretch_k: f32,
    /// Bending rigidity, N·m.
    pub bend_kb: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PieceSpec {
    /// Instance name (a DXF piece cut twice gives two instances).
    pub name: String,
    /// Piece name in the DXF ("Piece Name:" text, or the block name).
    pub dxf: String,
    /// Mirror image (x -> -x) of the DXF piece: the other one of a left/right pair.
    #[serde(default)]
    pub mirror: bool,
    /// Rotation in the pattern plane after mirroring, degrees counter-clockwise.
    #[serde(default)]
    pub rotate: f32,
    pub place: Place,
    /// The cut's name in a project file (default: `name`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Place {
    /// Body frame: torso | arm_l | arm_r | longarm_l | longarm_r | leg_l | leg_r | head |
    /// head_over.
    #[serde(default)]
    pub frame: Option<String>,
    /// Where the piece's centre goes around the axis, degrees (0 = the frame's front / top).
    #[serde(default)]
    pub angle: Option<f32>,
    /// Cylinder radius, m.
    #[serde(default)]
    pub radius: Option<f32>,
    /// Position of the piece's top edge along the frame axis, m (torso: height above the
    /// floor; arms: from the shoulder, negative = down the arm; legs: from the floor along the
    /// leg axis).
    #[serde(default)]
    pub top: Option<f32>,
    /// Use another instance's placement and pattern anchor (for a piece drafted in that
    /// piece's coordinates, like a pocket on a front), `lift` further out.
    #[serde(default)]
    pub like: Option<String>,
    #[serde(default)]
    pub lift: f32,
    /// Tube placement (long sleeves): below the piece's widest row the radius follows the
    /// pattern, `tube` x width / 2 pi (> 1 leaves a gap, so the open edges meet the short way,
    /// under the arm); above it, it rises linearly to `radius` at the top edge.
    #[serde(default)]
    pub tube: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeamSpec {
    pub name: String,
    pub a: Runs,
    pub b: Runs,
    /// Sew `a`'s start to `b`'s end.
    #[serde(default)]
    pub reverse: bool,
    /// Pair the two sides by length along the whole chain, even if they have the same number of
    /// edges (by default equal edge counts are paired edge by edge, so notches meet).
    #[serde(default)]
    pub by_length: bool,
    /// The seam's name in a project file (default: `name`).
    #[serde(default)]
    pub label: Option<String>,
}

/// One run ("front:3-5") or several, sewn as one chain (e.g. a hood neckline that spans the
/// front, a raglan sleeve top and the back).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Runs {
    One(String),
    Many(Vec<String>),
}

impl Runs {
    pub fn list(&self) -> Vec<&str> {
        match self {
            Runs::One(r) => vec![r.as_str()],
            Runs::Many(v) => v.iter().map(String::as_str).collect(),
        }
    }
}

pub struct Garment {
    pub spec: GarmentSpec,
    pub pieces: Vec<Piece>,
    pub report: ImportReport,
}

/// One piece instance in the pattern: its panel, landmark positions, placement.
struct Instance {
    boundary: Vec<Vec2>,
    /// Boundary vertex of each landmark, in boundary order (including fractional ones)...
    landmarks: Vec<usize>,
    /// ...and its name as seams refer to it ("3", "3+0.5").
    names: Vec<String>,
    inner: Vec<aama::InnerLine>,
}

pub struct GarmentPattern {
    pub pattern: Pattern,
    /// Per panel: landmark labels, for the SVG.
    pub labels: Vec<Vec<(Vec2, String)>>,
}

impl Garment {
    pub fn load(toml_text: &str, dxf_text: &str) -> Result<Self, String> {
        let spec: GarmentSpec =
            toml::from_str(toml_text).map_err(|e| format!("garment.toml: {e}"))?;
        let (pieces, report) = aama::read_with_units(dxf_text, spec.units_m)?;
        for w in &report.warnings {
            log::warn!("{w}");
        }
        Ok(Self {
            spec,
            pieces,
            report,
        })
    }

    /// Reads `garment.toml` and the DXF it names, from disk (native).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load_file(path: &str) -> Result<Self, String> {
        let toml_text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let spec: GarmentSpec = toml::from_str(&toml_text).map_err(|e| format!("{path}: {e}"))?;
        let dir = std::path::Path::new(path)
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let dxf_path = dir.join(&spec.dxf);
        let dxf_text = std::fs::read_to_string(&dxf_path)
            .map_err(|e| format!("{}: {e}", dxf_path.display()))?;
        Self::load(&toml_text, &dxf_text)
    }

    fn piece(&self, name: &str) -> Result<&Piece, String> {
        self.pieces.iter().find(|p| p.name == name).ok_or_else(|| {
            format!(
                "no piece {name} in the DXF (have: {})",
                self.report.pieces.join(", ")
            )
        })
    }

    fn instance(&self, ps: &PieceSpec) -> Result<Instance, String> {
        let p = self.piece(&ps.dxf)?;
        let (s, c) = ps.rotate.to_radians().sin_cos();
        let t = |q: Vec2| {
            let q = if ps.mirror { Vec2::new(-q.x, q.y) } else { q };
            Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y)
        };
        let mut landmarks: Vec<usize> = p.landmarks.iter().map(|l| l.at).collect();
        if landmarks.is_empty() {
            landmarks.push(0);
        }
        // Fractional landmarks used by seams on this instance: split the boundary there.
        let mut boundary: Vec<Vec2> = p.boundary.iter().map(|&q| t(q)).collect();
        let mut marks: Vec<(Vec2, String)> = landmarks
            .iter()
            .enumerate()
            .map(|(k, &at)| (boundary[at], k.to_string()))
            .collect();
        let mut fracs: Vec<(usize, f32)> = Vec::new();
        for ss in &self.spec.seam {
            for r in ss.a.list().into_iter().chain(ss.b.list()) {
                let parts: Vec<&str> = r.trim_start_matches('!').split(':').collect();
                if parts.len() == 2 && parts[0] == ps.name {
                    for tok in parts[1].split('-') {
                        if let Some((k, f)) = tok.split_once('+') {
                            let k: usize = k
                                .trim()
                                .parse()
                                .map_err(|_| format!("seam {}: bad landmark {tok:?}", ss.name))?;
                            let f: f32 = f
                                .trim()
                                .parse()
                                .map_err(|_| format!("seam {}: bad landmark {tok:?}", ss.name))?;
                            if k >= landmarks.len() || !(0.0..1.0).contains(&f) || f == 0.0 {
                                return Err(format!(
                                    "seam {}: landmark {tok:?} out of range",
                                    ss.name
                                ));
                            }
                            fracs.push((k, f));
                        }
                    }
                }
            }
        }
        let n = boundary.len();
        for &(k, f) in &fracs {
            let (from, to) = (landmarks[k], landmarks[(k + 1) % landmarks.len()]);
            let mut run = vec![from];
            let mut i = (from + 1) % n;
            while i != to {
                run.push(i);
                i = (i + 1) % n;
            }
            run.push(to);
            let total: f32 = run
                .windows(2)
                .map(|w| p.boundary[w[0]].distance(p.boundary[w[1]]))
                .sum();
            let (mut acc, target) = (0.0, f * total);
            for w in run.windows(2) {
                let l = p.boundary[w[0]].distance(p.boundary[w[1]]);
                if acc + l >= target {
                    let u = ((target - acc) / l.max(1e-12)).clamp(0.0, 1.0);
                    // On the format's grid, as `drape convert` stores it.
                    let q = aama::on_grid(p.boundary[w[0]].lerp(p.boundary[w[1]], u).as_dvec2());
                    marks.push((t(q), format!("{k}+{f}")));
                    break;
                }
                acc += l;
            }
        }
        for (q, _) in &marks[landmarks.len()..] {
            // Split the segment that contains q (or reuse a vertex at q).
            if !boundary.contains(q) {
                let nb = boundary.len();
                let i = (0..nb)
                    .min_by(|&i, &j| {
                        crate::pattern::dist_to_segment(*q, boundary[i], boundary[(i + 1) % nb])
                            .total_cmp(&crate::pattern::dist_to_segment(
                                *q,
                                boundary[j],
                                boundary[(j + 1) % nb],
                            ))
                    })
                    .unwrap();
                boundary.insert(i + 1, *q);
            }
        }
        let mut indexed: Vec<(usize, String)> = marks
            .iter()
            .map(|(q, name)| (boundary.iter().position(|b| b == q).unwrap(), name.clone()))
            .collect();
        indexed.sort_by_key(|m| m.0);
        indexed.dedup_by_key(|m| m.0);
        Ok(Instance {
            boundary,
            landmarks: indexed.iter().map(|m| m.0).collect(),
            names: indexed.into_iter().map(|m| m.1).collect(),
            inner: p
                .inner
                .iter()
                .map(|l| aama::InnerLine {
                    pts: l.pts.iter().map(|&q| t(q)).collect(),
                    landmarks: l.landmarks.clone(),
                })
                .collect(),
        })
    }

    /// The pattern: one panel per instance, its boundary split into edges at every landmark
    /// (edge k runs from landmark k to k + 1), plus the internal-line runs used by seams.
    pub fn pattern(&self) -> Result<GarmentPattern, String> {
        let mut panels = Vec::new();
        let mut instances = Vec::new();
        let mut labels = Vec::new();
        for ps in &self.spec.piece {
            let inst = self.instance(ps)?;
            let n = inst.boundary.len();
            let m = inst.landmarks.len();
            let edges = (0..m)
                .map(|k| {
                    let (from, to) = (inst.landmarks[k], inst.landmarks[(k + 1) % m]);
                    let mut pts = vec![inst.boundary[from]];
                    let mut i = (from + 1) % n;
                    while i != to {
                        pts.push(inst.boundary[i]);
                        i = (i + 1) % n;
                    }
                    pts.push(inst.boundary[to]);
                    PatternEdge::new(format!("{k}-{}", (k + 1) % m), pts)
                })
                .collect();
            let mut lab: Vec<(Vec2, String)> = inst
                .landmarks
                .iter()
                .zip(&inst.names)
                .map(|(&at, name)| (inst.boundary[at], name.clone()))
                .collect();
            for (li, l) in inst.inner.iter().enumerate() {
                for (k, &v) in l.landmarks.iter().enumerate() {
                    lab.push((l.pts[v], format!("L{li}:{k}")));
                }
            }
            labels.push(lab);
            panels.push(Panel::new(ps.name.clone(), edges));
            instances.push(inst);
        }
        let panel_of = |name: &str| {
            self.spec
                .piece
                .iter()
                .position(|p| p.name == name)
                .ok_or_else(|| format!("seam refers to unknown piece {name}"))
        };
        let mut seams = Vec::new();
        for ss in &self.spec.seam {
            let mut run = |r: &str| -> Result<Vec<EdgeRef>, String> {
                let parts: Vec<&str> = r.split(':').collect();
                let bad = || {
                    format!(
                        "seam {}: bad reference {r:?} (want piece:i-j or piece:L0:i-j)",
                        ss.name
                    )
                };
                let range = |s: &str| -> Result<(usize, usize), String> {
                    let (i, j) = s.split_once('-').ok_or_else(bad)?;
                    Ok((
                        i.trim().parse().map_err(|_| bad())?,
                        j.trim().parse().map_err(|_| bad())?,
                    ))
                };
                let pi = panel_of(parts[0])?;
                match parts.len() {
                    2 => {
                        let names = &instances[pi].names;
                        let find = |tok: &str| {
                            names.iter().position(|n| n == tok.trim()).ok_or_else(|| {
                                format!(
                                    "seam {}: {r}: no landmark {tok} (have {})",
                                    ss.name,
                                    names.join(" ")
                                )
                            })
                        };
                        let (i, j) = parts[1].split_once('-').ok_or_else(bad)?;
                        let (i, j) = (find(i)?, find(j)?);
                        let m = names.len();
                        if i == j {
                            return Err(bad());
                        }
                        let mut out = Vec::new();
                        let mut k = i;
                        while k != j {
                            out.push(EdgeRef {
                                panel: pi,
                                edge: k,
                                backward: false,
                            });
                            k = (k + 1) % m;
                        }
                        Ok(out)
                    }
                    3 => {
                        let li: usize = parts[1]
                            .strip_prefix('L')
                            .and_then(|x| x.parse().ok())
                            .ok_or_else(bad)?;
                        let line = instances[pi].inner.get(li).ok_or_else(|| {
                            format!("seam {}: {r}: no internal line {li}", ss.name)
                        })?;
                        let (i, j) = range(parts[2])?;
                        let m = line.landmarks.len();
                        if i >= m || j >= m || i == j {
                            return Err(format!(
                                "seam {}: {r}: line has landmarks 0..{}",
                                ss.name,
                                m - 1
                            ));
                        }
                        let (lo, hi) = (line.landmarks[i.min(j)], line.landmarks[i.max(j)]);
                        let pts = line.pts[lo..=hi].to_vec();
                        let panel = &mut panels[pi];
                        let k = match panel.inner.iter().position(|e| e.pts == pts) {
                            Some(k) => k,
                            None => {
                                panel.inner.push(PatternEdge::new(
                                    format!("L{li}:{}-{}", i.min(j), i.max(j)),
                                    pts,
                                ));
                                panel.inner.len() - 1
                            }
                        };
                        Ok(vec![EdgeRef {
                            panel: pi,
                            edge: panel.inner_index(k),
                            backward: i > j,
                        }])
                    }
                    _ => Err(bad()),
                }
            };
            let mut chain = |runs: &Runs| -> Result<Vec<EdgeRef>, String> {
                let mut out = Vec::new();
                for r in runs.list() {
                    let back = r.starts_with('!');
                    let mut edges = run(r.trim_start_matches('!'))?;
                    if back {
                        edges.reverse();
                        for e in &mut edges {
                            e.backward = !e.backward;
                        }
                    }
                    out.extend(edges);
                }
                Ok(out)
            };
            let a = chain(&ss.a)?;
            let b = chain(&ss.b)?;
            seams.push(Seam {
                name: ss.name.clone(),
                a,
                b,
                reversed: ss.reverse,
                by_length: ss.by_length,
            });
        }
        // Inner edges were appended after the boundary edges were numbered; EdgeRefs into inner
        // lines used `inner_index` at the time, which doesn't change as more are pushed.
        Ok(GarmentPattern {
            pattern: Pattern { panels, seams },
            labels,
        })
    }

    /// Edge length for about `verts` vertices: an equilateral lattice of edge h has
    /// 2 / (sqrt(3) h²) vertices per unit area.
    pub fn edge_for_vertices(&self, verts: u32) -> Result<f32, String> {
        let area = self.pattern()?.pattern.area();
        Ok((2.0 * area / (3f32.sqrt() * verts as f32)).sqrt())
    }

    /// Where each panel starts: wrapped around the test avatar's regions (`placement`).
    fn place_specs(&self) -> Result<Vec<PlaceSpec>, String> {
        let regions = &default_avatar().regions;
        self.spec
            .piece
            .iter()
            .map(|ps| {
                Ok(match &ps.place.like {
                    Some(other) => PlaceSpec::Follow {
                        of: self
                            .spec
                            .piece
                            .iter()
                            .position(|p| &p.name == other)
                            .ok_or_else(|| format!("{}: like = {other}: no such piece", ps.name))?,
                        angle: ps.place.angle.map(f32::to_radians),
                        lift: ps.place.lift,
                    },
                    None => {
                        let need = |v: Option<f32>, what: &str| {
                            v.ok_or_else(|| format!("{}: place.{what} missing", ps.name))
                        };
                        let frame = ps
                            .place
                            .frame
                            .as_deref()
                            .ok_or_else(|| format!("{}: place.frame missing", ps.name))?;
                        PlaceSpec::Wrap {
                            frame: region_frame(regions, sidecar_region(frame)?)?,
                            angle: ps.place.angle.unwrap_or(0.0).to_radians(),
                            radius: need(ps.place.radius, "radius")? + ps.place.lift,
                            top: need(ps.place.top, "top")?,
                            tube: ps.place.tube,
                        }
                    }
                })
            })
            .collect()
    }

    pub fn sdf_params(&self) -> SdfParams {
        self.spec.sdf.clone().unwrap_or_default()
    }

    /// The fabric from the sidecar, or the default cotton jersey.
    pub fn fabric(&self) -> Material {
        self.spec
            .material
            .map(|m| Material {
                density: m.density,
                stretch_k: m.stretch_k,
                bend_kb: m.bend_kb,
            })
            .unwrap_or_else(Material::cotton)
    }

    /// Meshes and places the pieces (`edge`: target triangle edge length, m).
    pub fn build(&self, edge: f32) -> Result<GarmentDesc, String> {
        let gp = self.pattern()?;
        let pat = &gp.pattern;
        let mut mp = mesh_pattern(pat, edge);
        place(&mut mp, pat, &self.place_specs()?)?;
        let material = self.fabric();
        let camera = self
            .spec
            .camera
            .map(|c| (Vec3::new(c[0], c[1], c[2]), c[3]))
            .unwrap_or(DEFAULT_CAMERA);
        let description = serde_json::json!({ "garment": self.spec.name, "edge": edge, "dxf": self.spec.dxf, "import": self.report,
            "pieces": self.spec.piece, "material": { "density": material.density, "stretch_k": material.stretch_k, "bend_kb": material.bend_kb } });
        Ok(garment_desc(
            &self.spec.name,
            description,
            pat,
            mp,
            Some(self.spec.schedule.unwrap_or_else(tshirt_schedule)),
            self.sdf_params(),
            camera,
        ))
    }
}

/// The viewer camera when a garment doesn't give one: target and distance, m.
pub const DEFAULT_CAMERA: (Vec3, f32) = (Vec3::new(0.0, 1.12, 0.03), 1.5);

/// The engine's description of a meshed, placed garment, after logging the initial seam gaps:
/// a seam sewn the wrong way round shows up as the opposite pairing being much shorter.
/// `description` gets the per-seam numbers added under "seams".
pub(crate) fn garment_desc(
    name: &str,
    mut description: serde_json::Value,
    pat: &Pattern,
    mp: MeshedPattern,
    schedule: Option<Schedule>,
    sdf: SdfParams,
    camera: (Vec3, f32),
) -> GarmentDesc {
    let pos = &mp.mesh.pos;
    let gap = |pairs: &[(u32, u32)]| {
        pairs
            .iter()
            .map(|&(i, j)| (pos[i as usize] - pos[j as usize]).length())
            .sum::<f32>()
            / pairs.len().max(1) as f32
    };
    let mut seam_info = Vec::new();
    for (s, (_, pairs)) in pat.seams.iter().zip(&mp.seam_pairs) {
        let mean = gap(pairs);
        // The other direction: pair a[k] with the b vertex at the mirrored index.
        let bs: Vec<u32> = pairs.iter().map(|p| p.1).collect();
        let flipped: Vec<(u32, u32)> = pairs
            .iter()
            .zip(bs.iter().rev())
            .map(|(p, &b)| (p.0, b))
            .collect();
        let other = gap(&flipped);
        if other < 0.5 * mean {
            log::warn!(
                "seam {}: mean initial gap {:.0} mm, but {:.0} mm with side b reversed: check the seam's direction",
                s.name,
                mean * 1e3,
                other * 1e3
            );
        }
        seam_info.push(serde_json::json!({ "seam": s.name, "pairs": pairs.len(), "initial_gap_mean_mm": mean * 1e3, "flipped_gap_mean_mm": other * 1e3,
            "length_a_m": pat.chain_length(&s.a), "length_b_m": pat.chain_length(&s.b) }));
    }
    let gaps: Vec<f32> = mp
        .sew_pairs
        .iter()
        .map(|&(i, j)| (pos[i as usize] - pos[j as usize]).length())
        .collect();
    log::info!(
        "{name}: {} verts, {} tris, {} panels, {} seams, {} sew pairs (initial gap max {:.0} mm, mean {:.0} mm)",
        mp.mesh.n_verts(),
        mp.mesh.tris.len(),
        pat.panels.len(),
        pat.seams.len(),
        mp.sew_pairs.len(),
        gaps.iter().cloned().fold(0.0, f32::max) * 1000.0,
        gaps.iter().sum::<f32>() / gaps.len().max(1) as f32 * 1000.0,
    );
    description["seams"] = seam_info.into();
    let groups = pat
        .panels
        .iter()
        .zip(&mp.panel_vertices)
        .map(|(p, r)| (p.name.clone(), r.clone()))
        .collect();
    GarmentDesc {
        name: name.to_string(),
        description,
        mesh: mp.mesh,
        sew_pairs: mp.sew_pairs,
        seams: mp.seam_pairs,
        groups,
        schedule,
        sdf,
        camera,
    }
}
