// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor worker's project file (docs/ARCHITECTURE.md, Editor): a `.vtry` opened from
//! bytes, its entities handed to the UI as JSON and taken back after each edit (validated, so
//! the worker only ever holds a valid document), saved with a read-back check, and turned into
//! what the engine drapes. Plain Rust, so it is tested natively; `lib.rs` exposes it to the
//! worker.

use drape_assets::project::{ProjectGarment, avatar_mesh};
use drape_core::{
    body::{BodyMesh, SdfParams},
    engine::{Fabric, GarmentDesc},
    scene::SheetScene,
    sim::SimSettings,
};
use serde::Serialize;
use vitryne_format::{Document, Entities, Kind};

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
        let garment = pg.build(pg.edge_for_vertices(vertices)?)?;
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
            },
            fabric: pg.material(),
            garment,
            settings,
            avatar,
            mesh,
            sdf,
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
}
