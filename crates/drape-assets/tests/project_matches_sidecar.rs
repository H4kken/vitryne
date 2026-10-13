// SPDX-License-Identifier: AGPL-3.0-or-later
//! The .vtry path builds the same engine garment as the garment.toml it was converted from
//! (FORMAT.md, What M5 has to change in the engine, item 5): the same mesh, triangle order,
//! sewing pairs, fabric, ramp, SDF box and camera, bit for bit. (The DXF importer works on the
//! format's 0.001 mm grid, so there is no rounding between the two.)

use drape_assets::{garment::Garment as DxfGarment, project::ProjectGarment};
use vitryne_format::Document;

fn compare(name: &str) {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let toml =
        DxfGarment::load_file(&format!("{root}/assets/garments/{name}/garment.toml")).unwrap();
    let doc = Document::open(std::path::Path::new(&format!(
        "{root}/examples/{name}.vtry"
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
    let mut s = drape_core::sim::SimSettings::default();
    assert!(pg.apply_settings(&mut s).is_empty());
    assert_eq!(s.friction, drape_core::sim::SimSettings::default().friction);
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
