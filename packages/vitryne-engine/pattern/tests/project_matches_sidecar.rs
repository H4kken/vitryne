// SPDX-License-Identifier: AGPL-3.0-or-later
//! The .vtry path builds the same engine garment as the garment.toml it was converted from
//! (file-format.md, In the engine, item 5): the same mesh, triangle order,
//! sewing pairs, fabric, ramp, SDF box and camera, bit for bit. (The DXF importer works on the
//! format's 0.001 mm grid, so there is no rounding between the two.)

use vitryne_format::Document;
use vitryne_pattern::{garment::Garment as DxfGarment, project::ProjectGarment};

fn compare(name: &str) {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
    let toml =
        DxfGarment::load_file(&format!("{root}/assets/garments/{name}/garment.toml")).unwrap();
    let doc = Document::open(std::path::Path::new(&format!(
        "{root}/assets/examples/{name}.vtry"
    )))
    .unwrap()
    .doc;
    let pg = ProjectGarment::new(&doc).unwrap();
    let edge = toml.edge_for_vertices(10_000).unwrap();
    let edge2 = pg.edge_for_vertices(10_000).unwrap();
    assert!(
        (edge - edge2).abs() < 1e-6 * edge,
        "{name}: edge {edge} vs {edge2}"
    );
    let (a, b) = (toml.build(edge).unwrap(), pg.build(edge).unwrap());
    let max_diff = |x: &[glam::Vec3], y: &[glam::Vec3]| {
        x.iter()
            .zip(y)
            .map(|(p, q)| p.distance(*q))
            .fold(0.0f32, f32::max)
    };
    assert_eq!(a.mesh.n_verts(), b.mesh.n_verts(), "{name}: vertices");
    assert_eq!(a.mesh.tris, b.mesh.tris, "{name}: triangles");
    let rest = max_diff(&a.mesh.rest, &b.mesh.rest);
    let placed = max_diff(&a.mesh.pos, &b.mesh.pos);
    assert_eq!(rest, 0.0, "{name}: rest shapes differ by {rest} m");
    assert_eq!(placed, 0.0, "{name}: placed shapes differ by {placed} m");
    let (ma, mb) = (toml.fabric(), pg.material());
    assert_eq!(
        (ma.density, ma.stretch_k, ma.bend_kb),
        (mb.density, mb.stretch_k, mb.bend_kb),
        "{name}: fabric"
    );
    assert_eq!(
        format!("{:?}", a.schedule),
        format!("{:?}", b.schedule),
        "{name}: ramp"
    );
    assert_eq!(
        format!("{:?}", a.sdf),
        format!("{:?}", b.sdf),
        "{name}: SDF box"
    );
    assert_eq!(a.camera, b.camera, "{name}: camera");
    let mut s = vitryne_solver::sim::SimSettings::default();
    assert!(pg.apply_settings(&mut s).is_empty());
    assert_eq!(
        s.friction,
        vitryne_solver::sim::SimSettings::default().friction
    );
}

#[test]
fn tshirt() {
    compare("tshirt");
}

#[test]
fn trousers() {
    compare("trousers");
}

#[test]
fn hoodie() {
    compare("hoodie");
}

#[test]
fn per_cut_fabrics() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
    let mut doc = Document::open(std::path::Path::new(&format!(
        "{root}/assets/examples/tshirt.vtry"
    )))
    .unwrap()
    .doc;

    // Add denim preset fabric to the project.
    let denim = vitryne_format::presets::denim();
    let denim_id = denim.id.clone();
    doc.fabrics.push(denim.clone());
    doc.project.as_mut().unwrap().fabrics.push(denim_id.clone());

    // Set cut 0 (front) to denim, while other cuts keep the garment's cotton jersey default.
    let garment = &mut doc.garments[0];
    garment.pieces[0].cuts[0].fabric = Some(denim_id);

    let pg = ProjectGarment::new(&doc).unwrap();
    let panel_mats = pg.panel_materials();
    assert_eq!(panel_mats.len(), 4);

    // Cut 0 should have denim density (0.42) and stretch_k (~1.039e6),
    // while cut 1 should have cotton jersey density (0.15) and stretch_k (~1.0e4).
    assert!((panel_mats[0].density - 0.42).abs() < 1e-4);
    assert!((panel_mats[0].stretch_k - 1_039_230.5).abs() < 1e2);
    assert!((panel_mats[1].density - 0.15).abs() < 1e-4);
    assert!((panel_mats[1].stretch_k - 10_000.0).abs() < 1e2);

    let edge = pg.edge_for_vertices(10_000).unwrap();
    let desc = pg.build(edge).unwrap();
    let g =
        vitryne_solver::engine::Garment::load_with_materials(&desc, &pg.material(), &panel_mats)
            .unwrap();
    assert_eq!(g.panel_fabrics.len(), 4);
}
