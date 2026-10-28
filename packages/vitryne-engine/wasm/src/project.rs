// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor worker's project file (docs/ARCHITECTURE.md, Editor): a `.vtry` opened from
//! bytes, its entities handed to the UI as JSON and taken back after each edit (validated, so
//! the worker only ever holds a valid document), saved with a read-back check, and turned into
//! what the engine drapes. Plain Rust, so it is tested natively; `lib.rs` exposes it to the
//! worker.

use std::collections::BTreeMap;

use glam::Vec3;
use serde::Serialize;
use vitryne_format::{Bounds, Document, Entities, Id, IdGen, Kind, Piece, Placement, Wrap};
use vitryne_pattern::{
    import::{Addition, Choice, ImportSource, import_bounds, rewrap},
    placement::{BodyFacts, BodyPlace},
    project::{Placer, ProjectGarment, avatar_mesh},
    seams::{self, CutEdge, EdgePick, SeamProposal},
};
use vitryne_solver::{
    body::{BodyMesh, SdfParams},
    engine::{Fabric, GarmentDesc},
    scene::SheetScene,
    sim::SimSettings,
};

pub struct ProjectFile {
    doc: Document,
}

/// What opening a file found without refusing it.
#[derive(Debug, Serialize)]
pub struct OpenReport {
    pub warnings: Vec<String>,
}

/// A garment ready to load on the GPU, and the body it needs.
pub struct Prepared {
    pub avatar: String,
    pub mesh: BodyMesh,
    pub sdf: SdfParams,
    pub info: PreparedInfo,
    /// The garment's camera (target, distance, m).
    pub camera: (Vec3, f32),
    /// None: the garment has no pieces yet, and the body is shown alone.
    pub cloth: Option<PreparedCloth>,
}

/// The garment's part of `Prepared`.
pub struct PreparedCloth {
    pub garment: GarmentDesc,
    pub fabric: Fabric,
    pub panel_fabrics: Vec<Fabric>,
    pub settings: SimSettings,
    /// Fabrics for 3D export, coloured by their appearances.
    pub export_fabrics: Vec<vitryne_pattern::export::ExportFabric>,
    /// Each panel's colour (sRGB 0..1), or none for the scene's cloth colour.
    pub panel_colors: Vec<Option<[f32; 3]>>,
    /// Places the meshed garment again for the editor's placement preview.
    pub placer: Placer,
}

/// How one cut looks (`ProjectFile::looks`).
#[derive(Debug, Clone, PartialEq)]
pub struct Look {
    /// sRGB 0..1; none: the scene's cloth colour.
    pub color: Option<[f32; 3]>,
    pub export: vitryne_pattern::export::ExportFabric,
}

/// What the UI is told about a prepared drape.
#[derive(Debug, Clone, Serialize)]
pub struct PreparedInfo {
    /// Names the body's SDF (`SdfParams::cache_key`): the worker looks it up in the bundled
    /// SDFs and its cache before baking.
    pub sdf_key: String,
    pub vertices: u32,
    pub self_collision: bool,
    /// What the engine ignores or approximates.
    pub warnings: Vec<String>,
    /// The cut ids in the drape's panel order (a picked panel is this cut).
    pub cuts: Vec<String>,
    /// How far further out each cut starts than its own radius, mm, in the same order: what
    /// the stack pushes it out by, its offset, and for a cut on another, the lifts.
    pub starts_out_mm: Vec<f64>,
}

/// A cut moved to another place on the body (`ProjectFile::rewrap`).
#[derive(Debug, Serialize)]
pub struct Rewrapped {
    pub placement: Wrap,
    /// A collision box for the garment when its own wouldn't cover the cut there (or it has
    /// none, so that moving pieces doesn't change the body's SDF).
    pub bounds: Option<Bounds>,
}

/// A new piece wrapped around the body (`ProjectFile::place_piece`).
#[derive(Debug, Serialize)]
pub struct PlacedPiece {
    /// Each cut's wrap, in the piece's cut order.
    pub placements: Vec<Wrap>,
    /// A collision box for the garment when its own wouldn't cover the piece.
    pub bounds: Option<Bounds>,
}

/// An import into a new project: the file, and what the import had to say.
pub struct Imported {
    pub file: ProjectFile,
    pub notes: Vec<String>,
}

impl ProjectFile {
    /// A `.vtry` zip. Only projects (a garment, fabric or avatar file has nothing to drape on
    /// its own yet).
    pub fn open(bytes: &[u8]) -> Result<(Self, OpenReport), String> {
        Self::from_opened(Document::from_zip(bytes).map_err(|e| e.to_string())?)
    }

