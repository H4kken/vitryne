// SPDX-License-Identifier: AGPL-3.0-or-later
//! Patterns into the editor (packages/vitryne-docs/content/docs/developers/architecture.mdx, Import and placement): DXF-AAMA, or a
//! Valentina pattern with its measurements (`valentina`). Reading one gives a preview: what was
//! found, what was ignored, and for each piece how often it is cut and a suggested place on the
//! body. The user confirms or changes a choice per piece, and the import
//! makes the pieces and cuts, each cut wrapped around its place (`placement::auto_wrap`), as a
//! new project or as an addition to the open one.
//!
//! A `garment.toml` sidecar may come with the DXF: then its pieces, cuts, names and seams are
//! used (as `vitryne convert` does), and only its placements are replaced by the user's choices.
//! Without one (and for Valentina patterns, which carry no sewing) the garment has no seams
//! yet; the editor's suggestions sew it.
//!
//! Suggestions come from the piece names only ("sleeve", "front", ...), never from anything
//! learned, and the user sees and changes every one (packages/vitryne-docs/content/docs/developers/patents.md, rule 4).

use std::collections::{BTreeMap, BTreeSet};

use glam::{Vec2, Vec3};
use serde::{Deserialize, Serialize};
use serde_json::Map;

use vitryne_format::{
    Bounds, Cut, CutState, Document, Follow, Garment, GarmentSimulation, Id, IdGen, Piece,
    Placement, Region, Seam, Source, Wrap,
};
use vitryne_solver::constraints::Material;

use crate::{
    aama::{self, ImportReport},
    convert::{ConvertOptions, convert_with, dxf_piece, fabric_entity, project_document},
    drafting::{self, SizeOption, pieces::Shape},
    garment::Garment as SidecarGarment,
    placement::{BodyFacts, BodyPlace, Landmark, auto_wrap, default_avatar, flat_wrap},
};

/// How far a piece placed on another one sits off it, mm (the hoodie's pocket).
pub const ON_TOP_LIFT_MM: f64 = 12.0;

/// A pair of cuts, the first on the wearer's right, the second (the mirror image, unless a
/// sidecar says otherwise) on the left.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pair {
    Arms,
    LegsFront,
    LegsBack,
    HeadSides,
    BodySides,
}

impl Pair {
    pub fn places(self) -> [BodyPlace; 2] {
        use BodyPlace::*;
        match self {
            Pair::Arms => [ArmRight, ArmLeft],
            Pair::LegsFront => [LegRightFront, LegLeftFront],
            Pair::LegsBack => [LegRightBack, LegLeftBack],
            Pair::HeadSides => [HeadRight, HeadLeft],
            Pair::BodySides => [BodyRight, BodyLeft],
        }
    }
}

/// What to do with one DXF piece.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Choice {
    /// Not imported.
    Leave,
    /// One cut, at `place`.
    One { place: BodyPlace },
    /// Two cuts, at the pair's two places.
    Pair { pair: Pair },
    /// One cut as it is: a flat sheet in front of the chest, for when no place fits.
    Flat,
    /// One cut on top of the first cut of `piece` (a pocket on a front).
    On { piece: String },
    /// Imported but not placed yet: every cut is kept, flat in front of the chest as a
    /// placeholder, and waits (`CutState::Unplaced`) for the person to put it on the body.
    Unplaced,
}

impl Choice {
    fn cuts(&self) -> usize {
        match self {
            Choice::Leave => 0,
            Choice::Pair { .. } => 2,
            _ => 1,
        }
    }
}

/// A pattern file to import, as the editor sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ImportSource {
    /// DXF-AAMA, and a garment.toml written for it.
    Dxf {
        name: String,
        text: String,
        #[serde(default)]
        sidecar: Option<String>,
    },
    /// A Valentina or Seamly2D pattern, its measurements file, and a size of its size chart.
    #[serde(alias = "valentina")]
    Drafted {
        name: String,
        text: String,
        #[serde(default)]
        measurements: Option<String>,
        #[serde(default)]
        size: Option<Vec<f64>>,
    },
}

impl ImportSource {
    pub fn read(&self) -> Result<PatternImport, String> {
        match self {
            ImportSource::Dxf {
                name,
                text,
                sidecar,
            } => PatternImport::read(name, text, sidecar.as_deref()),
            ImportSource::Drafted {
                name,
                text,
                measurements,
                size,
            } => PatternImport::read_drafted(name, text, measurements.as_deref(), size.as_deref()),
        }
    }
}

/// Where an import's pieces come from.
enum Origin {
    /// DXF-AAMA, with its sidecar if one came with it.
    Dxf {
        pieces: Vec<aama::Piece>,
        sidecar: Option<Box<SidecarGarment>>,
    },
    /// A Valentina or Seamly2D pattern, drafted with its measurements.
    Drafted(Vec<Shape>),
}

