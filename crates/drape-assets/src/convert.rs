// SPDX-License-Identifier: AGPL-3.0-or-later
//! garment.toml + DXF-AAMA -> a Vitryne project (FORMAT.md, From garment.toml).
//!
//! Each DXF piece the sidecar uses becomes a piece: its landmarks become outline nodes (turn
//! points `corner`, notches `notch`, fold and internal-line ends `point`), the fractional
//! landmarks seams use (`3+0.5`) become `point` nodes, the internal lines' landmarks their
//! nodes. Each `[[piece]]` becomes a cut, each `[[seam]]` a seam with "starts meet" sides. Node
//! names come from the sidecar's `[names]`. Ids are version-7 UUIDs from a fixed time and the
//! garment's name, so converting again gives the same file.

use std::collections::BTreeMap;

use glam::Vec2;
use serde_json::Map;

use drape_core::{body::SdfParams, constraints::Material};
use vitryne_format::{
    Attribution, Bending, Bounds, Camera, Category, Cut, Direction, Document, Edge, Fabric, File,
    Fold, Follow, Garment, GarmentSimulation, Grain, Id, IdGen, Kind, Line, Node, NodeType,
    Pairing, Piece, PieceSource, Placement, Project, ProjectSimulation, Run, Seam, Source, Stretch,
    View, Wrap,
    manifest::{MEDIA_GLB, ROLE_SOURCE},
    round_mm,
};

use crate::{
    aama::{self, LandmarkKind},
    garment::{Garment as DxfGarment, Names},
    placement::{default_avatar, sidecar_region},
    project::DEFAULT_TARGET_VERTICES,
};

/// 2026-10-13T00:00:00Z: the timestamp converted files' ids start from.
const ID_TIME_MS: u64 = 1_792_022_400_000;

pub struct ConvertOptions {
    /// The avatar's mesh as glTF binary (the test avatar's, converted from its OBJ).
    pub body_glb: Vec<u8>,
    /// The DXF's file name, recorded in `sources`.
    pub dxf_file_name: String,
    /// Keep the DXF in the file as a `source` part (off for files to share).
    pub include_dxf: Option<Vec<u8>>,
}

/// A length in metres (f32, from the importer) to mm, rounded as the file stores it.
fn mm(x: f32) -> f64 {
    round_mm(x as f64 * 1000.0)
}

fn mm2(p: Vec2) -> [f64; 2] {
    [mm(p.x), mm(p.y)]
}

/// An f32 setting as the f64 it was written as (1.15, not 1.149999976158142).
fn exact(x: f32) -> f64 {
    x.to_string().parse().expect("f32 prints as a number")
}

fn radians(deg: f32) -> f64 {
    exact(deg).to_radians()
}

/// A landmark token as seams write it: "3" or "3+0.5" (normalised to how f32 prints).
fn token_key(tok: &str) -> Result<String, String> {
    let tok = tok.trim();
    match tok.split_once('+') {
        None => tok
            .parse::<usize>()
            .map(|k| k.to_string())
            .map_err(|_| format!("bad landmark {tok:?}")),
        Some((k, f)) => {
            let k: usize = k
                .trim()
                .parse()
                .map_err(|_| format!("bad landmark {tok:?}"))?;
            let f: f32 = f
                .trim()
                .parse()
                .map_err(|_| format!("bad landmark {tok:?}"))?;
            if !(f > 0.0 && f < 1.0) {
                return Err(format!("landmark {tok:?}: the fraction must be in (0, 1)"));
            }
            Ok(format!("{k}+{f}"))
        }
    }
}

/// Per sidecar instance: its cut id, its outline node ids by landmark token, and its internal
/// lines' node ids by line and landmark.
type Instance = (Id, BTreeMap<String, Id>, Vec<Vec<Id>>);

/// A seam run as the sidecar writes it.
struct RunRef {
    back: bool,
    instance: String,
    line: Option<usize>,
    from: String,
    to: String,
}

