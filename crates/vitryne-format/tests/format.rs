// SPDX-License-Identifier: AGPL-3.0-or-later
//! The format against its own rules, on the example projects (examples/*.vtry, folder form):
//! round trips, unknown data kept, version handling, malformed files refused, and every part
//! the writer produces valid against docs/format/schema/.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use vitryne_format::{
    Document, EXT_CURVES, Edge, Error, FORMAT_VERSION, Kind,
    container::{self, Entries},
    glb,
    manifest::Manifest,
    round_mm,
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
        &|f| part(f, "garments/")["pieces"][0]["outline"][0]["edge"]["type"] = json!("arc"),
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

/// The T-shirt with a garment colour and one cut of its own.
fn with_appearances() -> Document {
    let mut doc = Document::open(&example("tshirt")).unwrap().doc;
    let (navy, red) = (
        "01a13cdb-cc05-7000-8000-000000000001",
        "01a13cdb-cc05-7000-8000-000000000002",
    );
    let mut e = doc.entities();
    e.appearances = vec![
        json!({ "id": navy, "name": "Navy", "color": "#1f2a44" }),
        json!({ "id": red, "name": "Red", "color": "#c0392b" }),
    ];
    e.project.as_mut().unwrap()["appearances"] = json!([navy, red]);
    e.garments[0]["appearance"] = json!(navy);
    e.garments[0]["pieces"][0]["cuts"][0]["appearance"] = json!(red);
    doc.set_entities(e).unwrap();
    doc
}

/// Appearances (format version 2): written as parts, read back the same, references and
/// colours checked.
#[test]
fn appearances_round_trip_and_are_checked() {
    let doc = with_appearances();
    let back = Document::from_zip(&doc.to_zip_checked().unwrap())
        .unwrap()
        .doc;
    assert_eq!(back, doc);
    assert_eq!(back.appearances.len(), 2);
    let cut = &back.garments[0].pieces[0].cuts[0];
    let rgb = back
        .appearance(cut.appearance.as_ref().unwrap())
        .unwrap()
        .rgb();
    assert_eq!(rgb, Some([192.0 / 255.0, 57.0 / 255.0, 43.0 / 255.0]));

    let refused = |edit: &dyn Fn(&mut vitryne_format::Entities), what: &str| {
        let mut d = doc.clone();
        let mut e = d.entities();
        edit(&mut e);
        let err = d.set_entities(e).unwrap_err().to_string();
        assert!(err.contains(what), "{what}: {err}");
    };
    refused(
        &|e| e.garments[0]["appearance"] = json!("01a13cdb-cc05-7000-8000-00000000000f"),
        "appearance 01a13cdb-cc05-7000-8000-00000000000f has no part",
    );
    refused(
        &|e| {
            e.garments[0]["pieces"][0]["cuts"][0]["appearance"] =
                json!("01a13cdb-cc05-7000-8000-00000000000f")
        },
        "cut appearance",
    );
    refused(&|e| e.appearances[0]["color"] = json!("#1F2A44"), "#rrggbb");
    refused(&|e| e.appearances[0]["color"] = json!("navy"), "#rrggbb");
    refused(
        &|e| e.project.as_mut().unwrap()["appearances"] = json!([]),
        "appearances must list every appearance part",
    );
    refused(
        &|e| e.fabrics[0]["appearance"] = json!("01a13cdb-cc05-7000-8000-00000000000f"),
        "fabric Cotton jersey",
    );
}

/// A fabric's appearance (format version 3) round-trips, in a project and in a fabric file
/// that carries the appearances its fabrics use.
#[test]
fn fabric_appearances_round_trip() {
    let mut doc = with_appearances();
    let mut e = doc.entities();
    e.fabrics[0]["appearance"] = json!("01a13cdb-cc05-7000-8000-000000000001");
    doc.set_entities(e).unwrap();
    let back = Document::from_zip(&doc.to_zip_checked().unwrap())
        .unwrap()
        .doc;
    assert_eq!(back, doc);
    let navy = back.fabrics[0].appearance.as_ref().unwrap();
    assert_eq!(back.appearance(navy).unwrap().color, "#1f2a44");

    let mut lib = Document::new(Kind::Fabric);
    lib.fabrics.push(back.fabrics[0].clone());
    lib.appearances.push(back.appearance(navy).unwrap().clone());
    let again = Document::from_zip(&lib.to_zip_checked().unwrap())
        .unwrap()
        .doc;
    assert_eq!(again.appearances.len(), 1);
    lib.appearances.clear();
    assert!(lib.to_zip_checked().is_err());
}