/// A pattern read for import.
pub struct PatternImport {
    file_name: String,
    report: ImportReport,
    origin: Origin,
    sizes: Vec<SizeOption>,
}

/// One piece the import offers.
struct Offer<'a> {
    name: &'a str,
    quantity: u32,
    /// The sidecar's cuts of it, if it has a sidecar.
    cuts: Option<usize>,
    from: PieceRef<'a>,
}

enum PieceRef<'a> {
    Dxf(&'a aama::Piece),
    Shape(&'a Shape),
}

fn dxf_offer(p: &aama::Piece, cuts: Option<usize>) -> Offer<'_> {
    Offer {
        name: &p.name,
        quantity: p.quantity,
        cuts,
        from: PieceRef::Dxf(p),
    }
}

impl Offer<'_> {
    /// The outline (mm, unfolded), for a thumbnail.
    fn outline(&self) -> Vec<[f64; 2]> {
        match self.from {
            PieceRef::Dxf(p) => p
                .boundary
                .iter()
                .map(|q| [whole_mm(q.x), whole_mm(q.y)])
                .collect(),
            PieceRef::Shape(s) => s.thumbnail(),
        }
    }
}

/// What the import dialog shows.
#[derive(Debug, Serialize)]
pub struct Preview {
    pub file_name: String,
    pub report: ImportReport,
    /// A size chart's dimensions (Valentina's multisize measurements), else empty.
    pub sizes: Vec<SizeOption>,
    /// With a sidecar: its title and how many seams it sews.
    pub sewing: Option<SewingInfo>,
    pub pieces: Vec<PiecePreview>,
    /// DXF pieces the sidecar doesn't use (not imported).
    pub unused: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SewingInfo {
    pub title: String,
    pub seams: usize,
}

#[derive(Debug, Serialize)]
pub struct PiecePreview {
    pub name: String,
    /// "Quantity:" in the DXF.
    pub quantity: u32,
    /// The sidecar's cuts of this piece (then the choice must have as many); None: the choice
    /// decides.
    pub cuts: Option<usize>,
    /// The outline (mm, unfolded), for a thumbnail.
    pub outline: Vec<[f64; 2]>,
    pub suggestion: Option<Choice>,
}

/// The garment's parts an import makes (see `PatternImport::parts`).
struct Parts {
    pieces: Vec<Piece>,
    seams: Vec<Seam>,
    source: Source,
    notes: Vec<String>,
}

/// What an import into an open project adds to its garment.
#[derive(Debug, Serialize)]
pub struct Addition {
    pub pieces: Vec<Piece>,
    pub seams: Vec<Seam>,
    pub source: Source,
    /// The collision box the new pieces need (the garment's should cover it).
    pub bounds: Bounds,
    pub notes: Vec<String>,
}

fn whole_mm(x: f32) -> f64 {
    (x as f64 * 1000.0).round() + 0.0
}

/// The collision box for an imported garment, mm: the body's box with room behind the back
/// (where a back piece starts) and above the head, from the floor, rounded out to cm. For the
/// test avatar it is the hoodie's box down to the floor.
pub fn import_bounds(body: &[Vec3]) -> Bounds {
    let (lo, hi) = body.iter().fold(
        (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)),
        |(lo, hi), p| (lo.min(*p), hi.max(*p)),
    );
    let lo = Vec3::new(lo.x - 0.05, 0.0, lo.z - 0.15);
    let hi = hi + Vec3::new(0.05, 0.05, 0.03);
    let cm = |x: f32, up: bool| {
        let c = x * 100.0;
        whole_mm(if up { c.ceil() } else { c.floor() } / 100.0)
    };
    Bounds {
        min: [cm(lo.x, false), cm(lo.y, false), cm(lo.z, false)],
        max: [cm(hi.x, true), cm(hi.y, true), cm(hi.z, true)],
        other: Map::new(),
    }
}

/// The suggested choice for a piece, from its name and how many cuts it gets (`cuts`: the
/// sidecar's, else the DXF quantity), or none.
pub fn suggest(name: &str, cuts: usize, all: &[&str]) -> Option<Choice> {
    let n = name.to_lowercase();
    let has = |w: &str| n.contains(w);
    let pair = cuts >= 2;
    if has("hood") {
        return if has("side") {
            Some(if pair {
                Choice::Pair {
                    pair: Pair::HeadSides,
                }
            } else {
                Choice::One {
                    place: BodyPlace::HeadRight,
                }
            })
        } else if has("cent") || has("mid") {
            Some(Choice::One {
                place: BodyPlace::OverHead,
            })
        } else {
            None
        };
    }
    if has("sleeve") {
        return Some(if pair {
            Choice::Pair { pair: Pair::Arms }
        } else {
            Choice::One {
                place: BodyPlace::ArmRight,
            }
        });
    }
    // Facings, bindings, cuffs and waistbands share words with the pieces below, but aren't them.
    if ["facing", "binding", "cuff", "band", "collar", "yoke"]
        .iter()
        .any(|w| has(w))
    {
        return None;
    }
    if has("pocket") {
        // On the first front that isn't a pocket itself.
        return all
            .iter()
            .find(|o| {
                let o = o.to_lowercase();
                o.contains("front") && !o.contains("pocket")
            })
            .map(|o| Choice::On {
                piece: o.to_string(),
            });
    }
    if has("front") {
        return Some(if pair {
            Choice::Pair {
                pair: Pair::LegsFront,
            }
        } else {
            Choice::One {
                place: BodyPlace::BodyFront,
            }
        });
    }
    if has("back") {
        return Some(if pair {
            Choice::Pair {
                pair: Pair::LegsBack,
            }
        } else {
            Choice::One {
                place: BodyPlace::BodyBack,
            }
        });
    }
    None
}

