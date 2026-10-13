// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor worker's project file (docs/ARCHITECTURE.md, Editor): a `.vtry` opened from
//! bytes, its entities handed to the UI as JSON and taken back after each edit (validated, so
//! the worker only ever holds a valid document), saved with a read-back check, and turned into
//! what the engine drapes. Plain Rust, so it is tested natively; `lib.rs` exposes it to the
//! worker.

use std::collections::BTreeMap;

use drape_assets::{
    import::{Addition, Choice, DxfImport, import_bounds, rewrap},
    placement::{BodyFacts, BodyPlace},
    project::{Placer, ProjectGarment, avatar_mesh},
};
use drape_core::{
    body::{BodyMesh, SdfParams},
    engine::{Fabric, GarmentDesc},
    scene::SheetScene,
    sim::SimSettings,
};
use glam::Vec3;
use serde::Serialize;
use vitryne_format::{Bounds, Document, Entities, Id, IdGen, Kind, Placement, Wrap};

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
    pub garment: GarmentDesc,
    pub fabric: Fabric,
    pub settings: SimSettings,
    pub avatar: String,
    pub mesh: BodyMesh,
    pub sdf: SdfParams,
    pub info: PreparedInfo,
    /// Places the meshed garment again for the editor's placement preview.
    pub placer: Placer,
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
}

/// A cut moved to another place on the body (`ProjectFile::rewrap`).
#[derive(Debug, Serialize)]
pub struct Rewrapped {
    pub placement: Wrap,
    /// A collision box for the garment when its own wouldn't cover the cut there (or it has
    /// none, so that moving pieces doesn't change the body's SDF).
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
        let vertices = pg.target_vertices();
        let (garment, placer) = pg.build_with_placer(pg.edge_for_vertices(vertices)?)?;
        let mesh = avatar_mesh(&self.doc)?.ok_or("the project has no avatar")?;
        let avatar = self
            .doc
            .project_avatar()
            .map_or("avatar".into(), |a| a.name.clone());
        let sdf = garment.sdf.clone();
        Ok(Prepared {
            info: PreparedInfo {
                sdf_key: sdf.cache_key(&mesh),
                vertices: garment.mesh.n_verts() as u32,
                self_collision: settings.self_collision,
                warnings,
                cuts: placer.cut_ids(),
            },
            placer,
            fabric: pg.material(),
            garment,
            settings,
            avatar,
            mesh,
            sdf,
        })
    }
    /// A DXF (and its sidecar) as a new project around the test avatar, its pieces placed
    /// as chosen (docs/ARCHITECTURE.md, Import and placement). `body_glb`: the test avatar's
    /// mesh; `now_ms` and `seed` make the ids.
    pub fn import_new(
        file_name: &str,
        dxf: &str,
        sidecar: Option<&str>,
        choices: &BTreeMap<String, Choice>,
        body_glb: &[u8],
        now_ms: u64,
        seed: &[u8],
    ) -> Result<Imported, String> {
        let imp = DxfImport::read(file_name, dxf, sidecar)?;
        let (doc, notes) = imp.new_project(choices, body_glb, &mut IdGen::new(now_ms, seed))?;
        Ok(Imported {
            file: Self { doc },
            notes,
        })
    }

    /// Pieces from a DXF (and its sidecar's seams) to add to this project's garment, placed
    /// around its avatar. Nothing changes here: the editor adds them as an edit.
    pub fn import_addition(
        &self,
        file_name: &str,
        dxf: &str,
        sidecar: Option<&str>,
        choices: &BTreeMap<String, Choice>,
        now_ms: u64,
        seed: &[u8],
    ) -> Result<Addition, String> {
        let imp = DxfImport::read(file_name, dxf, sidecar)?;
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
            .and_then(|s| s.collision_bounds.clone());
        let bounds = match own {
            None => Some(import_bounds(&body)),
            Some(b) => {
                // 5 cm to spare: the cloth moves inwards from where it starts, mostly.
                let inside = |p: &Vec3| {
                    (0..3).all(|k| {
                        let x = p[k] as f64 * 1000.0;
                        x >= b.min[k] + 50.0 && x <= b.max[k] - 50.0
                    })
                };
                if outline.iter().all(inside) {
                    None
                } else {
                    let i = import_bounds(&body);
                    Some(Bounds {
                        min: [0, 1, 2].map(|k| b.min[k].min(i.min[k])),
                        max: [0, 1, 2].map(|k| b.max[k].max(i.max[k])),
                        other: b.other.clone(),
                    })
                }
            }
        };
        Ok(Rewrapped {
            placement: wrap,
            bounds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn example_zip(name: &str) -> Vec<u8> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../examples/{name}.vtry"));
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

    #[test]
    fn folder_form_round_trips() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/hoodie.vtry");
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
        assert!(p.settings.self_collision);
        assert_eq!(p.settings.self_rebuild_every, 4);
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
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/tshirt.vtry"),
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
                .join("../..")
                .join(path),
        )
        .unwrap()
    }

    /// The test avatar's mesh as the app bundles it (`export-app-assets`: avatar/body.glb).
    fn body_glb() -> Vec<u8> {
        let doc = Document::open(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/tshirt.vtry"),
        )
        .unwrap()
        .doc;
        let avatar = doc.project_avatar().unwrap();
        doc.files[&avatar.mesh].bytes.clone()
    }

    /// M7's done-when, in Rust: the FreeSewing T-shirt's bare DXF becomes a project that the
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
            "tshirt.dxf",
            &asset("assets/garments/tshirt/tshirt.dxf"),
            None,
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
}
