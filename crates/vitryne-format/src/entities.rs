// SPDX-License-Identifier: AGPL-3.0-or-later
//! A document's entities as plain JSON, for an editor that holds the file's own JSON and edits
//! it (docs/ARCHITECTURE.md, Document model): `entities` gives it out, `set_entities` takes an
//! edited copy back, parses and validates it, and replaces the entities only if it is valid.
//! Everything that isn't an entity (binary parts, manifest members, versions) stays here.
//!
//! JavaScript has one number type, so `1.0` comes back as `1`. Where a number is unchanged
//! (same path, same value) the previous JSON's spelling is kept, so an unknown member written
//! as `1.0` is still written as `1.0` after an edit elsewhere.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Document, Error, Kind, model::*, validate::Report};

/// The JSON an editor holds: every entity of the file, as written (before rounding).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entities {
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<Value>,
    pub garments: Vec<Value>,
    pub fabrics: Vec<Value>,
    /// Absent before format version 2, and when there are none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub appearances: Vec<Value>,
    pub avatars: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<Value>,
}

fn to_value<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("entities serialize")
}

/// Where `new` holds a number equal to the one at the same place in `old`, keeps `old`'s
/// spelling (`1.0` rather than `1`).
fn keep_number_spelling(new: &mut Value, old: &Value) {
    match (new, old) {
        (Value::Number(n), Value::Number(o)) if n.as_f64() == o.as_f64() => {
            *n = o.clone();
        }
        (Value::Array(n), Value::Array(o)) => {
            for (n, o) in n.iter_mut().zip(o) {
                keep_number_spelling(n, o);
            }
        }
        (Value::Object(n), Value::Object(o)) => {
            for (k, n) in n.iter_mut() {
                if let Some(o) = o.get(k) {
                    keep_number_spelling(n, o);
                }
            }
        }
        _ => {}
    }
}

/// Matches entities by `id` (a list can be reordered or grow).
fn keep_spelling_by_id(new: &mut [Value], old: &[Value]) {
    for n in new {
        if let Some(o) = old
            .iter()
            .find(|o| o.get("id").is_some() && o["id"] == n["id"])
        {
            keep_number_spelling(n, o);
        }
    }
}

impl Document {
    pub fn entities(&self) -> Entities {
        Entities {
            kind: self.kind,
            project: self.project.as_ref().map(to_value),
            garments: self.garments.iter().map(to_value).collect(),
            fabrics: self.fabrics.iter().map(to_value).collect(),
            appearances: self.appearances.iter().map(to_value).collect(),
            avatars: self.avatars.iter().map(to_value).collect(),
            view: self.view.as_ref().map(to_value),
        }
    }

    /// Replaces the entities with `e`, if it parses and the result is valid (the same check as
    /// reading a file). On error the document is unchanged. Returns the warnings.
    pub fn set_entities(&mut self, mut e: Entities) -> Result<Vec<String>, Error> {
        if e.kind != self.kind {
            return Err(Error::Invalid(vec![format!(
                "a {:?} file can't become a {:?} file",
                self.kind, e.kind
            )]));
        }
        let old = self.entities();
        if let (Some(n), Some(o)) = (&mut e.project, &old.project) {
            keep_number_spelling(n, o);
        }
        if let (Some(n), Some(o)) = (&mut e.view, &old.view) {
            keep_number_spelling(n, o);
        }
        keep_spelling_by_id(&mut e.garments, &old.garments);
        keep_spelling_by_id(&mut e.fabrics, &old.fabrics);
        keep_spelling_by_id(&mut e.appearances, &old.appearances);
        keep_spelling_by_id(&mut e.avatars, &old.avatars);

        fn parse<T: serde::de::DeserializeOwned>(what: &str, v: Value) -> Result<T, Error> {
            serde_json::from_value(v).map_err(|e| Error::Invalid(vec![format!("{what}: {e}")]))
        }
        fn parse_all<T: serde::de::DeserializeOwned>(
            what: &str,
            vs: Vec<Value>,
        ) -> Result<Vec<T>, Error> {
            vs.into_iter()
                .enumerate()
                .map(|(i, v)| parse(&format!("{what} {i}"), v))
                .collect()
        }
        let mut next = self.clone();
        next.project = e
            .project
            .map(|v| parse::<Project>("project", v))
            .transpose()?;
        next.view = e.view.map(|v| parse::<View>("view", v)).transpose()?;
        next.garments = parse_all("garment", e.garments)?;
        next.fabrics = parse_all("fabric", e.fabrics)?;
        next.appearances = parse_all("appearance", e.appearances)?;
        next.avatars = parse_all("avatar", e.avatars)?;
        let Report { errors, warnings } = next.validate();
        if !errors.is_empty() {
            return Err(Error::Invalid(errors));
        }
        *self = next;
        Ok(warnings)
    }

    /// `to_entries` (the folder form), read back and written again the same way, as
    /// `to_zip_checked` does for the zip.
    pub fn to_entries_checked(&self) -> Result<Vec<(String, Vec<u8>)>, Error> {
        let files = self.to_entries()?;
        let back = Document::from_entries(crate::container::Entries {
            files: files.clone(),
            warnings: Vec::new(),
        })
        .map_err(|e| Error::Invalid(vec![format!("the saved files don't read back: {e}")]))?;
        if back.doc.to_entries()? != files {
            return Err(Error::Invalid(vec![
                "the saved files read back differently (a writer bug: please report it)".into(),
            ]));
        }
        Ok(files)
    }

    /// `to_zip`, then the bytes read back and written again must give the same bytes; a save
    /// is only reported done after this check.
    pub fn to_zip_checked(&self) -> Result<Vec<u8>, Error> {
        let bytes = self.to_zip()?;
        let back = Document::from_zip(&bytes)
            .map_err(|e| Error::Invalid(vec![format!("the saved file doesn't read back: {e}")]))?;
        if back.doc.to_zip()? != bytes {
            return Err(Error::Invalid(vec![
                "the saved file reads back differently (a writer bug: please report it)".into(),
            ]));
        }
        Ok(bytes)
    }
}