/// A piece's outline in a cut's frame (mirrored or not), m.
fn cut_outline(piece: &Piece, mirrored: bool) -> Result<Vec<Vec2>, String> {
    let pts = vitryne_format::outline_points(&piece.outline)
        .map_err(|m| format!("piece {}: {m}", piece.name))?;
    Ok(pts
        .iter()
        .map(|&[x, y]| {
            let x = (x / 1000.0) as f32;
            Vec2::new(if mirrored { -x } else { x }, (y / 1000.0) as f32)
        })
        .collect())
}

impl PatternImport {
    /// Reads the DXF (and the sidecar, which names the DXF it was written for; any name is
    /// accepted here, the user picked both files).
    pub fn read(file_name: &str, dxf: &str, sidecar: Option<&str>) -> Result<Self, String> {
        let (pieces, report, sidecar) = match sidecar {
            Some(toml) => {
                let g = SidecarGarment::load(toml, dxf)?;
                (g.pieces.clone(), g.report.clone(), Some(g))
            }
            None => {
                let (pieces, report) = aama::read(dxf)?;
                (pieces, report, None)
            }
        };
        if pieces.is_empty() {
            return Err(
                "no pattern pieces found (a DXF-AAMA piece is a block with a closed outline on layer 1)"
                    .into(),
            );
        }
        Ok(Self {
            file_name: file_name.to_string(),
            report,
            origin: Origin::Dxf {
                pieces,
                sidecar: sidecar.map(Box::new),
            },
            sizes: Vec::new(),
        })
    }

    /// Reads a Valentina or Seamly2D pattern with its measurements file (its text), at `size` of a size
    /// chart (the chart's base size if `None`).
    pub fn read_drafted(
        file_name: &str,
        pattern: &str,
        measurements: Option<&str>,
        size: Option<&[f64]>,
    ) -> Result<Self, String> {
        let r = drafting::read(pattern, measurements, size)?;
        if r.shapes.is_empty() {
            let why: Vec<String> = r.refused.iter().map(|(n, e)| format!("{n}: {e}")).collect();
            return Err(if why.is_empty() {
                "the pattern has no pieces (make them in the app's piece mode first)".into()
            } else {
                format!("no piece could be made: {}", why.join("; "))
            });
        }
        let mut warnings: Vec<String> = r
            .refused
            .iter()
            .map(|(n, e)| format!("{n} can't be imported: {e}"))
            .collect();
        warnings.extend(r.warnings);
        Ok(Self {
            file_name: file_name.to_string(),
            report: ImportReport {
                units_m: 0.001,
                pieces: r.shapes.iter().map(|s| s.name.clone()).collect(),
                warnings,
                ..ImportReport::default()
            },
            origin: Origin::Drafted(r.shapes),
            sizes: r.sizes,
        })
    }

    fn sidecar(&self) -> Option<&SidecarGarment> {
        match &self.origin {
            Origin::Dxf { sidecar, .. } => sidecar.as_deref(),
            Origin::Drafted(_) => None,
        }
    }

