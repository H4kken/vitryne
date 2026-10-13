// SPDX-License-Identifier: AGPL-3.0-or-later
//! The format against its own rules, on the example projects (examples/*.vtry, folder form):
//! round trips, unknown data kept, version handling, malformed files refused, and every part
//! the writer produces valid against docs/format/schema/.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use vitryne_format::{
    Document, Error, FORMAT_VERSION, Kind,
    container::{self, Entries},
    glb,
};

const EXAMPLES: [&str; 3] = ["tshirt", "trousers", "hoodie"];

/// A file's JSON parts, parsed, by path.
type Parts = Vec<(String, Value)>;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn example(name: &str) -> PathBuf {
    root().join(format!("examples/{name}.vtry"))
}

fn entries(name: &str) -> Vec<(String, Vec<u8>)> {
    container::read_dir(&example(name)).unwrap().files
}

/// Opens edited entries; `edit` gets the parsed JSON of every JSON file by path.
fn open_edited(name: &str, edit: impl FnOnce(&mut Parts)) -> Result<Document, Error> {
    let mut files: Parts = entries(name)
        .into_iter()
        .filter(|(p, _)| p.ends_with(".json"))
        .map(|(p, b)| (p, serde_json::from_slice(&b).unwrap()))
        .collect();
    edit(&mut files);
    let mut out: Vec<(String, Vec<u8>)> = entries(name)
        .into_iter()
        .filter(|(p, _)| !p.ends_with(".json"))
        .collect();
    out.extend(
        files
            .into_iter()
            .map(|(p, v)| (p, serde_json::to_vec(&v).unwrap())),
    );
    Document::from_entries(Entries {
        files: out,
        warnings: Vec::new(),
    })
    .map(|o| o.doc)
}

fn part<'a>(files: &'a mut [(String, Value)], prefix: &str) -> &'a mut Value {
    &mut files
        .iter_mut()
        .find(|(p, _)| p.starts_with(prefix))
        .unwrap()
        .1
}

#[test]
fn examples_open_without_warnings() {
    for name in EXAMPLES {
        let o = Document::open(&example(name)).unwrap();
        assert!(o.warnings.is_empty(), "{name}: {:?}", o.warnings);
        assert_eq!(o.doc.kind, Kind::Project);
        let avatar = o.doc.project_avatar().unwrap();
        let mesh = glb::read(&o.doc.files[&avatar.mesh].bytes).unwrap();
        assert_eq!(
            (mesh.positions.len(), mesh.indices.len() / 3),
            (13_380, 26_756)
        );
    }
}

/// load -> save -> load gives the same document, and saving is byte-for-byte stable: the
/// examples are writer output, so writing them again reproduces every file.
#[test]
fn round_trip_is_identical() {
    for name in EXAMPLES {
        let doc = Document::open(&example(name)).unwrap().doc;
        let written = doc.to_entries().unwrap();
        let mut on_disk = entries(name);
        let mut sorted = written.clone();
        on_disk.sort();
        sorted.sort();
        assert_eq!(
            on_disk.iter().map(|f| &f.0).collect::<Vec<_>>(),
            sorted.iter().map(|f| &f.0).collect::<Vec<_>>()
        );
        for ((p, a), (_, b)) in on_disk.iter().zip(&sorted) {
            assert!(a == b, "{name}: {p} differs after a round trip");
        }
        let zip = doc.to_zip().unwrap();
        assert_eq!(
            zip,
            doc.to_zip().unwrap(),
            "{name}: zip output is not stable"
        );
        let back = Document::from_zip(&zip).unwrap();
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        assert_eq!(back.doc, doc, "{name}");
    }
}

#[test]
fn zip_starts_with_its_media_type() {
    let zip = Document::open(&example("tshirt"))
        .unwrap()
        .doc
        .to_zip()
        .unwrap();
    let media = Kind::Project.media_type().as_bytes();
    assert_eq!(&zip[30..38], b"mimetype");
    assert_eq!(&zip[38..38 + media.len()], media);
    // Stored: compression method 0 at offset 8 of the first local header.
    assert_eq!(&zip[8..10], &[0, 0]);
}

