// SPDX-License-Identifier: AGPL-3.0-or-later
//! The container: a zip archive, or the same layout as a folder (file-format.md, Container). This
//! module only moves named byte blobs in and out; `Document` gives them meaning.

use std::io::{Cursor, Read, Write};

use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::Error;

/// The files of a container in their stored order, plus anything odd about how they were stored.
#[derive(Debug, Default)]
pub struct Entries {
    pub files: Vec<(String, Vec<u8>)>,
    pub warnings: Vec<String>,
}

/// Relative, `/`-separated, no `..`, no empty or `.` segments.
pub fn check_path(p: &str) -> Result<(), Error> {
    let ok = !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && p.split('/').all(|s| !s.is_empty() && s != "." && s != "..");
    if ok {
        Ok(())
    } else {
        Err(Error::Malformed(format!("bad part path {p:?}")))
    }
}

pub fn read_zip(bytes: &[u8]) -> Result<Entries, Error> {
    let bad = |e: zip::result::ZipError| Error::Malformed(format!("not a readable zip: {e}"));
    let mut ar = ZipArchive::new(Cursor::new(bytes)).map_err(bad)?;
    let mut out = Entries::default();
    for i in 0..ar.len() {
        let mut f = ar.by_index(i).map_err(bad)?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().map_err(bad)?.to_string();
        check_path(&name)?;
        if i == 0 && (name != "mimetype" || f.compression() != CompressionMethod::Stored) {
            out.warnings
                .push("the first zip entry should be 'mimetype', stored uncompressed".into());
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data)
            .map_err(|e| Error::Malformed(format!("{name}: {e}")))?;
        out.files.push((name, data));
    }
    Ok(out)
}

/// `mimetype` first and stored with no extra field (so the media type sits at byte 38), JSON
/// deflated, everything else stored. Timestamps are fixed, so the same content gives the same
/// bytes.
pub fn write_zip(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, Error> {
    let io = |e: std::io::Error| Error::Io(e.to_string());
    let zerr = |e: zip::result::ZipError| Error::Io(e.to_string());
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opts = |method| {
        SimpleFileOptions::default()
            .compression_method(method)
            .last_modified_time(DateTime::default())
            .unix_permissions(0o644)
    };
    let mut ordered: Vec<&(String, Vec<u8>)> = files.iter().collect();
    ordered.sort_by_key(|(p, _)| p != "mimetype");
    for (path, data) in ordered {
        check_path(path)?;
        let method = if path.ends_with(".json") {
            CompressionMethod::Deflated
        } else {
            CompressionMethod::Stored
        };
        w.start_file(path.as_str(), opts(method)).map_err(zerr)?;
        w.write_all(data).map_err(io)?;
    }
    Ok(w.finish().map_err(zerr)?.into_inner())
}

/// Every file under `dir`, `mimetype` and `manifest.json` first, the rest by path.
#[cfg(not(target_arch = "wasm32"))]
pub fn read_dir(dir: &std::path::Path) -> Result<Entries, Error> {
    fn walk(
        root: &std::path::Path,
        dir: &std::path::Path,
        out: &mut Vec<(String, Vec<u8>)>,
    ) -> Result<(), Error> {
        let io = |e: std::io::Error| Error::Io(format!("{}: {e}", dir.display()));
        for e in std::fs::read_dir(dir).map_err(io)? {
            let p = e.map_err(io)?.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                walk(root, &p, out)?;
            } else {
                let rel = p
                    .strip_prefix(root)
                    .unwrap()
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                let data = std::fs::read(&p).map_err(|e| Error::Io(format!("{rel}: {e}")))?;
                out.push((rel, data));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(dir, dir, &mut files)?;
    files.sort_by(|a, b| {
        let rank = |p: &str| match p {
            "mimetype" => 0,
            "manifest.json" => 1,
            _ => 2,
        };
        (rank(&a.0), &a.0).cmp(&(rank(&b.0), &b.0))
    });
    Ok(Entries {
        files,
        warnings: Vec::new(),
    })
}

/// Writes the files into `dir`. If `dir` already holds a Vitryne file, the parts its manifest
/// lists that aren't written again are removed; anything else in it is left alone. A non-empty
/// folder that isn't a Vitryne file is refused.
#[cfg(not(target_arch = "wasm32"))]
pub fn write_dir(dir: &std::path::Path, files: &[(String, Vec<u8>)]) -> Result<(), Error> {
    let io = |e: std::io::Error| Error::Io(format!("{}: {e}", dir.display()));
    let old_manifest = dir.join("manifest.json");
    if dir.exists() {
        let empty = std::fs::read_dir(dir).map_err(io)?.next().is_none();
        if !empty && !old_manifest.exists() {
            return Err(Error::Io(format!(
                "{}: not empty and not a Vitryne folder",
                dir.display()
            )));
        }
    }
    if let Ok(text) = std::fs::read_to_string(&old_manifest)
        && let Ok(m) = serde_json::from_str::<serde_json::Value>(&text)
    {
        for p in m["parts"].as_array().into_iter().flatten() {
            let Some(path) = p["path"].as_str() else {
                continue;
            };
            if check_path(path).is_ok() && !files.iter().any(|(f, _)| f == path) {
                let _ = std::fs::remove_file(dir.join(path));
                // Drop folders this left empty (avatars/<id>/).
                let mut d = dir.join(path);
                while d.pop() && d != dir && std::fs::remove_dir(&d).is_ok() {}
            }
        }
    }
    for (path, data) in files {
        check_path(path)?;
        let p = dir.join(path);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(io)?;
        }
        std::fs::write(&p, data).map_err(io)?;
    }
    Ok(())
}