    /// The pieces the import offers: the sidecar's, in its order, or every piece.
    fn offered(&self) -> Vec<Offer<'_>> {
        match &self.origin {
            Origin::Dxf {
                pieces,
                sidecar: Some(g),
            } => {
                let mut out: Vec<Offer> = Vec::new();
                for ps in &g.spec.piece {
                    if out.iter().any(|o| o.name == ps.dxf) {
                        continue;
                    }
                    if let Some(p) = pieces.iter().find(|p| p.name == ps.dxf) {
                        let n = g.spec.piece.iter().filter(|q| q.dxf == ps.dxf).count();
                        out.push(dxf_offer(p, Some(n)));
                    }
                }
                out
            }
            Origin::Dxf {
                pieces,
                sidecar: None,
            } => pieces.iter().map(|p| dxf_offer(p, None)).collect(),
            Origin::Drafted(shapes) => shapes
                .iter()
                .map(|s| Offer {
                    name: &s.name,
                    quantity: s.quantity,
                    cuts: None,
                    from: PieceRef::Shape(s),
                })
                .collect(),
        }
    }

    pub fn preview(&self) -> Preview {
        let offered = self.offered();
        let names: Vec<&str> = offered.iter().map(|o| o.name).collect();
        let pieces = offered
            .iter()
            .map(|o| {
                let n = o.cuts.unwrap_or((o.quantity as usize).clamp(1, 2));
                let suggestion = suggest(o.name, n, &names).filter(|c| match o.cuts {
                    Some(k) => c.cuts() == k,
                    None => true,
                });
                PiecePreview {
                    name: o.name.to_string(),
                    quantity: o.quantity,
                    cuts: o.cuts,
                    outline: o.outline(),
                    suggestion,
                }
            })
            .collect();
        Preview {
            file_name: self.file_name.clone(),
            report: self.report.clone(),
            sizes: self.sizes.clone(),
            sewing: self.sidecar().map(|g| SewingInfo {
                title: g.spec.title.clone().unwrap_or_else(|| g.spec.name.clone()),
                seams: g.spec.seam.len(),
            }),
            pieces,
            unused: match &self.origin {
                Origin::Dxf { pieces, .. } => pieces
                    .iter()
                    .filter(|p| !names.contains(&p.name.as_str()))
                    .map(|p| p.name.clone())
                    .collect(),
                Origin::Drafted(_) => Vec::new(),
            },
        }
    }

    /// The garment's parts for these choices (one per offered piece, by name): pieces with
    /// their cuts placed, seams (the sidecar's, minus those touching a piece left out), the
    /// source. `garment`: the sidecar's converted garment, if any (its pieces are reused).
    fn parts(
        &self,
        choices: &BTreeMap<String, Choice>,
        sidecar_garment: Option<&Garment>,
        regions: &BTreeMap<String, Region>,
        facts: &BodyFacts,
        ids: &mut IdGen,
    ) -> Result<Parts, String> {
        let offered = self.offered();
        let mut notes = Vec::new();
        for name in choices.keys() {
            if !offered.iter().any(|o| o.name == name) {
                return Err(format!("no piece {name} to import"));
            }
        }
        let choice = |name: &str| -> Result<&Choice, String> {
            choices
                .get(name)
                .ok_or_else(|| format!("{name}: choose where it goes, or leave it out"))
        };
        // Pieces with their cuts (ids only, placed below).
        let (mut pieces, seams, source) = match sidecar_garment {
            Some(g) => {
                let source = g
                    .sources
                    .first()
                    .cloned()
                    .ok_or("the sidecar gave no source")?;
                (g.pieces.clone(), g.seams.clone(), source)
            }
            None => {
                let source = Source {
                    id: ids.next_id(),
                    kind: match self.origin {
                        Origin::Dxf { .. } => "dxf-aama",
                        Origin::Drafted(_) if self.file_name.to_lowercase().ends_with(".sm2d") => {
                            "seamly2d"
                        }
                        Origin::Drafted(_) => "valentina",
                    }
                    .into(),
                    file_name: Some(self.file_name.clone()),
                    part: None,
                    other: Map::new(),
                };
                let mut pieces = Vec::new();
                for o in &offered {
                    let n = choice(o.name)?.cuts();
                    if n == 0 {
                        continue;
                    }
                    let mut piece = match o.from {
                        PieceRef::Dxf(p) => {
                            dxf_piece(p, &[], &BTreeMap::new(), &source.id, ids)?.piece
                        }
                        PieceRef::Shape(s) => s.to_piece(&source.id, ids),
                    };
                    for k in 0..n {
                        piece.cuts.push(Cut {
                            id: ids.next_id(),
                            name: (n == 2).then(|| {
                                format!("{} {}", if k == 0 { "right" } else { "left" }, o.name)
                            }),
                            mirrored: k == 1,
                            fabric: None,
                            appearance: None,
                            // Replaced below.
                            placement: Placement::Follow(Follow {
                                cut: source.id.clone(),
                                lift: 0.0,
                                angle: None,
                                other: Map::new(),
                            }),
                            state: None,
                            layout: None,
                            other: Map::new(),
                        });
                    }
                    pieces.push(piece);
                }
                (pieces, Vec::new(), source)
            }
        };
        // Pieces left out (only possible with a sidecar here: without one they were skipped).
        let mut gone: BTreeSet<Id> = BTreeSet::new();
        pieces.retain(|p| {
            let leave = matches!(choices.get(&p.name), Some(Choice::Leave));
            if leave {
                gone.extend(p.cuts.iter().map(|c| c.id.clone()));
            }
            !leave
        });
        let mut kept = Vec::new();
        for s in seams {
            if s.a.iter().chain(&s.b).any(|r| gone.contains(&r.cut)) {
                notes.push(format!(
                    "seam {} not imported: it sews a piece left out",
                    s.name.as_deref().unwrap_or(s.id.as_str())
                ));
            } else {
                kept.push(s);
            }
        }
        // Placements.
        let first_cut: BTreeMap<String, Id> = pieces
            .iter()
            .filter_map(|p| p.cuts.first().map(|c| (p.name.clone(), c.id.clone())))
            .collect();
        for piece in &mut pieces {
            let c = choice(&piece.name)?.clone();
            if !matches!(c, Choice::Unplaced) && c.cuts() != piece.cuts.len() {
                return Err(format!(
                    "{}: the sewing file cuts it {} time(s), so choose {}",
                    piece.name,
                    piece.cuts.len(),
                    if piece.cuts.len() == 2 {
                        "a pair of places"
                    } else {
                        "one place"
                    }
                ));
            }
            let places: Vec<Option<BodyPlace>> = match &c {
                Choice::Leave => unreachable!("removed above"),
                Choice::Flat => vec![None],
                Choice::One { place } => vec![Some(*place)],
                Choice::Pair { pair } => pair.places().map(Some).to_vec(),
                Choice::On { .. } => vec![None],
                Choice::Unplaced => vec![None; piece.cuts.len()],
            };
            let outlines: Vec<Vec<Vec2>> = piece
                .cuts
                .iter()
                .map(|cut| cut_outline(piece, cut.mirrored))
                .collect::<Result<_, _>>()?;
            for ((cut, place), outline) in piece.cuts.iter_mut().zip(places).zip(outlines) {
                if matches!(c, Choice::Unplaced) {
                    cut.state = Some(CutState::Unplaced);
                }
                cut.placement = match (place, &c) {
                    (Some(place), _) => {
                        Placement::Wrap(auto_wrap(place, &outline, regions, facts)?)
                    }
                    (None, Choice::On { piece: on }) => Placement::Follow(Follow {
                        cut: first_cut
                            .get(on)
                            .filter(|id| **id != cut.id)
                            .ok_or_else(|| format!("{on}: not imported, so nothing can go on it"))?
                            .clone(),
                        lift: ON_TOP_LIFT_MM,
                        angle: None,
                        other: Map::new(),
                    }),
                    (None, Choice::Flat | Choice::Unplaced) => {
                        Placement::Wrap(flat_wrap(&outline, regions, facts)?)
                    }
                    (None, _) => unreachable!("only On, Flat and Unplaced have no place"),
                };
            }
        }
        if pieces.is_empty() {
            return Err("every piece is left out".into());
        }
        Ok(Parts {
            pieces,
            seams: kept,
            source,
            notes,
        })
    }

    /// The sidecar's garment converted with fresh ids (its placements are replaced later).
    fn sidecar_document(
        &self,
        body_glb: &[u8],
        ids: &mut IdGen,
    ) -> Result<Option<Document>, String> {
        self.sidecar()
            .map(|g| {
                convert_with(
                    g,
                    &ConvertOptions {
                        body_glb: body_glb.to_vec(),
                        dxf_file_name: self.file_name.clone(),
                        include_dxf: None,
                    },
                    ids,
                )
            })
            .transpose()
    }

    /// A new project with the test avatar (its mesh as glTF binary), the garment's pieces
    /// placed as chosen, the sidecar's fabric or a placeholder jersey.
    pub fn new_project(
        &self,
        choices: &BTreeMap<String, Choice>,
        body_glb: &[u8],
        ids: &mut IdGen,
    ) -> Result<(Document, Vec<String>), String> {
        let mesh = vitryne_format::glb::read(body_glb).map_err(|e| format!("avatar mesh: {e}"))?;
        let body: Vec<Vec3> = mesh.positions.iter().map(|&p| Vec3::from(p)).collect();
        let regions = &default_avatar().regions;
        let facts = BodyFacts::measure(&body, regions)?;
        if let Some(mut doc) = self.sidecar_document(body_glb, ids)? {
            let g = doc.garments[0].clone();
            let Parts {
                pieces,
                seams,
                notes,
                ..
            } = self.parts(choices, Some(&g), regions, &facts, ids)?;
            let g = &mut doc.garments[0];
            g.pieces = pieces;
            g.stack = g.default_stack();
            g.seams = seams;
            let report = doc.validate();
            if !report.errors.is_empty() {
                return Err(report.errors.join("; "));
            }
            return Ok((doc, notes));
        }
        let (project_id, garment_id, fabric_id) = (ids.next_id(), ids.next_id(), ids.next_id());
        let Parts {
            pieces,
            seams,
            source,
            notes,
        } = self.parts(choices, None, regions, &facts, ids)?;
        let name = self
            .file_name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&self.file_name)
            .trim_end_matches(".dxf")
            .trim_end_matches(".DXF")
            .trim_end_matches(".val")
            .trim_end_matches(".sm2d")
            .to_string();
        let fabric = fabric_entity(
            fabric_id.clone(),
            Material::cotton(),
            "Cotton jersey (placeholder)".into(),
            Some("knit"),
            Some("The engine's placeholder jersey (Material::cotton), not calibrated.".into()),
        )?;
        let mut garment = Garment {
            id: garment_id,
            name: if name.is_empty() {
                "Imported pattern".into()
            } else {
                name
            },
            attribution: None,
            library_ref: None,
            fabric: fabric_id,
            appearance: None,
            simulation: Some(new_garment_simulation(&body)),
            sources: vec![source],
            pieces,
            stack: Vec::new(),
            seams,
            other: Map::new(),
        };
        garment.stack = garment.default_stack();
        let doc = project_document(project_id, garment, fabric, body_glb.to_vec(), None, None)?;
        Ok((doc, notes))
    }

    /// Pieces (and the sidecar's seams) to add to an open project's garment, placed around its
    /// avatar (`body`: its mesh, m).
    pub fn addition(
        &self,
        choices: &BTreeMap<String, Choice>,
        regions: &BTreeMap<String, Region>,
        body: &[Vec3],
        ids: &mut IdGen,
    ) -> Result<Addition, String> {
        let facts = BodyFacts::measure(body, regions)?;
        // The sidecar's conversion needs a body file only for its project; any bytes do.
        let sidecar = self.sidecar_document(&[], ids)?;
        let mut notes = Vec::new();
        if self.sidecar().is_some() {
            notes.push("the sewing file's fabric and simulation settings are not used when adding to a project".into());
        }
        let Parts {
            pieces,
            seams,
            source,
            notes: more,
        } = self.parts(
            choices,
            sidecar.as_ref().map(|d| &d.garments[0]),
            regions,
            &facts,
            ids,
        )?;
        notes.extend(more);
        Ok(Addition {
            pieces,
            seams,
            source,
            bounds: import_bounds(body),
            notes,
        })
    }
}

