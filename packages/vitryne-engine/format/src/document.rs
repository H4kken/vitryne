// SPDX-License-Identifier: AGPL-3.0-or-later
//! A whole file in memory: its entities, typed, plus every other part as bytes.

use std::collections::BTreeMap;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    Error, FORMAT_VERSION, GENERATOR, Id, MIN_READER_VERSION, SUPPORTED_EXTENSIONS,
    container::{self, Entries},
    json,
    manifest::{Kind, MEDIA_JSON, Manifest, PartEntry, ROLE_CACHE},
    migrate::{self, MIGRATIONS, Migration, Raw},
    model::*,
    validate::{self, Report},
};

/// A part that isn't an entity: an avatar mesh, a kept original, a cached drape, or a part this
/// reader doesn't know (kept and written back as is).
#[derive(Debug, Clone, PartialEq)]
pub struct File {
    pub media_type: String,
    /// `cache` or `source`, or none.
    pub role: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub kind: Kind,
    pub project: Option<Project>,
    /// In manifest order.
    pub garments: Vec<Garment>,
    pub fabrics: Vec<Fabric>,
    pub appearances: Vec<Appearance>,
    pub avatars: Vec<Avatar>,
    pub view: Option<View>,
    /// Every other part, by path.
    pub files: BTreeMap<String, File>,
    pub generator: Option<String>,
    pub extensions_used: Vec<String>,
    pub extensions_required: Vec<String>,
    /// The versions written: this crate's, or a newer file's own, kept as they were
    /// (FORMAT.md, Versions and migrations).
    pub format_version: u32,
    pub min_reader_version: u32,
    /// Unknown members of the manifest, and of each part's manifest entry.
    pub manifest_other: Other,
    pub part_other: BTreeMap<String, Other>,
}

/// A document and what the reader noticed without refusing the file.
#[derive(Debug)]
pub struct Opened {
    pub doc: Document,
    pub warnings: Vec<String>,
}

pub fn garment_path(id: &Id) -> String {
    format!("garments/{id}.json")
}
pub fn fabric_path(id: &Id) -> String {
    format!("fabrics/{id}.json")
}
pub fn appearance_path(id: &Id) -> String {
    format!("appearances/{id}.json")
}
pub fn avatar_path(id: &Id) -> String {
    format!("avatars/{id}/avatar.json")
}

/// `list` with `name` in it (kept where it was, else at the end) or left out.
fn with_extension(list: &[String], name: &str, on: bool) -> Vec<String> {
    let mut out: Vec<String> = list.iter().filter(|e| on || *e != name).cloned().collect();
    if on && !out.iter().any(|e| e == name) {
        out.push(name.into());
    }
    out
}

/// What an entity path holds.
enum Slot {
    Project,
    View,
    Garment,
    Fabric,
    Appearance,
    Avatar,
}

fn slot(path: &str) -> Option<Slot> {
    let segs: Vec<&str> = path.split('/').collect();
    match segs.as_slice() {
        ["project.json"] => Some(Slot::Project),
        ["view.json"] => Some(Slot::View),
        ["garments", f] if f.ends_with(".json") => Some(Slot::Garment),
        ["fabrics", f] if f.ends_with(".json") => Some(Slot::Fabric),
        ["appearances", f] if f.ends_with(".json") => Some(Slot::Appearance),
        [_, _, "avatar.json"] if segs[0] == "avatars" => Some(Slot::Avatar),
        _ => None,
    }
}

impl Document {
    pub fn new(kind: Kind) -> Self {
        Self {
            kind,
            project: None,
            garments: Vec::new(),
            fabrics: Vec::new(),
            appearances: Vec::new(),
            avatars: Vec::new(),
            view: None,
            files: BTreeMap::new(),
            generator: Some(GENERATOR.into()),
            extensions_used: Vec::new(),
            extensions_required: Vec::new(),
            format_version: FORMAT_VERSION,
            min_reader_version: MIN_READER_VERSION,
            manifest_other: Other::new(),
            part_other: BTreeMap::new(),
        }
    }

    pub fn garment(&self, id: &Id) -> Option<&Garment> {
        self.garments.iter().find(|g| &g.id == id)
    }
    pub fn fabric(&self, id: &Id) -> Option<&Fabric> {
        self.fabrics.iter().find(|f| &f.id == id)
    }
    pub fn appearance(&self, id: &Id) -> Option<&Appearance> {
        self.appearances.iter().find(|a| &a.id == id)
    }
    pub fn avatar(&self, id: &Id) -> Option<&Avatar> {
        self.avatars.iter().find(|a| &a.id == id)
    }
    /// The avatar the project's garments are draped on.
    pub fn project_avatar(&self) -> Option<&Avatar> {
        self.avatar(&self.project.as_ref()?.avatar)
    }