#[test]
fn unknown_members_parts_and_extensions_survive() {
    let doc = open_edited("tshirt", |files| {
        let m = part(files, "manifest.json");
        m["futureMember"] = json!({"a": 1});
        m["extensionsUsed"] = json!(["EXT_test"]);
        m["parts"].as_array_mut().unwrap().push(json!({
            "path": "future/thing.json", "mediaType": "application/json", "note": "kept"
        }));
        let g = part(files, "garments/");
        g["futureGarmentField"] = json!([1, 2, 3]);
        g["pieces"][0]["outline"][0]["extras"] = json!({"app": "data"});
        g["pieces"][0]["cuts"][0]["placement"]["extensions"] = json!({"EXT_test": {"x": 1}});
        g["seams"][0]["a"][0]["futureRunField"] = json!(true);
        let a = part(files, "avatars/");
        a["regions"]["torso"]["futureRegionField"] = json!("y");
        files.push(("future/thing.json".into(), json!({"hello": "world"})));
    })
    .unwrap();
    let again = Document::from_zip(&doc.to_zip().unwrap()).unwrap().doc;
    assert_eq!(again, doc);
    let g = serde_json::to_value(&again.garments[0]).unwrap();
    assert_eq!(g["futureGarmentField"], json!([1, 2, 3]));
    assert_eq!(
        g["pieces"][0]["outline"][0]["extras"],
        json!({"app": "data"})
    );
    assert_eq!(
        g["pieces"][0]["cuts"][0]["placement"]["extensions"]["EXT_test"],
        json!({"x": 1})
    );
    assert_eq!(g["seams"][0]["a"][0]["futureRunField"], json!(true));
    let a = serde_json::to_value(&again.avatars[0]).unwrap();
    assert_eq!(a["regions"]["torso"]["futureRegionField"], json!("y"));
    assert_eq!(again.manifest_other["futureMember"], json!({"a": 1}));
    assert_eq!(again.part_other["future/thing.json"]["note"], json!("kept"));
    assert_eq!(
        serde_json::from_slice::<Value>(&again.files["future/thing.json"].bytes).unwrap(),
        json!({"hello": "world"})
    );
}

#[test]
fn a_newer_file_opens_and_keeps_its_versions() {
    let doc = open_edited("tshirt", |files| {
        let m = part(files, "manifest.json");
        m["formatVersion"] = json!(FORMAT_VERSION + 3);
        m["minReaderVersion"] = json!(FORMAT_VERSION);
    })
    .unwrap();
    let again = Document::from_zip(&doc.to_zip().unwrap()).unwrap().doc;
    assert_eq!(
        (again.format_version, again.min_reader_version),
        (FORMAT_VERSION + 3, FORMAT_VERSION)
    );
}