/// A garment's settings in a project the editor makes (an import, or from scratch): drape as
/// the sample garments do, with self-collision and its hash rebuilt every 4th substep
/// (docs/PROGRESS.md, Fabric stretch), in the import collision box (whose SDF the app bundles).
fn new_garment_simulation(body: &[Vec3]) -> GarmentSimulation {
    let mut engine = Map::new();
    engine.insert("self_collision".into(), true.into());
    engine.insert("self_rebuild_every".into(), 4.into());
    GarmentSimulation {
        target_vertices: None,
        engine: Some(engine),
        collision_bounds: Some(import_bounds(body)),
        other: Map::new(),
    }
}

/// A project started from scratch: the test avatar (its mesh `body_glb`), the cotton jersey
/// preset, and one garment with no pieces yet. Validated.
pub fn empty_project(body_glb: &[u8], ids: &mut IdGen) -> Result<Document, String> {
    let mesh = vitryne_format::glb::read(body_glb).map_err(|e| format!("avatar mesh: {e}"))?;
    let body: Vec<Vec3> = mesh.positions.iter().map(|&p| Vec3::from(p)).collect();
    let (project_id, garment_id) = (ids.next_id(), ids.next_id());
    let fabric = vitryne_format::presets::cotton_jersey();
    let mut garment = Garment {
        id: garment_id,
        name: "Untitled".into(),
        attribution: None,
        library_ref: None,
        fabric: fabric.id.clone(),
        appearance: None,
        simulation: Some(new_garment_simulation(&body)),
        sources: Vec::new(),
        pieces: Vec::new(),
        stack: Vec::new(),
        seams: Vec::new(),
        other: Map::new(),
    };
    garment.stack = garment.default_stack();
    project_document(project_id, garment, fabric, body_glb.to_vec(), None, None)
}