    /// The folder form: every file under the folder, by path relative to it.
    pub fn open_folder(files: Vec<(String, Vec<u8>)>) -> Result<(Self, OpenReport), String> {
        let entries = vitryne_format::container::Entries {
            files,
            warnings: Vec::new(),
        };
        Self::from_opened(Document::from_entries(entries).map_err(|e| e.to_string())?)
    }

    fn from_opened(opened: vitryne_format::Opened) -> Result<(Self, OpenReport), String> {
        if opened.doc.kind != Kind::Project {
            return Err(format!(
                "this is a {} file; the editor opens projects ({}) for now",
                format!("{:?}", opened.doc.kind).to_lowercase(),
                Kind::Project.extension()
            ));
        }
        let report = OpenReport {
            warnings: opened.warnings,
        };
        Ok((Self { doc: opened.doc }, report))
    }

    pub fn document(&self) -> &Document {
        &self.doc
    }

    /// The entities as JSON text (`vitryne_format::Entities`).
    pub fn entities_json(&self) -> String {
        serde_json::to_string(&self.doc.entities()).expect("entities serialize")
    }

    /// Takes the UI's edited entities. If they don't parse or aren't valid, nothing changes
    /// and the error says why. Returns the warnings.
    pub fn set_entities_json(&mut self, json: &str) -> Result<Vec<String>, String> {
        let e: Entities = serde_json::from_str(json).map_err(|e| format!("entities: {e}"))?;
        self.doc.set_entities(e).map_err(|e| e.to_string())
    }

    /// The file's bytes, read back and checked before they are returned.
    pub fn save(&self) -> Result<Vec<u8>, String> {
        self.doc.to_zip_checked().map_err(|e| e.to_string())
    }

    /// The folder form's files, read back and checked.
    pub fn save_folder(&self) -> Result<Vec<(String, Vec<u8>)>, String> {
        self.doc.to_entries_checked().map_err(|e| e.to_string())
    }

    /// Meshes and places the project's garment, with its fabric, settings and avatar. CPU
    /// only; the SDF is found or baked later, by its key.
    pub fn prepare(&self) -> Result<Prepared, String> {
        let pg = ProjectGarment::new(&self.doc)?;
        let mut settings = SheetScene::config();
        let mut warnings = pg.warnings.clone();
        warnings.extend(pg.apply_settings(&mut settings));
        let mesh = avatar_mesh(&self.doc)?.ok_or("the project has no avatar")?;
        let avatar = self
            .doc
            .project_avatar()
            .map_or("avatar".into(), |a| a.name.clone());
        if pg.garment.cuts().next().is_none() {
            // Nothing to drape yet; the body's SDF is the one the first piece will need.
            let sdf = pg.body_sdf();
            return Ok(Prepared {
                info: PreparedInfo {
                    sdf_key: sdf.cache_key(&mesh),
                    vertices: 0,
                    self_collision: settings.self_collision,
                    warnings,
                    cuts: Vec::new(),
                    starts_out_mm: Vec::new(),
                },
                camera: pg.camera(),
                avatar,
                mesh,
                sdf,
                cloth: None,
            });
        }
        let vertices = pg.target_vertices();
        let (garment, placer) = pg.build_with_placer(pg.edge_for_vertices(vertices)?)?;
        let sdf = garment.sdf.clone();
        Ok(Prepared {
            info: PreparedInfo {
                sdf_key: sdf.cache_key(&mesh),
                vertices: garment.mesh.n_verts() as u32,
                self_collision: settings.self_collision,
                warnings,
                cuts: placer.cut_ids(),
                starts_out_mm: placer
                    .starts_out()?
                    .iter()
                    .map(|&m| (m as f64 * 1000.0 * 10.0).round() / 10.0)
                    .collect(),
            },
            camera: pg.camera(),
            avatar,
            mesh,
            sdf,
            cloth: Some(PreparedCloth {
                export_fabrics: pg.export_fabrics(),
                panel_colors: pg.panel_colors(),
                placer,
                fabric: pg.material(),
                panel_fabrics: pg.panel_materials(),
                garment,
                settings,
            }),
        })
    }
    /// How each cut of the garment looks now, by cut id: its colour (none: the scene's cloth
    /// colour) and its export material. No meshing, so the viewport can recolour the drape
    /// after an edit that changes appearances only, without draping again.
    pub fn looks(&self) -> Result<BTreeMap<String, Look>, String> {
        let pg = ProjectGarment::new(&self.doc)?;
        let ids = pg.garment.cuts().map(|(_, c)| c.id.to_string());
        let looks = pg.panel_colors().into_iter().zip(pg.export_fabrics());
        Ok(ids
            .zip(looks)
            .map(|(id, (color, export))| (id, Look { color, export }))
            .collect())
    }

