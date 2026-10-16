// SPDX-License-Identifier: AGPL-3.0-or-later
//! Migrations (FORMAT.md, Versions and migrations): pure JSON-to-JSON functions, one per
//! version step, run on the raw JSON of a file before it is parsed into types, so the types
//! only ever exist for the current version. Never delete one; the tests keep a fixture file for
//! every past version.

use std::collections::BTreeMap;

use serde_json::Value;

/// A file's JSON before parsing: the manifest and every JSON part, by path.
#[derive(Debug, Clone, PartialEq)]
pub struct Raw {
    pub manifest: Value,
    pub parts: BTreeMap<String, Value>,
}

/// Migrates a file from version n to n + 1.
pub type Migration = fn(&mut Raw) -> Result<(), String>;

/// Every migration, in order: `MIGRATIONS[k]` takes a file from version k + 1 to k + 2.
pub const MIGRATIONS: &[Migration] = &[v1_to_v2];

/// Version 2 added appearances (`appearances/<id>.json`, `appearance` on garments and cuts,
/// `project.appearances`), all optional: a v1 file is already a valid v2 file.
fn v1_to_v2(_: &mut Raw) -> Result<(), String> {
    Ok(())
}

/// Runs the steps from `from` to `migrations.len() + 1` and records the new version in the
/// manifest. Returns the version reached.
pub fn run(raw: &mut Raw, from: u32, migrations: &[Migration]) -> Result<u32, String> {
    let to = migrations.len() as u32 + 1;
    for v in from.max(1)..to {
        migrations[v as usize - 1](raw)
            .map_err(|e| format!("migrating v{v} to v{}: {e}", v + 1))?;
        raw.manifest["formatVersion"] = v.saturating_add(1).into();
    }
    Ok(to.max(from))
}