/// The wrap for a cut moved to `place` in the editor: `auto_wrap` on the cut's outline, keeping
/// its in-plane rotation.
pub fn rewrap(
    piece: &Piece,
    cut: &Cut,
    place: BodyPlace,
    at: Option<Landmark>,
    regions: &BTreeMap<String, Region>,
    facts: &BodyFacts,
) -> Result<Wrap, String> {
    let rotation = match &cut.placement {
        Placement::Wrap(w) => w.rotation,
        Placement::Follow(_) => None,
    };
    let (s, c) = (rotation.unwrap_or(0.0) as f32).sin_cos();
    let outline: Vec<Vec2> = cut_outline(piece, cut.mirrored)?
        .into_iter()
        .map(|q| Vec2::new(c * q.x - s * q.y, s * q.x + c * q.y))
        .collect();
    let mut wrap = Wrap {
        rotation,
        ..auto_wrap(place, &outline, regions, facts)?
    };
    if let Some(l) = at {
        wrap.top = (l.top(place, regions, facts)? as f64 * 1000.0).round() + 0.0;
    }
    Ok(wrap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn asset(path: &str) -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../")
                .join(path),
        )
        .unwrap()
    }

    fn body_glb() -> Vec<u8> {
        let body =
            vitryne_solver::body::BodyMesh::from_obj(&asset("assets/body/makehuman_body_m.obj"))
                .unwrap();
        let mesh = vitryne_format::glb::Mesh {
            positions: body.pos.iter().map(|p| p.to_array()).collect(),
            indices: body.tris.iter().flatten().copied().collect(),
        };
        vitryne_format::glb::write(&mesh, vitryne_format::GENERATOR)
    }

    fn suggested(p: &Preview) -> BTreeMap<String, Choice> {
        p.pieces
            .iter()
            .map(|x| {
                (
                    x.name.clone(),
                    x.suggestion.clone().unwrap_or(Choice::Leave),
                )
            })
            .collect()
    }

    /// The FreeSewing T-shirt's bare DXF becomes a placed project with
    /// the suggestions alone, and its wraps land near the hand-tuned sidecar's.
    #[test]
    fn tshirt_dxf_imports_and_places() {
        let imp = PatternImport::read(
            "tshirt.dxf",
            &asset("assets/garments/tshirt/tshirt.dxf"),
            None,
        )
        .unwrap();
        let p = imp.preview();
        let names: Vec<_> = p.pieces.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, ["front", "back", "sleeve"]);
        let choices = suggested(&p);
        assert_eq!(choices["sleeve"], Choice::Pair { pair: Pair::Arms });
        let mut ids = IdGen::new(1_792_022_400_000, b"test");
        let (doc, notes) = imp.new_project(&choices, &body_glb(), &mut ids).unwrap();
        assert!(notes.is_empty());
        let g = &doc.garments[0];
        assert_eq!(g.cuts().count(), 4);
        let wrap =
            |piece: &str, k: usize| match &g.pieces.iter().find(|p| p.name == piece).unwrap().cuts
                [k]
                .placement
            {
                Placement::Wrap(w) => w.clone(),
                _ => panic!(),
            };
        let front = wrap("front", 0);
        assert_eq!((front.region.as_str(), front.angle), ("torso", 0.0));
        // Sidecar: radius 200, top 1440.
        assert!((front.radius - 200.0).abs() <= 10.0, "{}", front.radius);
        assert!((front.top - 1440.0).abs() <= 20.0, "{}", front.top);
        assert_eq!(wrap("back", 0).angle, std::f64::consts::PI);
        let (right, left) = (wrap("sleeve", 0), wrap("sleeve", 1));
        assert_eq!(
            (right.region.as_str(), left.region.as_str()),
            ("arm-right", "arm-left")
        );
        assert!(g.pieces[2].cuts[1].mirrored && !g.pieces[2].cuts[0].mirrored);
        assert!(g.seams.is_empty());
        // It opens, drapes and saves like any project.
        let pg = crate::project::ProjectGarment::new(&doc).unwrap();
        let desc = pg.build(pg.edge_for_vertices(4000).unwrap()).unwrap();
        assert!(desc.mesh.n_verts() > 3000);
        let zip = doc.to_zip_checked().unwrap();
        assert!(Document::from_zip(&zip).is_ok());
    }

    /// With its sidecar: the sidecar's cuts and seams, the user's places.
    #[test]
    fn sidecar_gives_the_sewing() {
        let toml = asset("assets/garments/hoodie/garment.toml");
        let imp = PatternImport::read(
            "hoodie.dxf",
            &asset("assets/garments/hoodie/hoodie.dxf"),
            Some(&toml),
        )
        .unwrap();
        let p = imp.preview();
        assert!(p.sewing.as_ref().unwrap().seams > 5);
        assert!(p.unused.contains(&"cuff".to_string()));
        let mut choices = suggested(&p);
        assert_eq!(
            choices["pocket"],
            Choice::On {
                piece: "front".into()
            }
        );
        assert_eq!(
            choices["hoodCenter"],
            Choice::One {
                place: BodyPlace::OverHead
            }
        );
        let mut ids = IdGen::new(1_792_022_400_000, b"test");
        let (doc, notes) = imp.new_project(&choices, &body_glb(), &mut ids).unwrap();
        assert!(notes.is_empty(), "{notes:?}");
        let seams = doc.garments[0].seams.len();
        assert_eq!(seams, p.sewing.as_ref().unwrap().seams);
        // Leaving the pocket out drops the seams that sew it.
        choices.insert("pocket".into(), Choice::Leave);
        let (doc, notes) = imp.new_project(&choices, &body_glb(), &mut ids).unwrap();
        assert!(doc.garments[0].seams.len() < seams);
        assert!(!notes.is_empty());
        // Imported as it is, the pocket starts as a wrap of its own, not on the front.
        choices.insert("pocket".into(), Choice::Flat);
        let (doc, _) = imp.new_project(&choices, &body_glb(), &mut ids).unwrap();
        let g = &doc.garments[0];
        let pocket = g.pieces.iter().find(|x| x.name == "pocket").unwrap();
        assert!(matches!(pocket.cuts[0].placement, Placement::Wrap(_)));
        // A pair where the sidecar cuts once is refused.
        choices.insert(
            "front".into(),
            Choice::Pair {
                pair: Pair::BodySides,
            },
        );
        assert!(imp.new_project(&choices, &body_glb(), &mut ids).is_err());
    }

    /// A small skirt in Valentina's format: a front and a back panel with a curved hip,
    /// drafted from `hip_circ` in its measurements file.
    const SKIRT_VAL: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<pattern>
    <version>0.9.2</version>
    <unit>cm</unit>
    <measurements path="/home/someone/skirt.vit"/>
    <increments><increment name="#ease" formula="2"/></increments>
    <draw name="Skirt">
        <calculation>
            <point type="single" id="1" name="A" x="0" y="0"/>
            <point type="endLine" id="2" name="B" basePoint="1" angle="0" length="hip_circ/4 + #ease"/>
            <point type="endLine" id="3" name="C" basePoint="1" angle="270" length="60"/>
            <point type="endLine" id="4" name="D" basePoint="2" angle="270" length="60"/>
            <point type="endLine" id="5" name="E" basePoint="2" angle="270" length="20"/>
            <point type="endLine" id="6" name="F" basePoint="1" angle="0" length="Line_A_B - 3"/>
            <spline type="simpleInteractive" id="7" point1="6" point4="5" angle1="0" angle2="90" length1="2" length2="8"/>
        </calculation>
        <modeling/>
        <details>
            <detail id="20" name="Skirt front" version="2">
                <data quantity="1"/>
                <nodes>
                    <node type="NodePoint" idObject="1"/>
                    <node type="NodeSpline" idObject="7"/>
                    <node type="NodePoint" idObject="4"/>
                    <node type="NodePoint" idObject="3"/>
                </nodes>
            </detail>
            <detail id="21" name="Skirt back" version="2">
                <nodes>
                    <node type="NodePoint" idObject="1"/>
                    <node type="NodeSpline" idObject="7"/>
                    <node type="NodePoint" idObject="4"/>
                    <node type="NodePoint" idObject="3"/>
                </nodes>
            </detail>
        </details>
    </draw>