    /// A pattern as a new project around the test avatar, its pieces placed as chosen
    /// (docs/ARCHITECTURE.md, Import and placement). `body_glb`: the test avatar's mesh;
    /// `now_ms` and `seed` make the ids.
    pub fn import_new(
        source: &ImportSource,
        choices: &BTreeMap<String, Choice>,
        body_glb: &[u8],
        now_ms: u64,
        seed: &[u8],
    ) -> Result<Imported, String> {
        let imp = source.read()?;
        let (doc, notes) = imp.new_project(choices, body_glb, &mut IdGen::new(now_ms, seed))?;
        Ok(Imported {
            file: Self { doc },
            notes,
        })
    }

    /// A project started from scratch: the test avatar (`body_glb`: its mesh), the cotton
    /// jersey preset and a garment with no pieces yet. `now_ms` and `seed` make the ids.
    pub fn new_empty(body_glb: &[u8], now_ms: u64, seed: &[u8]) -> Result<Self, String> {
        let doc = vitryne_pattern::import::empty_project(body_glb, &mut IdGen::new(now_ms, seed))?;
        Ok(Self { doc })
    }

    /// Pieces from a pattern (and a DXF sidecar's seams) to add to this project's garment,
    /// placed around its avatar. Nothing changes here: the editor adds them as an edit.
    pub fn import_addition(
        &self,
        source: &ImportSource,
        choices: &BTreeMap<String, Choice>,
        now_ms: u64,
        seed: &[u8],
    ) -> Result<Addition, String> {
        let imp = source.read()?;
        let (regions, body) = self.body()?;
        imp.addition(choices, regions, &body, &mut IdGen::new(now_ms, seed))
    }

    fn body(&self) -> Result<(&BTreeMap<String, vitryne_format::Region>, Vec<Vec3>), String> {
        let avatar = self
            .doc
            .project_avatar()
            .ok_or("the project has no avatar")?;
        let mesh = avatar_mesh(&self.doc)?.ok_or("the project has no avatar")?;
        Ok((&avatar.regions, mesh.pos))
    }

    /// Every whole edge of every cut of the first garment, and whether a seam sews it.
    pub fn sewing_edges(&self) -> Result<Vec<CutEdge>, String> {
        seams::cut_edges(ProjectGarment::new(&self.doc)?.garment)
    }

    /// Suggested seams for the edges nothing sews yet, best first. The user accepts or
    /// rejects each one; nothing changes here.
    pub fn suggest_seams(&self) -> Result<Vec<SeamProposal>, String> {
        seams::propose(ProjectGarment::new(&self.doc)?.garment)
    }

    /// The seam picked whole edges make: one or more per side (docs/PATENTS.md, rule 1:
    /// anything that isn't a whole edge is refused).
    pub fn join_edges(&self, a: &[EdgePick], b: &[EdgePick]) -> Result<SeamProposal, String> {
        seams::join_chains(ProjectGarment::new(&self.doc)?.garment, a, b)
    }

    /// Each seam's length difference in percent, by seam id.
    pub fn seam_differences(&self) -> Result<BTreeMap<String, f32>, String> {
        let g = ProjectGarment::new(&self.doc)?.garment;
        Ok(seams::seam_differences(g)
            .into_iter()
            .map(|(id, d)| (id.to_string(), d))
            .collect())
    }

    /// Cut `cut` started again at `place`: a fresh wrap from its size and the body
    /// (`placement::auto_wrap`), keeping its rotation.
    pub fn rewrap(&self, cut: &str, place: BodyPlace) -> Result<Rewrapped, String> {
        let pg = ProjectGarment::new(&self.doc)?;
        let id = Id::parse(cut)?;
        let (piece, c) = pg
            .garment
            .piece_of_cut(&id)
            .ok_or_else(|| format!("no cut {cut}"))?;
        let (regions, body) = self.body()?;
        let facts = BodyFacts::measure(&body, regions)?;
        let wrap = rewrap(piece, c, place, regions, &facts)?;
        let outline = pg.placed_outline(&id, &Placement::Wrap(wrap.clone()))?;
        let own = pg
            .garment
            .simulation
            .as_ref()
            .and_then(|s| s.collision_bounds.as_ref());
        Ok(Rewrapped {
            placement: wrap,
            bounds: grown_bounds(own, &body, &outline),
        })
    }

