// SPDX-License-Identifier: AGPL-3.0-or-later
//! Migrations (file-format.md, Versions and migrations): pure JSON-to-JSON functions, one per
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
pub const MIGRATIONS: &[Migration] = &[v1_to_v2, v2_to_v3, v3_to_v4, v4_to_v5];

/// Version 2 added appearances (`appearances/<id>.json`, `appearance` on garments and cuts,
/// `project.appearances`), all optional: a v1 file is already a valid v2 file.
fn v1_to_v2(_: &mut Raw) -> Result<(), String> {
    Ok(())
}

/// Version 3 added `appearance` on fabrics (how a fabric looks by default), optional, and lets a
/// fabric file hold the appearances its fabrics use: a v2 file is already a valid v3 file.
fn v2_to_v3(_: &mut Raw) -> Result<(), String> {
    Ok(())
}

/// Version 4 gave every garment a `stack` (every cut once, closest to the body first) and wraps
/// an optional `offset`. The stack starts as the cuts ordered by the radius each starts at
/// (`follow`s resolved: the followed cut's radius plus `lift`), ties in file order, a cut that
/// follows another never before it, so a file looks as it did. `Garment::default_stack` makes
/// the same order for the cuts the apps write.
fn v3_to_v4(raw: &mut Raw) -> Result<(), String> {
    for (path, part) in raw.parts.iter_mut() {
        if !path.starts_with("garments/") || part.get("stack").is_some() {
            continue;
        }
        let stack = stack_of(part).map_err(|e| format!("{path}: {e}"))?;
        part["stack"] = Value::Array(stack.into_iter().map(Value::String).collect());
    }
    Ok(())
}

/// Version 5 added `drape` to `view.json` (whether the drape was paused or fast when the project
/// was left), optional: a v4 file is already a valid v5 file.
fn v4_to_v5(_: &mut Raw) -> Result<(), String> {
    Ok(())
}

/// The cut ids of a raw garment, nearest the body first (see `v3_to_v4`).
fn stack_of(garment: &Value) -> Result<Vec<String>, String> {
    let cuts: Vec<&Value> = garment["pieces"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|p| p["cuts"].as_array().into_iter().flatten())
        .collect();
    let id = |c: &Value| -> Result<String, String> {
        c["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "a cut has no id".to_string())
    };
    let ids = cuts.iter().map(|c| id(c)).collect::<Result<Vec<_>, _>>()?;
    let followed = |c: &Value| -> Option<usize> {
        let p = &c["placement"];
        (p["type"] == "follow")
            .then(|| {
                ids.iter()
                    .position(|i| Some(i.as_str()) == p["cut"].as_str())
            })
            .flatten()
    };
    let radius = |start: usize| {
        let (mut c, mut sum) = (start, 0.0);
        for _ in 0..=cuts.len() {
            let p = &cuts[c]["placement"];
            if p["type"] != "follow" {
                return sum + p["radius"].as_f64().unwrap_or(0.0);
            }
            sum += p["lift"].as_f64().unwrap_or(0.0);
            match followed(cuts[c]) {
                Some(next) => c = next,
                None => break,
            }
        }
        sum
    };
    let mut left: Vec<usize> = (0..cuts.len()).collect();
    left.sort_by(|&a, &b| radius(a).total_cmp(&radius(b)).then(a.cmp(&b)));
    let mut out: Vec<usize> = Vec::with_capacity(left.len());
    while !left.is_empty() {
        let ready = left
            .iter()
            .position(|&i| followed(cuts[i]).is_none_or(|p| out.contains(&p)));
        out.push(left.remove(ready.unwrap_or(0)));
    }
    Ok(out.into_iter().map(|i| ids[i].clone()).collect())
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