fn parse_run(r: &str) -> Result<RunRef, String> {
    let back = r.starts_with('!');
    let parts: Vec<&str> = r.trim_start_matches('!').split(':').collect();
    let bad = || format!("bad reference {r:?} (want piece:i-j or piece:L0:i-j)");
    let (instance, line, range) = match parts.as_slice() {
        [p, range] => (*p, None, *range),
        [p, l, range] => (
            *p,
            Some(
                l.strip_prefix('L')
                    .and_then(|x| x.parse().ok())
                    .ok_or_else(bad)?,
            ),
            *range,
        ),
        _ => return Err(bad()),
    };
    // "3+0.5-5": split at the '-' that isn't inside a fraction.
    let dash = range
        .char_indices()
        .filter(|&(i, ch)| ch == '-' && i > 0)
        .map(|(i, _)| i)
        .next()
        .ok_or_else(bad)?;
    Ok(RunRef {
        back,
        instance: instance.to_string(),
        line,
        from: token_key(&range[..dash])?,
        to: token_key(&range[dash + 1..])?,
    })
}

/// The nodes of one DXF piece's outline: landmarks plus the fractional points seams use.
struct Outline {
    nodes: Vec<Node>,
    /// Node id by landmark token ("3", "3+0.5").
    by_token: BTreeMap<String, Id>,
}

fn outline(
    p: &aama::Piece,
    fracs: &[String],
    names: &BTreeMap<String, Names>,
    ids: &mut IdGen,
) -> Result<Outline, String> {
    let b = &p.boundary;
    let n = b.len();
    let list = |key: &str| match names.get(key) {
        Some(Names::List(v)) => Some(v.clone()),
        _ => None,
    };
    let landmark_names = list(&p.name);
    if let Some(v) = &landmark_names
        && v.len() != p.landmarks.len()
    {
        return Err(format!(
            "[names] {}: {} names for {} landmarks",
            p.name,
            v.len(),
            p.landmarks.len()
        ));
    }
    // (position along the boundary as a fractional vertex index, point, type, token, name)
    let mut marks: Vec<(f64, Vec2, NodeType, String, Option<String>)> = p
        .landmarks
        .iter()
        .enumerate()
        .map(|(k, l)| {
            let kind = match l.kind {
                LandmarkKind::Turn => NodeType::Corner,
                LandmarkKind::Notch => NodeType::Notch,
                LandmarkKind::FoldEnd | LandmarkKind::LineEnd => NodeType::Point,
            };
            let name = landmark_names.as_ref().map(|v| v[k].clone());
            (l.at as f64, b[l.at], kind, k.to_string(), name)
        })
        .collect();
    for tok in fracs {
        let (k, f) = tok.split_once('+').unwrap();
        let (k, f): (usize, f32) = (k.parse().unwrap(), f.parse().unwrap());
        if k >= p.landmarks.len() {
            return Err(format!("{}: landmark {tok} out of range", p.name));
        }
        // As the garment.toml path does it (garment::Garment::instance): by length along the
        // boundary from landmark k to k + 1.
        let (from, to) = (
            p.landmarks[k].at,
            p.landmarks[(k + 1) % p.landmarks.len()].at,
        );
        let mut run = vec![from];
        let mut i = (from + 1) % n;
        while i != to {
            run.push(i);
            i = (i + 1) % n;
        }
        run.push(to);
        let total: f32 = run.windows(2).map(|w| b[w[0]].distance(b[w[1]])).sum();
        let (mut acc, target) = (0.0, f * total);
        for w in run.windows(2) {
            let l = b[w[0]].distance(b[w[1]]);
            if acc + l >= target {
                let u = ((target - acc) / l.max(1e-12)).clamp(0.0, 1.0);
                let q = aama::on_grid(b[w[0]].lerp(b[w[1]], u).as_dvec2());
                let at = if q == b[w[0]] {
                    w[0] as f64
                } else if q == b[w[1]] {
                    w[1] as f64
                } else {
                    w[0] as f64 + u as f64
                };
                let name = match names.get(&format!("{}:{tok}", p.name)) {
                    Some(Names::One(s)) => Some(s.clone()),
                    _ => None,
                };
                marks.push((at, q, NodeType::Point, tok.clone(), name));
                break;
            }
            acc += l;
        }
    }
    marks.sort_by(|a, b| a.0.total_cmp(&b.0));
    marks.dedup_by(|later, first| later.0 == first.0);
    let mut by_token = BTreeMap::new();
    let mut nodes = Vec::new();
    for (j, (at, q, kind, tok, name)) in marks.iter().enumerate() {
        let next_at = marks[(j + 1) % marks.len()].0;
        // The boundary vertices strictly between this node and the next.
        let start = (at.floor() as usize + 1) % n;
        let end = (next_at.ceil() as usize) % n;
        let count = (end + n - start) % n;
        let points = (0..count).map(|s| mm2(b[(start + s) % n])).collect();
        let id = ids.next_id();
        by_token.insert(tok.clone(), id.clone());
        nodes.push(Node {
            id,
            kind: *kind,
            name: name.clone(),
            position: mm2(*q),
            edge: Some(Edge::polyline(points)),
            other: Map::new(),
        });
    }
    Ok(Outline { nodes, by_token })
}