/// A file of every past version opens (migrated) and saves at the current one.
#[test]
fn past_versions_open() {
    for v in 1..FORMAT_VERSION {
        let fixture = root().join(format!("crates/vitryne-format/tests/fixtures/v{v}.vtryf"));
        let opened = Document::open(&fixture).unwrap();
        assert!(opened.warnings.is_empty(), "v{v}: {:?}", opened.warnings);
        let doc = opened.doc;
        assert_eq!(
            (doc.kind, doc.format_version),
            (Kind::Fabric, FORMAT_VERSION),
            "v{v}"
        );
        assert_eq!(doc.fabrics[0].friction, 0.3);
        let manifest: Value = serde_json::from_slice(&doc.to_entries().unwrap()[1].1).unwrap();
        assert_eq!(manifest["formatVersion"], FORMAT_VERSION);
        assert_eq!(manifest["minReaderVersion"], 1);
    }
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
    let (manifest, project, garment, fabric, appearance, avatar, view) = (
        validator("manifest"),
        validator("project"),
        validator("garment"),
        validator("fabric"),
        validator("appearance"),
        validator("avatar"),
        validator("view"),
    );
    let docs = EXAMPLES
        .iter()
        .map(|name| (*name, Document::open(&example(name)).unwrap().doc))
        .chain([
            ("tshirt with colours", with_appearances()),
            ("tshirt with a curve", with_curve()),
        ]);
    for (name, doc) in docs {
        for (p, bytes) in doc.to_entries().unwrap() {
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
                "appearances" => &appearance,
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

#[test]
fn physical_ranges_are_checked() {
    let doc = Document::open(&example("tshirt")).unwrap().doc;
    for (path, bad) in [
        (&["density"][..], json!(0.0)),
        (&["stretch", "warp"][..], json!(-5.0)),
        (&["bending", "weft"][..], json!(0.0)),
        (&["friction"][..], json!(-0.1)),
    ] {
        let mut d = doc.clone();
        let mut e = d.entities();
        let mut v = &mut e.fabrics[0];
        for k in &path[..path.len() - 1] {
            v = &mut v[*k];
        }
        v[path[path.len() - 1]] = bad;
        let err = d.set_entities(e).unwrap_err().to_string();
        assert!(err.contains(path[path.len() - 1]), "{err}");
    }
    let mut d = doc.clone();
    let mut e = d.entities();
    e.project.as_mut().unwrap()["simulation"]["targetVertices"] = json!(50);
    assert!(d.set_entities(e).is_err());
}

/// The T-shirt with its first piece's longest straight edge bowed outwards 5 mm as a cubic.
fn with_curve() -> Document {
    let mut doc = Document::open(&example("tshirt")).unwrap().doc;
    let outline = &mut doc.garments[0].pieces[0].outline;
    let n = outline.len();
    let len = |k: usize, o: &[vitryne_format::Node]| {
        let (a, b) = (o[k].position, o[(k + 1) % n].position);
        (b[0] - a[0]).hypot(b[1] - a[1])
    };
    let k = (0..n)
        .filter(|&k| {
            outline[k]
                .edge
                .as_ref()
                .is_some_and(|e| e.points.as_ref().is_some_and(Vec::is_empty))
        })
        .max_by(|&i, &j| len(i, outline).total_cmp(&len(j, outline)))
        .expect("a straight edge");
    let (a, b) = (outline[k].position, outline[(k + 1) % n].position);
    let l = len(k, outline);
    // Counter-clockwise outline: outwards is to the right of the edge.
    let out = [(b[1] - a[1]) / l * 5.0, -(b[0] - a[0]) / l * 5.0];
    let at = |t: f64| {
        [
            round_mm(a[0] + (b[0] - a[0]) * t + out[0] * 4.0 / 3.0),
            round_mm(a[1] + (b[1] - a[1]) * t + out[1] * 4.0 / 3.0),
        ]
    };
    outline[k].edge = Some(Edge::cubic(at(1.0 / 3.0), at(2.0 / 3.0)));
    doc
}

fn manifest_of(doc: &Document) -> Manifest {
    let (_, bytes) = doc
        .to_entries()
        .unwrap()
        .into_iter()
        .find(|(p, _)| p == "manifest.json")
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// A curve is written as `controls`, survives a round trip, and makes the file use and require
/// VTRY_curves; without curves the extension goes again and the file is the example's bytes.
#[test]
fn curved_edges_round_trip_and_require_their_extension() {
    let doc = with_curve();
    assert!(
        doc.validate().errors.is_empty(),
        "{:?}",
        doc.validate().errors
    );
    let m = manifest_of(&doc);
    assert_eq!(m.extensions_used, [EXT_CURVES]);
    assert_eq!(m.extensions_required, [EXT_CURVES]);
    let entries = doc.to_entries().unwrap();
    let garment = entries
        .iter()
        .find(|(p, _)| p.starts_with("garments/"))
        .unwrap();
    let text = String::from_utf8(garment.1.clone()).unwrap();
    assert!(
        text.contains("\"type\": \"cubic\""),
        "no cubic edge written"
    );
    let back = Document::from_entries(Entries {
        files: entries.clone(),
        warnings: Vec::new(),
    })
    .unwrap()
    .doc;
    assert_eq!(back.garments, doc.garments);
    assert_eq!(back.to_entries().unwrap(), entries);

    // Straight again: no extension, the example's own bytes.
    let original = Document::open(&example("tshirt")).unwrap().doc;
    let mut again = back;
    again.garments = original.garments.clone();
    assert_eq!(manifest_of(&again).extensions_used, Vec::<String>::new());
    assert_eq!(again.to_entries().unwrap(), original.to_entries().unwrap());
}

/// An outline must be a simple polygon, counter-clockwise, with its edges well formed.
#[test]
fn outline_shapes_are_checked() {
    let doc = Document::open(&example("tshirt")).unwrap().doc;
    let refused = |what: &str, edit: &dyn Fn(&mut Vec<vitryne_format::Node>), says: &str| {
        let mut d = doc.clone();
        edit(&mut d.garments[0].pieces[0].outline);
        let errors = d.validate().errors;
        assert!(
            errors.iter().any(|e| e.contains(says)),
            "{what}: {errors:?}"
        );
    };
    refused(
        "mirrored",
        &|o| {
            for n in o.iter_mut() {
                n.position[0] = -n.position[0];
                for q in n.edge.as_mut().unwrap().points.iter_mut().flatten() {
                    q[0] = -q[0];
                }
            }
        },
        "clockwise",
    );
    refused(
        "a node thrown across the piece",
        &|o| {
            let far = o[o.len() / 2].position;
            let near = o[0].position;
            o[0].position = [far[0] + (far[0] - near[0]), far[1] + (far[1] - near[1])];
        },
        "crosses itself",
    );
    refused(
        "two nodes on one spot",
        &|o| {
            o[1].position = o[0].position;
            o[0].edge = Some(Edge::polyline(Vec::new()));
        },
        "same place",
    );
    refused(
        "a cubic with points",
        &|o| {
            let mut e = Edge::cubic([0.0, 0.0], [1.0, 1.0]);
            e.points = Some(Vec::new());
            o[0].edge = Some(e);
        },
        "controls only",
    );
    refused(
        "a cubic control that isn't a number",
        &|o| o[0].edge = Some(Edge::cubic([f64::NAN, 0.0], [1.0, 1.0])),
        "not a number",
    );
}

/// Folds run inside the piece (an error otherwise), lines that leave it are a warning, and a
/// grain line needs a length.
#[test]
fn folds_lines_and_grain_are_checked() {
    let doc = Document::open(&example("tshirt")).unwrap().doc;
    // An L: the corner at (100, 100) points into the piece.
    let corners = [
        [0.0, 0.0],
        [200.0, 0.0],
        [200.0, 100.0],
        [100.0, 100.0],
        [100.0, 200.0],
        [0.0, 200.0],
    ];
    let ids: Vec<String> = (0..corners.len())
        .map(|k| format!("01a13cdb-cc06-7bbe-9365-6ac1ac56ba{k:02}"))
        .collect();
    let node = |k: usize, edge: bool| {
        let mut n = json!({"id": ids[k], "type": "corner", "position": corners[k]});
        if edge {
            n["edge"] = json!({"type": "polyline", "points": []});
        }
        n
    };
    let outline: Vec<_> = (0..corners.len()).map(|k| node(k, true)).collect();
    let with = |extra: Value| {
        let mut d = doc.clone();
        d.garments[0].seams.clear();
        let p = &mut d.garments[0].pieces[0];
        let mut v = serde_json::to_value(&*p).unwrap();
        v["outline"] = json!(outline);
        v.as_object_mut().unwrap().remove("folds");
        v.as_object_mut().unwrap().remove("lines");
        v.as_object_mut().unwrap().remove("grain");
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        *p = serde_json::from_value(v).unwrap();
        d.validate()
    };
    let fold = |a: usize, b: usize| json!({"folds": [{"id": "01a13cdb-cc06-7bbe-9365-6ac1ac56bb00", "from": ids[a], "to": ids[b]}]});
    assert_eq!(with(json!({})).errors, Vec::<String>::new());
    assert_eq!(with(fold(0, 3)).errors, Vec::<String>::new());
    for (a, b) in [(1, 5), (2, 4), (0, 1)] {
        let e = with(fold(a, b)).errors;
        assert!(
            e.iter().any(|m| m.contains("inside the piece")),
            "{a}-{b}: {e:?}"
        );
    }
    let line = |to: [f64; 2]| {
        json!({"lines": [{"id": "01a13cdb-cc06-7bbe-9365-6ac1ac56bc00", "nodes": [
            {"id": "01a13cdb-cc06-7bbe-9365-6ac1ac56bc01", "type": "point", "position": [20.0, 20.0],
             "edge": {"type": "polyline", "points": []}},
            {"id": "01a13cdb-cc06-7bbe-9365-6ac1ac56bc02", "type": "point", "position": to}]}]})
    };
    let inside = with(line([0.0, 150.0]));
    assert!(inside.errors.is_empty() && !inside.warnings.iter().any(|w| w.contains("leaves")));
    let out = with(line([150.0, 150.0]));
    assert!(out.errors.is_empty(), "{:?}", out.errors);
    assert!(
        out.warnings.iter().any(|w| w.contains("leaves the piece")),
        "{:?}",
        out.warnings
    );
    let grain = |to: [f64; 2]| json!({"grain": {"from": [50.0, 50.0], "to": to}});
    assert!(with(grain([50.0, 150.0])).errors.is_empty());
    let e = with(grain([50.0, 50.0])).errors;
    assert!(e.iter().any(|m| m.contains("no length")), "{e:?}");
}