    /// A new piece (drawn in the editor, not in the garment yet) wrapped around the body: cut
    /// `k` at `places[k]` (`rewrap` for each), and the box the garment needs with it. The
    /// project is unchanged: the editor adds the piece as an edit.
    pub fn place_piece(&self, piece: &Piece, places: &[BodyPlace]) -> Result<PlacedPiece, String> {
        if piece.cuts.len() != places.len() {
            return Err(format!(
                "{} cuts and {} places",
                piece.cuts.len(),
                places.len()
            ));
        }
        let (regions, body) = self.body()?;
        let facts = BodyFacts::measure(&body, regions)?;
        let placements = piece
            .cuts
            .iter()
            .zip(places)
            .map(|(c, &place)| rewrap(piece, c, place, regions, &facts))
            .collect::<Result<Vec<_>, _>>()?;
        // The garment as it will be, to place the cuts in it.
        let mut doc = self.doc.clone();
        let garment_id = doc
            .project
            .as_ref()
            .and_then(|p| p.garments.first())
            .ok_or("the project has no garment")?
            .clone();
        let mut placed = piece.clone();
        for (c, w) in placed.cuts.iter_mut().zip(&placements) {
            c.placement = Placement::Wrap(w.clone());
        }
        doc.garments
            .iter_mut()
            .find(|g| g.id == garment_id)
            .ok_or("garment missing")?
            .pieces
            .push(placed.clone());
        let pg = ProjectGarment::new(&doc)?;
        let mut bounds: Option<Bounds> = None;
        for c in &placed.cuts {
            let outline = pg.placed_outline(&c.id, &c.placement)?;
            let own = bounds.as_ref().or(pg
                .garment
                .simulation
                .as_ref()
                .and_then(|s| s.collision_bounds.as_ref()));
            if let Some(b) = grown_bounds(own, &body, &outline) {
                bounds = Some(b);
            }
        }
        Ok(PlacedPiece { placements, bounds })
    }
}

