// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor's placement preview (`Placer`) places the meshed garment exactly as a full build
//! does, so what the user sees while dragging is what the drape starts from.

use vitryne_format::{Document, Placement};
use vitryne_pattern::project::ProjectGarment;

fn example(name: &str) -> Document {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    Document::open(std::path::Path::new(&format!(
        "{root}/examples/{name}.vtry"
    )))
    .unwrap()
    .doc
}

#[test]
fn preview_matches_a_full_build() {
    let doc = example("hoodie");
    let pg = ProjectGarment::new(&doc).unwrap();
    let edge = pg.edge_for_vertices(4000).unwrap();
    let (desc, placer) = pg.build_with_placer(edge).unwrap();
    let cuts: Vec<_> = doc.garments[0].cuts().map(|(_, c)| c.clone()).collect();
    assert_eq!(placer.cut_ids().len(), cuts.len());

    // The same placement: the same positions, bit for bit.
    for (i, c) in cuts.iter().enumerate() {
        assert_eq!(
            placer.positions(i, &c.placement).unwrap(),
            desc.mesh.pos,
            "cut {i}"
        );
    }

    // The front moved up and round: rebuilding the edited document gives the same positions,
    // bit for bit (the pocket, which follows the front, moves with it).
    let front = cuts
        .iter()
        .position(|c| c.name.as_deref() == Some("front"))
        .unwrap();
    let Placement::Wrap(w0) = cuts[front].placement.clone() else {
        panic!("the front is wrapped")
    };
    let rebuild = |p: &Placement| {
        let mut edited = doc.clone();
        for piece in &mut edited.garments[0].pieces {
            for c in &mut piece.cuts {
                if c.id == cuts[front].id {
                    c.placement = p.clone();
                }
            }
        }
        ProjectGarment::new(&edited).unwrap().build(edge).unwrap()
    };
    let mut w = w0.clone();
    w.top += 30.0;
    w.angle += 0.1;
    w.radius += 15.0;
    let moved = Placement::Wrap(w);
    let preview = placer.positions(front, &moved).unwrap();
    assert_eq!(preview, rebuild(&moved).mesh.pos);
    let pocket = cuts
        .iter()
        .position(|c| c.name.as_deref() == Some("pocket"))
        .unwrap();
    let v = desc.groups[pocket].1.start as usize;
    assert_ne!(preview[v], desc.mesh.pos[v], "the pocket follows the front");

    // Turned: a full build meshes the turned pattern (other triangles), the preview turns the
    // mesh; the piece covers the same place on the body.
    let mut w = w0.clone();
    w.rotation = Some(0.3);
    let turned = Placement::Wrap(w);
    let preview = placer.positions(front, &turned).unwrap();
    let full = rebuild(&turned);
    let bbox = |pts: &[glam::Vec3]| {
        pts.iter().fold(
            (glam::Vec3::splat(f32::MAX), glam::Vec3::splat(f32::MIN)),
            |(lo, hi), p| (lo.min(*p), hi.max(*p)),
        )
    };
    let r0 = desc.groups[front].1.clone();
    let r1 = full.groups[front].1.clone();
    let (a, b) = (
        bbox(&preview[r0.start as usize..r0.end as usize]),
        bbox(&full.mesh.pos[r1.start as usize..r1.end as usize]),
    );
    let off = (a.0 - b.0).abs().max((a.1 - b.1).abs()).max_element();
    assert!(off < 0.001, "turned front: boxes differ by {off} m");

    // The gizmo sits on the front, at its middle, and moves up the torso.
    let g = placer.gizmo(front, &cuts[front].placement).unwrap();
    assert!((g.basis.along - glam::Vec3::Y).length() < 1e-6);
    assert!(
        g.basis.point.z > 0.1,
        "in front of the body: {:?}",
        g.basis.point
    );
    assert!((1.1..1.4).contains(&g.basis.point.y), "{:?}", g.basis.point);
}