/// Converts a sidecar garment (its DXF already imported) into a project file.
pub fn convert(g: &DxfGarment, opts: &ConvertOptions) -> Result<Document, String> {
    let spec = &g.spec;
    let mut ids = IdGen::new(ID_TIME_MS, spec.name.as_bytes());
    let (project_id, garment_id, fabric_id, source_id) =
        (ids.next_id(), ids.next_id(), ids.next_id(), ids.next_id());

    // Fractional landmarks used by seams, by instance.
    let mut fracs: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut runs: Vec<(usize, char, RunRef)> = Vec::new();
    for (si, ss) in spec.seam.iter().enumerate() {
        for (side, list) in [('a', &ss.a), ('b', &ss.b)] {
            for r in list.list() {
                let rr = parse_run(r).map_err(|e| format!("seam {}: {e}", ss.name))?;
                runs.push((si, side, rr));
            }
        }
    }
    for (_, _, r) in &runs {
        let ps = spec
            .piece
            .iter()
            .find(|p| p.name == r.instance)
            .ok_or_else(|| format!("seams refer to unknown piece {}", r.instance))?;
        if r.line.is_none() {
            for t in [&r.from, &r.to] {
                if t.contains('+') {
                    fracs.entry(ps.dxf.as_str()).or_default().push(t.clone());
                }
            }
        }
    }
    for v in fracs.values_mut() {
        v.sort();
        v.dedup();
    }

    // Pieces, in order of first use; each [[piece]] entry is a cut of its DXF piece.
    let mut dxf_order: Vec<&str> = Vec::new();
    for ps in &spec.piece {
        if !dxf_order.contains(&ps.dxf.as_str()) {
            dxf_order.push(&ps.dxf);
        }
    }
    let mut pieces = Vec::new();
    let mut inst: BTreeMap<&str, Instance> = BTreeMap::new();
    let mut cut_ids: BTreeMap<&str, Id> = BTreeMap::new();
    for ps in &spec.piece {
        cut_ids.insert(&ps.name, ids.next_id());
    }
    for dxf_name in dxf_order {
        let p = g
            .pieces
            .iter()
            .find(|p| p.name == dxf_name)
            .ok_or_else(|| {
                format!(
                    "no piece {dxf_name} in the DXF (have: {})",
                    g.report.pieces.join(", ")
                )
            })?;
        let ol = outline(
            p,
            fracs.get(dxf_name).map_or(&[][..], Vec::as_slice),
            &spec.names,
            &mut ids,
        )?;
        let mut lines = Vec::new();
        let mut line_nodes = Vec::new();
        for (li, l) in p.inner.iter().enumerate() {
            let key = format!("{dxf_name}:L{li}");
            let names = match spec.names.get(&key) {
                Some(Names::List(v)) if v.len() == l.landmarks.len() => Some(v.clone()),
                Some(_) => {
                    return Err(format!(
                        "[names] {key}: want a list of {} names",
                        l.landmarks.len()
                    ));
                }
                None => None,
            };
            let mut nodes = Vec::new();
            for (k, &v) in l.landmarks.iter().enumerate() {
                let edge = l.landmarks.get(k + 1).map(|&next| {
                    Edge::polyline(l.pts[v + 1..next].iter().map(|&q| mm2(q)).collect())
                });
                nodes.push(Node {
                    id: ids.next_id(),
                    kind: NodeType::Point,
                    name: names.as_ref().map(|n| n[k].clone()),
                    position: mm2(l.pts[v]),
                    edge,
                    other: Map::new(),
                });
            }
            line_nodes.push(nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>());
            lines.push(Line {
                id: ids.next_id(),
                name: Some(format!("line {li}")),
                nodes,
                other: Map::new(),
            });
        }
        let folds = if p.unfolded {
            let ends: Vec<&Id> = p
                .landmarks
                .iter()
                .enumerate()
                .filter(|(_, l)| l.kind == LandmarkKind::FoldEnd)
                .map(|(k, _)| &ol.by_token[&k.to_string()])
                .collect();
            match ends.as_slice() {
                [a, b] => vec![Fold {
                    id: ids.next_id(),
                    from: (*a).clone(),
                    to: (*b).clone(),
                    other: Map::new(),
                }],
                _ => return Err(format!("{dxf_name}: unfolded, but not two fold ends")),
            }
        } else {
            Vec::new()
        };
        let mut cuts = Vec::new();
        for ps in spec.piece.iter().filter(|ps| ps.dxf == dxf_name) {
            let placement = match &ps.place.like {
                Some(other) => {
                    if ps.rotate != 0.0 {
                        return Err(format!(
                            "{}: rotate on a piece placed like another can't be expressed",
                            ps.name
                        ));
                    }
                    Placement::Follow(Follow {
                        cut: cut_ids
                            .get(other.as_str())
                            .ok_or_else(|| format!("{}: like = {other}: no such piece", ps.name))?
                            .clone(),
                        lift: mm(ps.place.lift),
                        angle: ps.place.angle.map(radians),
                        other: Map::new(),
                    })
                }
                None => {
                    let need = |v: Option<f32>, what: &str| {
                        v.ok_or_else(|| format!("{}: place.{what} missing", ps.name))
                    };
                    let frame = ps
                        .place
                        .frame
                        .as_deref()
                        .ok_or_else(|| format!("{}: place.frame missing", ps.name))?;
                    Placement::Wrap(Wrap {
                        region: sidecar_region(frame)?.to_string(),
                        angle: radians(ps.place.angle.unwrap_or(0.0)),
                        radius: mm(need(ps.place.radius, "radius")? + ps.place.lift),
                        top: mm(need(ps.place.top, "top")?),
                        rotation: (ps.rotate != 0.0).then(|| radians(ps.rotate)),
                        tube: ps.place.tube.map(exact),
                        other: Map::new(),
                    })
                }
            };
            let id = cut_ids[ps.name.as_str()].clone();
            inst.insert(
                &ps.name,
                (id.clone(), ol.by_token.clone(), line_nodes.clone()),
            );
            cuts.push(Cut {
                id,
                name: Some(ps.label.clone().unwrap_or_else(|| ps.name.clone())),
                mirrored: ps.mirror,
                fabric: None,
                placement,
                layout: None,
                other: Map::new(),
            });
        }
        pieces.push(Piece {
            id: ids.next_id(),
            name: dxf_name.to_string(),
            source: Some(PieceSource {
                source: source_id.clone(),
                piece: dxf_name.to_string(),
                other: Map::new(),
            }),
            outline: ol.nodes,
            lines,
            folds,
            grain: p.grain.map(|(a, b)| Grain {
                from: mm2(a),
                to: mm2(b),
                other: Map::new(),
            }),
            cuts,
            other: Map::new(),
        });
    }

    // Seams: side b of a `reverse` seam is written the other way, so starts meet.
    let mut seams = Vec::new();
    for (si, ss) in spec.seam.iter().enumerate() {
        let side = |which: char| -> Result<Vec<Run>, String> {
            runs.iter()
                .filter(|(s, w, _)| *s == si && *w == which)
                .map(|(_, _, r)| {
                    let (cut, outline, lines) = &inst[r.instance.as_str()];
                    let node = |tok: &str| -> Result<Id, String> {
                        match r.line {
                            None => outline.get(tok).cloned(),
                            Some(l) => lines
                                .get(l)
                                .and_then(|ids| tok.parse::<usize>().ok().and_then(|k| ids.get(k)))
                                .cloned(),
                        }
                        .ok_or_else(|| {
                            format!("seam {}: {}: no landmark {tok}", ss.name, r.instance)
                        })
                    };
                    let (from, to) = (node(&r.from)?, node(&r.to)?);
                    let (from, to) = if r.back { (to, from) } else { (from, to) };
                    Ok(Run {
                        cut: cut.clone(),
                        line: r.line.map(|l| {
                            let piece = pieces
                                .iter()
                                .find(|p| p.cuts.iter().any(|c| &c.id == cut))
                                .unwrap();
                            piece.lines[l].id.clone()
                        }),
                        from,
                        to,
                        direction: r.line.is_none().then_some(if r.back {
                            Direction::Cw
                        } else {
                            Direction::Ccw
                        }),
                        other: Map::new(),
                    })
                })
                .collect()
        };
        let a = side('a')?;
        let mut b = side('b')?;
        if ss.reverse {
            b.reverse();
            for r in &mut b {
                std::mem::swap(&mut r.from, &mut r.to);
                r.direction = r.direction.map(|d| match d {
                    Direction::Ccw => Direction::Cw,
                    Direction::Cw => Direction::Ccw,
                });
            }
        }
        seams.push(Seam {
            id: ids.next_id(),
            name: Some(ss.label.clone().unwrap_or_else(|| ss.name.clone())),
            a,
            b,
            pairing: ss.by_length.then_some(Pairing::Length),
            other: Map::new(),
        });
    }
    // Simulation: the SDF box as collision bounds (always written, so the drape doesn't
    // change), its resolution and the ramp only when they differ from the engine's defaults.
    let sdf = g.sdf_params();
    let d = SdfParams::default();
    let mut engine = Map::new();
    if sdf.cell != d.cell {
        engine.insert("sdf_cell".into(), exact(sdf.cell).into());
    }
    if sdf.band != d.band {
        engine.insert("sdf_band".into(), exact(sdf.band).into());
    }
    if let Some(s) = &spec.schedule {
        engine.insert("schedule".into(), serde_json::to_value(s).unwrap());
    }
    let simulation = GarmentSimulation {
        target_vertices: None,
        engine: (!engine.is_empty()).then_some(engine),
        collision_bounds: Some(Bounds {
            min: sdf.min.map(mm),
            max: sdf.max.map(mm),
            other: Map::new(),
        }),
        other: Map::new(),
    };

    let material = spec
        .material
        .map(|m| Material {
            density: m.density,
            stretch_k: m.stretch_k,
            bend_kb: m.bend_kb,
        })
        .unwrap_or_else(Material::cotton);
    let y = 2.0 / 3f64.sqrt() * exact(material.stretch_k);
    let meta = spec.fabric.clone();
    let fabric = Fabric {
        id: fabric_id.clone(),
        name: meta.as_ref().map_or_else(
            || format!("{} fabric (placeholder)", spec.name),
            |f| f.name.clone(),
        ),
        category: match meta.as_ref().map(|f| f.category.as_str()) {
            Some("woven") => Category::Woven,
            Some("nonwoven") => Category::Nonwoven,
            Some("knit") | None => Category::Knit,
            Some(other) => {
                return Err(format!(
                    "[fabric] category {other:?}: woven | knit | nonwoven"
                ));
            }
        },
        density: exact(material.density),
        thickness: None,
        stretch: Stretch {
            warp: y,
            weft: y,
            shear: 3.0 / 8.0 * y,
            other: Map::new(),
        },
        bending: Bending {
            warp: exact(material.bend_kb),
            weft: exact(material.bend_kb),
            bias: None,
            other: Map::new(),
        },
        friction: exact(drape_core::sim::SimSettings::default().friction),
        notes: meta.and_then(|f| f.notes),
        attribution: None,
        library_ref: None,
        other: Map::new(),
    };

    let mut doc = Document::new(Kind::Project);
    let avatar = default_avatar().clone();
    let garment = Garment {
        id: garment_id.clone(),
        name: spec.title.clone().unwrap_or_else(|| spec.name.clone()),
        attribution: spec.attribution.as_ref().map(|a| Attribution {
            title: a.title.clone(),
            creator: a.creator.clone(),
            license: a.license.clone(),
            source: a.source.clone(),
            notes: a.notes.clone(),
            other: Map::new(),
        }),
        library_ref: None,
        fabric: fabric_id.clone(),
        simulation: Some(simulation),
        sources: vec![Source {
            id: source_id.clone(),
            kind: "dxf-aama".into(),
            file_name: Some(opts.dxf_file_name.clone()),
            part: opts
                .include_dxf
                .as_ref()
                .map(|_| format!("sources/{source_id}.dxf")),
            other: Map::new(),
        }],
        pieces,
        seams,
        other: Map::new(),
    };
    if let Some(dxf) = &opts.include_dxf {
        doc.files.insert(
            format!("sources/{source_id}.dxf"),
            File {
                media_type: "image/vnd.dxf".into(),
                role: Some(ROLE_SOURCE.into()),
                bytes: dxf.clone(),
            },
        );
    }
    doc.files.insert(
        avatar.mesh.clone(),
        File {
            media_type: MEDIA_GLB.into(),
            role: None,
            bytes: opts.body_glb.clone(),
        },
    );
    doc.project = Some(Project {
        id: project_id,
        name: Some(garment.name.clone()),
        description: None,
        garments: vec![garment_id],
        avatar: avatar.id.clone(),
        fabrics: vec![fabric_id],
        simulation: Some(ProjectSimulation {
            target_vertices: Some(DEFAULT_TARGET_VERTICES),
            engine: None,
            other: Map::new(),
        }),
        other: Map::new(),
    });
    let (target, distance) = spec
        .camera
        .map(|c| ([c[0], c[1], c[2]], c[3]))
        .unwrap_or(([0.0, 1.12, 0.03], 1.5));
    doc.view = Some(View {
        camera: Some(Camera {
            target: target.map(mm),
            distance: mm(distance),
            yaw: None,
            pitch: None,
            other: Map::new(),
        }),
        other: Map::new(),
    });
    doc.garments.push(garment);
    doc.fabrics.push(fabric);
    doc.avatars.push(avatar);
    let report = doc.validate();
    if !report.errors.is_empty() {
        return Err(report.errors.join("; "));
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_parse() {
        let r = parse_run("!sleeve_r:3+0.5-5").unwrap();
        assert!(r.back);
        assert_eq!(
            (r.instance.as_str(), r.from.as_str(), r.to.as_str()),
            ("sleeve_r", "3+0.5", "5")
        );
        let r = parse_run("front:L0:2-3").unwrap();
        assert_eq!(
            (r.line, r.from.as_str(), r.to.as_str()),
            (Some(0), "2", "3")
        );
        assert!(parse_run("front:3").is_err());
        assert!(parse_run("front:3-x").is_err());
    }
}
