// SPDX-License-Identifier: AGPL-3.0-or-later
//! DXF-AAMA round trip (M13): exporting a sample's garment and converting the exported DXF
//! with the sample's own garment.toml gives the sample's garment again: the same pieces, nodes
//! (ids, types, names), notches, folds, grain, internal lines, cuts and seams, every length
//! within 0.01 mm. The sidecar refers to landmarks by number, so this also checks that the
//! export keeps their order.

use drape_assets::{aama_export, convert, garment::Garment as DxfGarment};
use serde_json::Value;
use vitryne_format::Document;

const TOL_MM: f64 = 0.01;

/// Differences between two JSON values, numbers within `TOL_MM`.
fn diff(a: &Value, b: &Value, at: &str, out: &mut Vec<String>) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if (x - y).abs() > TOL_MM {
                out.push(format!("{at}: {x} vs {y}"));
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{at}: {} vs {} items", x.len(), y.len()));
                return;
            }
            for (k, (p, q)) in x.iter().zip(y).enumerate() {
                diff(p, q, &format!("{at}[{k}]"), out);
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys().filter(|k| !x.contains_key(*k))) {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => diff(p, q, &format!("{at}.{k}"), out),
                    _ => out.push(format!("{at}.{k}: only on one side")),
                }
            }
        }
        _ if a != b => out.push(format!("{at}: {a} vs {b}")),
        _ => {}
    }
}

fn round_trip(name: &str) {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let doc = Document::open(std::path::Path::new(&format!(
        "{root}/examples/{name}.vtry"
    )))
    .unwrap()
    .doc;
    let out = aama_export::export_document(&doc).unwrap();
    let toml =
        std::fs::read_to_string(format!("{root}/assets/garments/{name}/garment.toml")).unwrap();
    let again = DxfGarment::load(&toml, &out.text).unwrap();
    assert!(
        again.report.warnings.is_empty(),
        "{name}: {:?}",
        again.report.warnings
    );
    let opts = convert::ConvertOptions {
        body_glb: Vec::new(),
        dxf_file_name: format!("{name}.dxf"),
        include_dxf: None,
    };
    let converted = convert::convert(&again, &opts).unwrap();
    let mut problems = Vec::new();
    diff(
        &serde_json::to_value(&doc.garments[0]).unwrap(),
        &serde_json::to_value(&converted.garments[0]).unwrap(),
        name,
        &mut problems,
    );
    assert!(
        problems.is_empty(),
        "{name}: {} differences, first: {:#?}",
        problems.len(),
        &problems[..problems.len().min(20)]
    );
}

#[test]
fn tshirt() {
    round_trip("tshirt");
}

#[test]
fn trousers() {
    round_trip("trousers");
}

#[test]
fn hoodie() {
    round_trip("hoodie");
}