</pattern>"##;

    const SKIRT_VIT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<vit><version>0.6.2</version><read-only>false</read-only><unit>cm</unit><pm_system></pm_system>
<personal/><body-measurements><m name="hip_circ" value="96"/></body-measurements></vit>"#;

    /// A Valentina pattern becomes a placed, valid project whose curved hip is a cubic edge.
    #[test]
    fn valentina_pattern_imports() {
        let e = PatternImport::read_drafted("skirt.val", SKIRT_VAL, None, None)
            .err()
            .unwrap();
        assert!(e.contains("skirt.vit"), "{e}");
        let imp =
            PatternImport::read_drafted("skirt.val", SKIRT_VAL, Some(SKIRT_VIT), None).unwrap();
        let preview = imp.preview();
        assert_eq!(preview.pieces.len(), 2);
        assert!(preview.sizes.is_empty());
        let front = &preview.pieces[0];
        assert_eq!(front.name, "Skirt front");
        // 96/4 + 2 = 26 cm across.
        let w = front.outline.iter().map(|p| p[0]).fold(0.0, f64::max);
        assert_eq!(w, 260.0);
        assert_eq!(
            front.suggestion,
            Some(Choice::One {
                place: BodyPlace::BodyFront
            })
        );
        let mut ids = IdGen::new(0, b"valentina");
        let (doc, _) = imp
            .new_project(&suggested(&preview), &body_glb(), &mut ids)
            .unwrap();
        assert!(doc.validate().errors.is_empty());
        let g = &doc.garments[0];
        assert_eq!(g.name, "skirt");
        assert_eq!(g.sources[0].kind, "valentina");
        assert_eq!(g.pieces.len(), 2);
        assert!(
            g.pieces[0]
                .outline
                .iter()
                .any(|n| n.edge.as_ref().is_some_and(|e| e.is_cubic()))
        );
        assert!(g.seams.is_empty());
    }

    #[test]
    fn suggestions_come_from_names() {
        let all = ["front", "back", "sleeve", "pocket"];
        assert_eq!(
            suggest("Front", 1, &all),
            Some(Choice::One {
                place: BodyPlace::BodyFront
            })
        );
        assert_eq!(
            suggest("front", 2, &all),
            Some(Choice::Pair {
                pair: Pair::LegsFront
            })
        );
        assert_eq!(suggest("waistband", 1, &all), None);
        assert_eq!(suggest("pocketFacing", 2, &all), None);
        assert_eq!(suggest("neckBinding", 1, &all), None);
        assert_eq!(
            suggest("hoodSide", 2, &all),
            Some(Choice::Pair {
                pair: Pair::HeadSides
            })
        );
    }

    #[test]
    fn bounds_cover_the_test_avatar() {
        let body =
            vitryne_solver::body::BodyMesh::from_obj(&asset("assets/body/makehuman_body_m.obj"))
                .unwrap();
        let b = import_bounds(&body.pos);
        assert_eq!(
            (b.min, b.max),
            ([-550.0, 0.0, -260.0], [550.0, 1720.0, 360.0])
        );
    }
}