#[test]
fn malformed_files_are_refused() {
    let refuse = |what: &str, edit: &dyn Fn(&mut Parts)| {
        let r = open_edited("tshirt", edit);
        assert!(r.is_err(), "{what}: opened");
        r.unwrap_err()
    };
    assert_eq!(
        refuse(
            "too new",
            &|f| part(f, "manifest.json")["minReaderVersion"] = json!(FORMAT_VERSION + 1)
        ),
        Error::TooNew {
            min_reader: FORMAT_VERSION + 1
        }
    );
    assert!(matches!(
        refuse("required extension", &|f| {
            let m = part(f, "manifest.json");
            m["extensionsUsed"] = json!(["VTRY_future"]);
            m["extensionsRequired"] = json!(["VTRY_future"]);
        }),
        Error::Unsupported(e) if e == ["VTRY_future"]
    ));
    let invalid = |what: &str, edit: &dyn Fn(&mut Parts), want: &str| {
        let e = refuse(what, edit).to_string();
        assert!(e.contains(want), "{what}: {e}");
    };
    invalid(
        "bad id",
        &|f| part(f, "garments/")["pieces"][0]["id"] = json!("front"),
        "not an id",
    );
    invalid(
        "missing field",
        &|f| {
            part(f, "fabrics/")
                .as_object_mut()
                .unwrap()
                .remove("density");
        },
        "density",
    );
    invalid(
        "seam to a node of another piece",
        &|f| {
            let g = part(f, "garments/");
            let other = g["pieces"][1]["outline"][0]["id"].clone();
            g["seams"][0]["a"][0]["from"] = other;
        },
        "run ends must be nodes",
    );
    invalid(
        "duplicate id",
        &|f| {
            let g = part(f, "garments/");
            let id = g["pieces"][0]["outline"][0]["id"].clone();
            g["pieces"][0]["outline"][1]["id"] = id;
        },
        "duplicate id",
    );
    invalid(
        "follow loop",
        &|f| {
            let g = part(f, "garments/");
            let (a, b) = (
                g["pieces"][0]["cuts"][0]["id"].clone(),
                g["pieces"][1]["cuts"][0]["id"].clone(),
            );
            g["pieces"][0]["cuts"][0]["placement"] =
                json!({"type": "follow", "cut": b, "lift": 1.0});
            g["pieces"][1]["cuts"][0]["placement"] =
                json!({"type": "follow", "cut": a, "lift": 1.0});
        },
        "follows itself",
    );
    invalid(
        "unknown edge type",
        &|f| part(f, "garments/")["pieces"][0]["outline"][0]["edge"]["type"] = json!("cubic"),
        "not supported",
    );
    invalid(
        "missing fabric",
        &|f| {
            let id = part(f, "project.json")["fabrics"][0].clone();
            part(f, "garments/")["fabric"] = json!("01a13cdb-0000-7000-8000-000000000000");
            let _ = id;
        },
        "has no part",
    );
    invalid(
        "wrong kind",
        &|f| part(f, "manifest.json")["kind"] = json!("fabric"),
        "mimetype",
    );
    invalid(
        "outline run without direction",
        &|f| {
            part(f, "garments/")["seams"][0]["a"][0]
                .as_object_mut()
                .unwrap()
                .remove("direction");
        },
        "needs a direction",
    );

    // Container problems.
    let mut files = entries("tshirt");
    files.retain(|(p, _)| p != "mimetype");
    assert!(
        Document::from_entries(Entries {
            files,
            warnings: vec![]
        })
        .is_err()
    );
    let mut files = entries("tshirt");
    files.retain(|(p, _)| !p.ends_with(".glb"));
    let e = Document::from_entries(Entries {
        files,
        warnings: vec![],
    })
    .unwrap_err();
    assert!(e.to_string().contains("listed but missing"), "{e}");
    let mut files = entries("tshirt");
    files.push(("../evil".into(), vec![]));
    assert!(
        Document::from_entries(Entries {
            files,
            warnings: vec![]
        })
        .is_err()
    );
    assert!(Document::from_zip(b"not a zip").is_err());
}

#[test]
fn hand_edits_and_missing_caches_are_warnings() {
    let mut files = entries("tshirt");
    let m: &mut (String, Vec<u8>) = files
        .iter_mut()
        .find(|(p, _)| p == "manifest.json")
        .unwrap();
    let mut v: Value = serde_json::from_slice(&m.1).unwrap();
    v["parts"].as_array_mut().unwrap().push(json!({
        "path": "cache/sha256-00.glb", "mediaType": "model/gltf-binary", "role": "cache"
    }));
    m.1 = serde_json::to_vec(&v).unwrap();
    let p = files.iter_mut().find(|(p, _)| p == "view.json").unwrap();
    p.1 = br#"{"camera": {"target": [0, 1000, 0], "distance": 900}}"#.to_vec();
    files.push(("stray.txt".into(), b"x".to_vec()));
    let o = Document::from_entries(Entries {
        files,
        warnings: vec![],
    })
    .unwrap();
    let w = o.warnings.join("\n");
    assert!(w.contains("view.json: sha256"), "{w}");
    assert!(w.contains("cache part missing"), "{w}");
    assert!(w.contains("stray.txt: not listed"), "{w}");
}