    /// Checks the rules the schemas can't express (FORMAT.md): references, unique ids, what each
    /// kind holds. Writing refuses a document with errors; reading refuses a file with errors.
    pub fn validate(&self) -> Report {
        validate::check(self)
    }

    // ---- reading ------------------------------------------------------------------------

    pub fn from_zip(bytes: &[u8]) -> Result<Opened, Error> {
        Self::from_entries(container::read_zip(bytes)?)
    }

    pub fn from_entries(entries: Entries) -> Result<Opened, Error> {
        read_with(entries, FORMAT_VERSION, MIGRATIONS)
    }

    /// A `.vtry`-family zip, or the same layout as a folder.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn open(path: &std::path::Path) -> Result<Opened, Error> {
        let entries = if path.is_dir() {
            container::read_dir(path)?
        } else {
            let bytes =
                std::fs::read(path).map_err(|e| Error::Io(format!("{}: {e}", path.display())))?;
            container::read_zip(&bytes)?
        };
        Self::from_entries(entries)
    }

    // ---- writing ------------------------------------------------------------------------

    /// Every file of the container, `mimetype` and `manifest.json` first. Lengths are rounded to
    /// 0.001 mm and hashes computed fresh.
    pub fn to_entries(&self) -> Result<Vec<(String, Vec<u8>)>, Error> {
        let report = self.validate();
        if !report.errors.is_empty() {
            return Err(Error::Invalid(report.errors));
        }
        fn part<T: Serialize>(v: &T) -> Vec<u8> {
            json::to_pretty(&serde_json::to_value(v).expect("entities serialize")).into_bytes()
        }
        let mut parts: Vec<(String, String, Option<String>, Vec<u8>)> = Vec::new();
        let mut entity = |path: String, bytes: Vec<u8>| {
            parts.push((path, MEDIA_JSON.into(), None, bytes));
        };
        if let Some(p) = &self.project {
            entity("project.json".into(), part(p));
        }
        for g in &self.garments {
            let mut g = g.clone();
            g.round_lengths();
            entity(garment_path(&g.id), part(&g));
        }
        for f in &self.fabrics {
            let mut f = f.clone();
            f.round_lengths();
            entity(fabric_path(&f.id), part(&f));
        }
        for a in &self.appearances {
            entity(appearance_path(&a.id), part(a));
        }
        for a in &self.avatars {
            let mut a = a.clone();
            a.round_lengths();
            entity(avatar_path(&a.id), part(&a));
        }
        if let Some(v) = &self.view {
            let mut v = v.clone();
            v.round_lengths();
            entity("view.json".into(), part(&v));
        }
        for (path, f) in &self.files {
            parts.push((
                path.clone(),
                f.media_type.clone(),
                f.role.clone(),
                f.bytes.clone(),
            ));
        }
        // Official extensions are listed by what the file holds, not by what it was read with.
        let curves = self.garments.iter().any(Garment::uses_curves);
        let manifest = Manifest {
            format: "vitryne".into(),
            kind: self.kind,
            format_version: self.format_version,
            min_reader_version: self.min_reader_version,
            generator: self.generator.clone(),
            parts: parts
                .iter()
                .map(|(path, media_type, role, bytes)| PartEntry {
                    path: path.clone(),
                    media_type: media_type.clone(),
                    sha256: Some(sha256_hex(bytes)),
                    role: role.clone(),
                    other: self.part_other.get(path).cloned().unwrap_or_default(),
                })
                .collect(),
            extensions_used: with_extension(&self.extensions_used, EXT_CURVES, curves),
            extensions_required: with_extension(&self.extensions_required, EXT_CURVES, curves),
            other: self.manifest_other.clone(),
        };
        let mut out = vec![
            (
                "mimetype".into(),
                self.kind.media_type().as_bytes().to_vec(),
            ),
            ("manifest.json".into(), part(&manifest)),
        ];
        out.extend(parts.into_iter().map(|(p, _, _, b)| (p, b)));
        Ok(out)
    }

    pub fn to_zip(&self) -> Result<Vec<u8>, Error> {
        container::write_zip(&self.to_entries()?)
    }

    /// Writes a zip.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn save(&self, path: &std::path::Path) -> Result<(), Error> {
        let bytes = self.to_zip()?;
        std::fs::write(path, bytes).map_err(|e| Error::Io(format!("{}: {e}", path.display())))
    }

    /// Writes the folder form (see `container::write_dir` for what happens to an existing one).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn save_folder(&self, dir: &std::path::Path) -> Result<(), Error> {
        container::write_dir(dir, &self.to_entries()?)
    }
}