/// The collision box a garment needs for a cut placed at `outline` (m), if its own box `own`
/// doesn't cover it (or it has none, so that moving pieces doesn't change the body's SDF).
fn grown_bounds(own: Option<&Bounds>, body: &[Vec3], outline: &[Vec3]) -> Option<Bounds> {
    let Some(b) = own else {
        return Some(import_bounds(body));
    };
    // 5 cm to spare: the cloth moves inwards from where it starts, mostly.
    let inside = |p: &Vec3| {
        (0..3).all(|k| {
            let x = p[k] as f64 * 1000.0;
            x >= b.min[k] + 50.0 && x <= b.max[k] - 50.0
        })
    };
    if outline.iter().all(inside) {
        return None;
    }
    let i = import_bounds(body);
    Some(Bounds {
        min: [0, 1, 2].map(|k| b.min[k].min(i.min[k])),
        max: [0, 1, 2].map(|k| b.max[k].max(i.max[k])),
        other: b.other.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::Path;

    fn example_zip(name: &str) -> Vec<u8> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../assets/examples/{name}.vtry"));
        Document::open(&dir).unwrap().doc.to_zip().unwrap()
    }

    /// The worker's open -> entities -> edit -> save path: unedited and edited-then-undone
    /// saves are byte-identical; an invalid edit is refused and changes nothing.
    #[test]
    fn open_edit_undo_save_is_byte_identical() {
        for name in ["tshirt", "trousers", "hoodie"] {
            let zip = example_zip(name);
            let (mut file, report) = ProjectFile::open(&zip).unwrap();
            assert!(report.warnings.is_empty(), "{name}: {:?}", report.warnings);
            assert_eq!(file.save().unwrap(), zip, "{name}: unedited");

            let original = file.entities_json();
            let mut e: serde_json::Value = serde_json::from_str(&original).unwrap();
            e["fabrics"][0]["friction"] = 0.45.into();
            e["project"]["name"] = "Renamed".into();
            file.set_entities_json(&e.to_string()).unwrap();
            assert_ne!(file.save().unwrap(), zip, "{name}: edited");
            assert_eq!(file.document().fabrics[0].friction, 0.45);

            e["garments"][0]["fabric"] = "01a13cdb-cc03-7000-8000-000000000000".into();
            assert!(file.set_entities_json(&e.to_string()).is_err());
            assert_eq!(file.document().fabrics[0].friction, 0.45);

            file.set_entities_json(&original).unwrap();
            assert_eq!(file.save().unwrap(), zip, "{name}: edited then undone");
        }
    }

    /// Each cut's colour: its own appearance, else the garment's, else none; export materials
    /// follow.
    #[test]
    fn looks_follow_the_appearances() {
        let (mut file, _) = ProjectFile::open(&example_zip("tshirt")).unwrap();
        let none = file.looks().unwrap();
        assert!(none.values().all(|l| l.color.is_none()));
        let (navy, red) = (
            "01a13cdb-cc05-7000-8000-000000000001",
            "01a13cdb-cc05-7000-8000-000000000002",
        );
        let mut e: serde_json::Value = serde_json::from_str(&file.entities_json()).unwrap();
        e["appearances"] = serde_json::json!([
            { "id": navy, "name": "Navy", "color": "#000080" },
            { "id": red, "name": "Red", "color": "#ff0000" },
        ]);
        e["project"]["appearances"] = serde_json::json!([navy, red]);
        e["garments"][0]["appearance"] = navy.into();
        e["garments"][0]["pieces"][0]["cuts"][0]["appearance"] = red.into();
        file.set_entities_json(&e.to_string()).unwrap();
        let first = e["garments"][0]["pieces"][0]["cuts"][0]["id"]
            .as_str()
            .unwrap();
        let looks = file.looks().unwrap();
        assert_eq!(looks.len(), none.len());
        for (id, l) in &looks {
            let want = if id == first {
                [1.0, 0.0, 0.0]
            } else {
                [0.0, 0.0, 128.0 / 255.0]
            };
            assert_eq!(l.color, Some(want), "{id}");
        }
        let red_export = &looks[first].export;
        assert!(red_export.name.ends_with(", Red"), "{}", red_export.name);
        assert_eq!(red_export.color, [1.0, 0.0, 0.0, 1.0]);
        let prepared = file.prepare().unwrap();
        let cloth = prepared.cloth.as_ref().unwrap();
        assert_eq!(cloth.panel_colors.len(), prepared.info.cuts.len());
        assert_eq!(cloth.panel_colors[0], Some([1.0, 0.0, 0.0]));
    }

    /// A fabric's appearance colours the cuts that use it, the nearest one set winning: a cut's
    /// own fabric over the garment's appearance, the garment's appearance over its fabric's.
    #[test]
    fn fabrics_carry_their_looks() {
        let (mut file, _) = ProjectFile::open(&example_zip("tshirt")).unwrap();
        let (navy, red, green, red_fabric) = (
            "01a13cdb-cc05-7000-8000-000000000001",
            "01a13cdb-cc05-7000-8000-000000000002",
            "01a13cdb-cc05-7000-8000-000000000003",
            "01a13cdb-cc05-7000-8000-000000000004",
        );
        let mut e: serde_json::Value = serde_json::from_str(&file.entities_json()).unwrap();
        e["appearances"] = serde_json::json!([
            { "id": navy, "name": "Navy", "color": "#000080" },
            { "id": red, "name": "Red", "color": "#ff0000" },
            { "id": green, "name": "Green", "color": "#00ff00" },
        ]);
        e["project"]["appearances"] = serde_json::json!([navy, red, green]);
        let mut other = e["fabrics"][0].clone();
        other["id"] = red_fabric.into();
        other["appearance"] = red.into();
        e["fabrics"][0]["appearance"] = navy.into();
        e["fabrics"].as_array_mut().unwrap().push(other);
        e["project"]["fabrics"]
            .as_array_mut()
            .unwrap()
            .push(red_fabric.into());
        e["garments"][0]["pieces"][0]["cuts"][0]["fabric"] = red_fabric.into();
        let first = e["garments"][0]["pieces"][0]["cuts"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let colors = |file: &mut ProjectFile, e: &serde_json::Value| {
            file.set_entities_json(&e.to_string()).unwrap();
            let looks = file.looks().unwrap();
            let rest: BTreeSet<_> = looks
                .iter()
                .filter(|(id, _)| **id != first)
                .map(|(_, l)| format!("{:?}", l.color))
                .collect();
            (looks[&first].color, rest.into_iter().collect::<Vec<_>>())
        };
        let (r, n, g) = (
            Some([1.0, 0.0, 0.0]),
            Some([0.0, 0.0, 128.0 / 255.0]),
            Some([0.0, 1.0, 0.0]),
        );
        assert_eq!(colors(&mut file, &e), (r, vec![format!("{n:?}")]));
        e["garments"][0]["appearance"] = green.into();
        assert_eq!(colors(&mut file, &e), (r, vec![format!("{g:?}")]));
        e["garments"][0]["pieces"][0]["cuts"][0]["appearance"] = navy.into();
        assert_eq!(colors(&mut file, &e), (n, vec![format!("{g:?}")]));
    }

    #[test]
    fn folder_form_round_trips() {
        let dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../assets/examples/hoodie.vtry");
        let files = vitryne_format::container::read_dir(&dir).unwrap().files;
        let (file, _) = ProjectFile::open_folder(files.clone()).unwrap();
        let mut saved = file.save_folder().unwrap();
        let mut on_disk = files;
        saved.sort();
        on_disk.sort();
        assert_eq!(saved, on_disk);
    }

    #[test]
    fn prepare_matches_the_native_scene() {
        let (file, _) = ProjectFile::open(&example_zip("tshirt")).unwrap();
        let p = file.prepare().unwrap();
        let cloth = p.cloth.as_ref().unwrap();
        assert!(cloth.settings.self_collision);
        assert_eq!(cloth.settings.self_rebuild_every, 4);
        assert!(
            (9_000..11_000).contains(&p.info.vertices),
            "{}",
            p.info.vertices
        );
        assert_eq!(p.info.sdf_key, p.sdf.cache_key(&p.mesh));
        assert_eq!(p.sdf.min, [-0.55, 0.40, -0.25]);
    }

    #[test]
    fn non_projects_and_junk_are_refused() {
        assert!(ProjectFile::open(b"not a zip").is_err());
        let mut doc = Document::open(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../assets/examples/tshirt.vtry"),
        )
        .unwrap()
        .doc;
        doc.kind = Kind::Fabric;
        doc.project = None;
        doc.garments.clear();
        doc.avatars.clear();
        doc.files.clear();
        let e = ProjectFile::open(&doc.to_zip().unwrap()).err().unwrap();
        assert!(e.contains("fabric file"), "{e}");
    }

    fn asset(path: &str) -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .join(path),
        )
        .unwrap()
    }

    fn tshirt_source() -> ImportSource {
        ImportSource::Dxf {
            name: "tshirt.dxf".into(),
            text: asset("assets/garments/tshirt/tshirt.dxf"),
            sidecar: None,
        }
    }

    /// The test avatar's mesh as the app bundles it (`export-app-assets`: avatar/body.glb).
    fn body_glb() -> Vec<u8> {
        let doc = Document::open(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../assets/examples/tshirt.vtry"),
        )
        .unwrap()
        .doc;
        let avatar = doc.project_avatar().unwrap();
        doc.files[&avatar.mesh].bytes.clone()
    }

    /// The FreeSewing T-shirt's bare DXF becomes a project that the
    /// worker drapes, saves and opens again, without a file edited by hand.
    #[test]
    fn a_bare_dxf_becomes_a_project() {
        let choices: BTreeMap<String, Choice> = serde_json::from_str(
            r#"{"front": {"type": "one", "place": "body-front"},
                "back": {"type": "one", "place": "body-back"},
                "sleeve": {"type": "pair", "pair": "arms"}}"#,
        )
        .unwrap();
        let imported = ProjectFile::import_new(
            &tshirt_source(),
            &choices,
            &body_glb(),
            1_792_022_400_000,
            b"seed",
        )
        .unwrap();
        let file = imported.file;
        let p = file.prepare().unwrap();
        assert_eq!(p.info.cuts.len(), 4);
        // The collision box is the import box: one SDF for every imported garment.
        assert_eq!(p.sdf.min, [-0.55, 0.0, -0.26]);
        let zip = file.save().unwrap();
        let (again, report) = ProjectFile::open(&zip).unwrap();
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert_eq!(again.entities_json(), file.entities_json());

        // Its pieces move to other places; the box already covers them.
        let sleeve = &p.info.cuts[2];
        let r = file.rewrap(sleeve, BodyPlace::LegRightFront).unwrap();
        assert_eq!(r.placement.region, "leg-right");
        assert!(r.bounds.is_none());
    }

    /// A project from scratch has nothing to drape: the body alone, with the SDF every import
    /// uses (bundled with the app). It saves and opens again, has no edges to sew, and takes
    /// pieces added from a DXF.
    #[test]
    fn an_empty_project_shows_the_body() {
        let file = ProjectFile::new_empty(&body_glb(), 1_792_022_400_000, b"seed").unwrap();
        let g = &file.document().garments[0];
        assert!(g.pieces.is_empty());
        assert_eq!(g.fabric.as_str(), vitryne_format::presets::ID_COTTON_JERSEY);
        let p = file.prepare().unwrap();
        assert!(p.cloth.is_none());
        assert!(p.info.cuts.is_empty());
        let choices: BTreeMap<String, Choice> = serde_json::from_str(
            r#"{"front": {"type": "one", "place": "body-front"},
                "back": {"type": "leave"}, "sleeve": {"type": "leave"}}"#,
        )
        .unwrap();
        let imported = ProjectFile::import_new(
            &tshirt_source(),
            &choices,
            &body_glb(),
            1_792_022_400_000,
            b"seed",
        )
        .unwrap();
        assert_eq!(
            p.info.sdf_key,
            imported.file.prepare().unwrap().info.sdf_key
        );

        let zip = file.save().unwrap();
        let (mut again, report) = ProjectFile::open(&zip).unwrap();
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert_eq!(again.entities_json(), file.entities_json());
        assert!(again.sewing_edges().unwrap().is_empty());
        assert!(again.suggest_seams().unwrap().is_empty());
        assert!(again.looks().unwrap().is_empty());

        // Its first piece, from a DXF, as the editor adds it (`addPieces`).
        let a = again
            .import_addition(&tshirt_source(), &choices, 1_792_022_400_001, b"seed")
            .unwrap();
        let mut e = again.document().entities();
        e.garments[0]["pieces"] = serde_json::to_value(&a.pieces).unwrap();
        // The new cuts go on top of the stack, as `addPieces` puts them.
        e.garments[0]["stack"] = a
            .pieces
            .iter()
            .flat_map(|p| p.cuts.iter().map(|c| c.id.to_string()))
            .collect();
        e.garments[0]["sources"] = serde_json::to_value([&a.source]).unwrap();
        again
            .set_entities_json(&serde_json::to_string(&e).unwrap())
            .unwrap();
        let p = again.prepare().unwrap();
        assert_eq!(p.info.cuts.len(), 1);
        assert!(p.cloth.is_some());
        assert_eq!(
            p.info.sdf_key,
            imported.file.prepare().unwrap().info.sdf_key
        );
    }

    /// A garment's own box grows only when a moved piece would leave it: the trousers' box
    /// stops at the waist, so a trouser front moved up to the torso needs more.
    #[test]
    fn rewrap_grows_the_box_only_when_needed() {
        let (file, _) = ProjectFile::open(&example_zip("trousers")).unwrap();
        let p = file.prepare().unwrap();
        let front = &p.info.cuts[0];
        let r = file.rewrap(front, BodyPlace::LegRightBack).unwrap();
        assert_eq!(r.placement.angle, std::f64::consts::PI);
        assert!(r.bounds.is_none());
        let r = file.rewrap(front, BodyPlace::BodyFront).unwrap();
        let b = r.bounds.unwrap();
        assert_eq!((b.min[1], b.max[1]), (0.0, 1720.0));
    }

    /// A drawn piece, not in the garment yet, wrapped as a pair on the legs: each cut gets its
    /// leg's wrap (the mirrored one on the left), and the trousers' box already covers it.
    #[test]
    fn place_piece_wraps_each_cut() {
        let (file, _) = ProjectFile::open(&example_zip("trousers")).unwrap();
        let node = |id: &str, x: f64, y: f64| {
            serde_json::json!({"id": id, "type": "corner", "position": [x, y],
                "edge": {"type": "polyline", "points": []}})
        };
        let piece: Piece = serde_json::from_value(serde_json::json!({
            "id": "0192f0a0-0000-7000-8000-000000000001",
            "name": "Panel",
            "outline": [
                node("0192f0a0-0000-7000-8000-000000000002", 0.0, 0.0),
                node("0192f0a0-0000-7000-8000-000000000003", 300.0, 0.0),
                node("0192f0a0-0000-7000-8000-000000000004", 300.0, 500.0),
                node("0192f0a0-0000-7000-8000-000000000005", 0.0, 500.0),
            ],
            "cuts": [
                {"id": "0192f0a0-0000-7000-8000-000000000006",
                 "placement": {"type": "wrap", "region": "torso", "angle": 0, "radius": 1, "top": 0}},
                {"id": "0192f0a0-0000-7000-8000-000000000007", "mirrored": true,
                 "placement": {"type": "wrap", "region": "torso", "angle": 0, "radius": 1, "top": 0}},
            ],
        }))
        .unwrap();
        let places = [BodyPlace::LegRightFront, BodyPlace::LegLeftFront];
        let r = file.place_piece(&piece, &places).unwrap();
        assert_eq!(r.placements.len(), 2);
        assert_eq!(r.placements[0].region, "leg-right");
        assert_eq!(r.placements[1].region, "leg-left");
        assert!(r.placements.iter().all(|w| w.radius > 10.0));
        assert!(r.bounds.is_none());
        // Up on the head it needs more room; a count that doesn't match is refused.
        let r = file
            .place_piece(&piece, &[BodyPlace::HeadRight, BodyPlace::HeadLeft])
            .unwrap();
        assert!(r.bounds.is_some());
        assert!(file.place_piece(&piece, &places[..1]).is_err());
    }

    #[test]
    fn sewing_calls_on_a_bare_import() {
        let (mut file, _) = ProjectFile::open(&example_zip("tshirt")).unwrap();
        // The sample sewn: its edges are sewn, and each seam has a length difference.
        let sewn = file.sewing_edges().unwrap();
        assert!(sewn.iter().filter(|e| e.sewn).count() >= 8);
        assert_eq!(file.seam_differences().unwrap().len(), 10);
        // Without its seams (a bare import): every edge is free, and suggestions cover it.
        let mut e: serde_json::Value = serde_json::from_str(&file.entities_json()).unwrap();
        e["garments"][0]["seams"] = serde_json::json!([]);
        file.set_entities_json(&e.to_string()).unwrap();
        let edges = file.sewing_edges().unwrap();
        assert!(!edges.is_empty() && edges.iter().all(|e| !e.sewn));
        let proposals = file.suggest_seams().unwrap();
        assert!(proposals.len() >= 6, "{} proposals", proposals.len());
        assert!(proposals.iter().all(|p| !p.a.is_empty() && !p.b.is_empty()));
        // Two picks make a seam; a pick that isn't a whole edge is refused.
        let a = &edges[0];
        let b = edges.iter().find(|e| e.cut != a.cut).unwrap();
        let pick = |e: &CutEdge| EdgePick {
            cut: e.cut.clone(),
            from: e.from.clone(),
            to: e.to.clone(),
        };
        assert!(file.join_edges(&[pick(a)], &[pick(b)]).is_ok());
        let bad = EdgePick {
            cut: a.cut.clone(),
            from: a.from.clone(),
            to: b.to.clone(),
        };
        assert!(file.join_edges(&[bad], &[pick(b)]).is_err());
        assert!(file.seam_differences().unwrap().is_empty());
    }

    /// The T-shirt sewn in the editor: a bare import, sewn by accepting every suggestion, is the
    /// garment the sample project is: about the same sewing and mesh. (Written to
    /// `SEWN_OUT` when set, to drape and look at.)
    #[test]
    fn a_bare_import_sewn_from_suggestions_matches_the_sample() {
        let choices: BTreeMap<String, Choice> = serde_json::from_str(
            r#"{"front": {"type": "one", "place": "body-front"},
                "back": {"type": "one", "place": "body-back"},
                "sleeve": {"type": "pair", "pair": "arms"}}"#,
        )
        .unwrap();
        let mut file = ProjectFile::import_new(
            &tshirt_source(),
            &choices,
            &body_glb(),
            1_792_022_400_000,
            b"seed",
        )
        .unwrap()
        .file;
        // Every suggestion, accepted one after another (each asked for again, as the editor
        // does, so no edge is sewn twice).
        for n in 0.. {
            let Some(p) = file.suggest_seams().unwrap().into_iter().next() else {
                break;
            };
            assert!(n < 20, "suggestions never run out");
            let mut e: serde_json::Value = serde_json::from_str(&file.entities_json()).unwrap();
            let mut seam = serde_json::json!({
                "id": format!("00000000-0000-7000-8000-{:012x}", 0x5ea0 + n),
                "a": p.a, "b": p.b,
            });
            if let Some(pairing) = p.pairing {
                seam["pairing"] = serde_json::to_value(pairing).unwrap();
            }
            e["garments"][0]["seams"]
                .as_array_mut()
                .expect("a seams array")
                .push(seam);
            file.set_entities_json(&e.to_string()).unwrap();
        }
        let sewn = file.prepare().unwrap().cloth.unwrap();
        let (sample, _) = ProjectFile::open(&example_zip("tshirt")).unwrap();
        let sample = sample.prepare().unwrap().cloth.unwrap();
        let (a, b) = (sewn.garment.sew_pairs.len(), sample.garment.sew_pairs.len());
        let (va, vb) = (sewn.garment.mesh.n_verts(), sample.garment.mesh.n_verts());
        println!("sewing pairs {a} vs {b}, vertices {va} vs {vb}");
        for (who, p) in [("sewn", &sewn), ("sample", &sample)] {
            let list: Vec<String> = p
                .garment
                .seams
                .iter()
                .map(|(n, v)| format!("{}:{}", &n[n.len().saturating_sub(6)..], v.len()))
                .collect();
            println!("{who}: {}", list.join(" "));
        }
        assert!(a.abs_diff(b) * 10 <= b, "sewing pairs {a} vs {b}");
        assert!(va.abs_diff(vb) * 10 <= vb, "vertices {va} vs {vb}");
        if let Ok(path) = std::env::var("SEWN_OUT") {
            std::fs::write(path, file.save().unwrap()).unwrap();
        }
    }
}