#[test]
fn written_parts_match_the_schemas() {
    let dir = root().join("docs/format/schema");
    let mut schemas = Vec::new();
    let mut registry = jsonschema::Registry::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let name = p
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .trim_end_matches(".schema.json")
            .to_string();
        registry = registry.add(v["$id"].as_str().unwrap(), v.clone()).unwrap();
        schemas.push((name, v));
    }
    let registry = registry.prepare().unwrap();
    let validator = |name: &str| {
        let s = &schemas.iter().find(|(n, _)| n == name).unwrap().1;
        jsonschema::options()
            .with_registry(&registry)
            .build(s)
            .unwrap_or_else(|e| panic!("{name}: {e}"))
    };
    let (manifest, project, garment, fabric, avatar, view) = (
        validator("manifest"),
        validator("project"),
        validator("garment"),
        validator("fabric"),
        validator("avatar"),
        validator("view"),
    );
    for name in EXAMPLES {
        for (p, bytes) in Document::open(&example(name))
            .unwrap()
            .doc
            .to_entries()
            .unwrap()
        {
            if !p.ends_with(".json") {
                continue;
            }
            let v: Value = serde_json::from_slice(&bytes).unwrap();
            let schema = match p.split('/').next().unwrap() {
                "manifest.json" => &manifest,
                "project.json" => &project,
                "view.json" => &view,
                "garments" => &garment,
                "fabrics" => &fabric,
                "avatars" => &avatar,
                other => panic!("{other}"),
            };
            let errors: Vec<String> = schema
                .iter_errors(&v)
                .map(|e| format!("{}: {e}", e.instance_path()))
                .collect();
            assert!(errors.is_empty(), "{name}/{p}: {errors:#?}");
        }
    }
}

/// The editor's path: entities out as JSON text (what the worker sends), back in, saved. The
/// numbers survive JavaScript's single number type, and the file is byte-identical.
#[test]
fn entities_round_trip_through_json_text() {
    for name in EXAMPLES {
        let mut doc = Document::open(&example(name)).unwrap().doc;
        let zip = doc.to_zip().unwrap();
        let text = serde_json::to_string(&doc.entities()).unwrap();
        // What JSON.parse then JSON.stringify gives: integers and floats are one type.
        let js: Value = serde_json::from_str(&text).unwrap();
        let js = serde_json::to_string(&js)
            .unwrap()
            .replace(".0,", ",")
            .replace(".0]", "]");
        doc.set_entities(serde_json::from_str(&js).unwrap())
            .unwrap();
        assert_eq!(doc.to_zip_checked().unwrap(), zip, "{name}");
    }
}

#[test]
fn invalid_entities_are_refused_and_change_nothing() {
    let mut doc = Document::open(&example("tshirt")).unwrap().doc;
    let before = doc.clone();
    let mut e = doc.entities();
    e.garments[0]["fabric"] = json!("01a13cdb-cc03-7000-8000-000000000000");
    let err = doc.set_entities(e).unwrap_err();
    assert!(err.to_string().contains("fabric"), "{err}");
    let mut e = doc.entities();
    e.fabrics[0]["density"] = json!("heavy");
    assert!(doc.set_entities(e).is_err());
    let mut e = doc.entities();
    e.kind = Kind::Fabric;
    assert!(doc.set_entities(e).is_err());
    assert_eq!(doc, before);
    // A valid edit applies; an unknown member keeps its 1.0 through a JavaScript round trip.
    let mut e = doc.entities();
    e.fabrics[0]["friction"] = json!(0.4);
    e.fabrics[0]["futureScale"] = json!(1.0);
    doc.set_entities(e).unwrap();
    let mut e = doc.entities();
    e.fabrics[0]["futureScale"] = json!(1);
    e.fabrics[0]["name"] = json!("Renamed");
    doc.set_entities(e).unwrap();
    assert_eq!(doc.fabrics[0].friction, 0.4);
    let written = String::from_utf8(
        doc.to_entries()
            .unwrap()
            .into_iter()
            .find(|(p, _)| p.starts_with("fabrics/"))
            .unwrap()
            .1,
    )
    .unwrap();
    assert!(written.contains("\"futureScale\": 1.0"), "{written}");
}