pub fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

/// Reads entries as a reader of format version `current` with these migrations would (the
/// tests use it to pretend the format is at a later version).
pub(crate) fn read_with(
    entries: Entries,
    current: u32,
    migrations: &[Migration],
) -> Result<Opened, Error> {
    let bad = |m: String| Error::Malformed(m);
    let mut warnings = entries.warnings;
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for (p, d) in entries.files {
        container::check_path(&p)?;
        if files.insert(p.clone(), d).is_some() {
            return Err(bad(format!("{p} appears twice")));
        }
    }
    let mimetype = files
        .remove("mimetype")
        .ok_or_else(|| bad("no 'mimetype' entry".into()))?;
    let manifest_bytes = files
        .remove("manifest.json")
        .ok_or_else(|| bad("no manifest.json".into()))?;
    let manifest: Value =
        serde_json::from_slice(&manifest_bytes).map_err(|e| bad(format!("manifest.json: {e}")))?;
    if manifest["format"] != "vitryne" {
        return Err(bad("manifest.json: format is not \"vitryne\"".into()));
    }
    let version = |k: &str| {
        manifest[k]
            .as_u64()
            .map(|v| v as u32)
            .ok_or_else(|| bad(format!("manifest.json: {k} missing")))
    };
    let (file_version, min_reader) = (version("formatVersion")?, version("minReaderVersion")?);
    if min_reader > current {
        return Err(Error::TooNew { min_reader });
    }

    // Raw JSON of every listed JSON part, then migrations.
    let mut raw = Raw {
        manifest,
        parts: BTreeMap::new(),
    };
    for p in raw.manifest["parts"].as_array().into_iter().flatten() {
        let (Some(path), Some(media)) = (p["path"].as_str(), p["mediaType"].as_str()) else {
            continue;
        };
        if let Some(data) = files.get(path) {
            if let Some(h) = p["sha256"].as_str()
                && h != sha256_hex(data)
            {
                warnings.push(format!(
                    "{path}: sha256 doesn't match the manifest (edited by hand?)"
                ));
            }
            if media == MEDIA_JSON {
                let v = serde_json::from_slice(data).map_err(|e| bad(format!("{path}: {e}")))?;
                raw.parts.insert(path.to_string(), v);
            }
        }
    }
    let migrated = file_version < current;
    if migrated {
        migrate::run(&mut raw, file_version, migrations).map_err(bad)?;
    }

    let manifest: Manifest = serde_json::from_value(raw.manifest.clone())
        .map_err(|e| bad(format!("manifest.json: {e}")))?;
    if mimetype != manifest.kind.media_type().as_bytes() {
        return Err(bad(format!(
            "mimetype is {:?}, kind {:?} needs {:?}",
            String::from_utf8_lossy(&mimetype),
            manifest.kind,
            manifest.kind.media_type()
        )));
    }
    let unsupported: Vec<String> = manifest
        .extensions_required
        .iter()
        .filter(|e| !SUPPORTED_EXTENSIONS.contains(&e.as_str()))
        .cloned()
        .collect();
    if !unsupported.is_empty() {
        return Err(Error::Unsupported(unsupported));
    }

    let mut doc = Document::new(manifest.kind);
    doc.generator = manifest.generator.clone();
    doc.extensions_used = manifest.extensions_used.clone();
    doc.extensions_required = manifest.extensions_required.clone();
    doc.manifest_other = manifest.other.clone();
    if file_version > current {
        (doc.format_version, doc.min_reader_version) = (file_version, min_reader);
    } else {
        (doc.format_version, doc.min_reader_version) = (current, MIN_READER_VERSION.min(current));
    }
    fn parse<T: DeserializeOwned>(path: &str, v: &Value) -> Result<T, Error> {
        serde_json::from_value(v.clone()).map_err(|e| Error::Malformed(format!("{path}: {e}")))
    }
    let mut listed = std::collections::BTreeSet::new();
    for entry in &manifest.parts {
        container::check_path(&entry.path)?;
        if !listed.insert(entry.path.clone()) {
            return Err(bad(format!("{}: listed twice in the manifest", entry.path)));
        }
        if !entry.other.is_empty() {
            doc.part_other
                .insert(entry.path.clone(), entry.other.clone());
        }
        let path = entry.path.as_str();
        let json = raw.parts.get(path);
        let is_json = entry.media_type == MEDIA_JSON;
        match (slot(path), json) {
            (Some(s), Some(v)) if is_json => match s {
                Slot::Project => doc.project = Some(parse(path, v)?),
                Slot::View => doc.view = Some(parse(path, v)?),
                Slot::Garment => {
                    let g: Garment = parse(path, v)?;
                    if path != garment_path(&g.id) {
                        return Err(bad(format!("{path}: must be at {}", garment_path(&g.id))));
                    }
                    doc.garments.push(g);
                }
                Slot::Fabric => {
                    let f: Fabric = parse(path, v)?;
                    if path != fabric_path(&f.id) {
                        return Err(bad(format!("{path}: must be at {}", fabric_path(&f.id))));
                    }
                    doc.fabrics.push(f);
                }
                Slot::Appearance => {
                    let a: Appearance = parse(path, v)?;
                    if path != appearance_path(&a.id) {
                        return Err(bad(format!(
                            "{path}: must be at {}",
                            appearance_path(&a.id)
                        )));
                    }
                    doc.appearances.push(a);
                }
                Slot::Avatar => {
                    let a: Avatar = parse(path, v)?;
                    if path != avatar_path(&a.id) {
                        return Err(bad(format!("{path}: must be at {}", avatar_path(&a.id))));
                    }
                    doc.avatars.push(a);
                }
            },
            (Some(_), _) if !is_json => {
                return Err(bad(format!("{path}: must be {MEDIA_JSON}")));
            }
            _ => {
                let bytes = match (files.get(path), json) {
                    (Some(_), Some(v)) if migrated => json::to_pretty(v).into_bytes(),
                    (Some(b), _) => b.clone(),
                    (None, _) if entry.role.as_deref() == Some(ROLE_CACHE) => {
                        warnings.push(format!("{path}: cache part missing (ignored)"));
                        continue;
                    }
                    (None, _) => return Err(bad(format!("{path}: listed but missing"))),
                };
                doc.files.insert(
                    path.to_string(),
                    File {
                        media_type: entry.media_type.clone(),
                        role: entry.role.clone(),
                        bytes,
                    },
                );
            }
        }
    }
    for path in files.keys().filter(|p| !listed.contains(*p)) {
        warnings.push(format!("{path}: not listed in the manifest (ignored)"));
    }

    let report = doc.validate();
    if !report.errors.is_empty() {
        return Err(Error::Invalid(report.errors));
    }
    warnings.extend(report.warnings);
    Ok(Opened { doc, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pretend the format is at version 2, whose only change renamed the fabric's
    /// `frictionCoefficient` (v1) to `friction`: a v1 file is migrated on its raw JSON, then
    /// parsed, and saving writes version 2.
    #[test]
    fn migrations_run_before_parsing() {
        fn rename(raw: &mut Raw) -> Result<(), String> {
            for (path, v) in raw.parts.iter_mut() {
                if path.starts_with("fabrics/") {
                    let o = v.as_object_mut().ok_or("fabric is not an object")?;
                    let f = o
                        .remove("frictionCoefficient")
                        .ok_or("no frictionCoefficient")?;
                    o.insert("friction".into(), f);
                }
            }
            Ok(())
        }
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../assets/examples/tshirt.vtry");
        let mut files = container::read_dir(&dir).unwrap().files;
        for (p, b) in &mut files {
            if p == "manifest.json" {
                let mut m: Value = serde_json::from_slice(b).unwrap();
                m["formatVersion"] = 1.into();
                *b = serde_json::to_vec(&m).unwrap();
            }
            if p.starts_with("fabrics/") {
                *b = String::from_utf8(b.clone())
                    .unwrap()
                    .replace("\"friction\"", "\"frictionCoefficient\"")
                    .into_bytes();
            }
        }
        let entries = || Entries {
            files: files.clone(),
            warnings: Vec::new(),
        };
        // As v1 (no migration) the file is malformed: friction is missing.
        assert!(read_with(entries(), 1, &[]).is_err());
        let opened = read_with(entries(), 2, &[rename]).unwrap();
        assert_eq!(opened.doc.fabrics[0].friction, 0.3);
        assert_eq!(opened.doc.format_version, 2);
        let manifest = &opened.doc.to_entries().unwrap()[1].1;
        let m: Value = serde_json::from_slice(manifest).unwrap();
        assert_eq!(m["formatVersion"], 2);
        // A failing migration says which step failed.
        let e = read_with(entries(), 3, &[rename, |_| Err("boom".into())]).unwrap_err();
        assert!(e.to_string().contains("v2 to v3: boom"), "{e}");
    }
}
