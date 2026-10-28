// SPDX-License-Identifier: AGPL-3.0-or-later
//! The editor's placement preview (`Placer`) places the meshed garment exactly as a full build
//! does, so what the user sees while dragging is what the drape starts from.

use vitryne_format::{Document, Placement};
use vitryne_pattern::project::ProjectGarment;

fn example(name: &str) -> Document {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");
    Document::open(std::path::Path::new(&format!(
        "{root}/assets/examples/{name}.vtry"
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

/// The sample garments have no cuts stacked on one another (a pocket aside, which sits where it
/// is told to), so the stack changes nothing about where they start: in any order the cuts are
/// placed exactly the same. A start that moved here would move the golden drapes.
#[test]
fn the_examples_start_as_drawn_in_any_stack_order() {
    for name in ["tshirt", "trousers", "hoodie"] {
        let doc = example(name);
        let positions = |doc: &Document| {
            let pg = ProjectGarment::new(doc).unwrap();
            let edge = pg.edge_for_vertices(4000).unwrap();
            pg.build(edge).unwrap().mesh.pos
        };
        let normal = positions(&doc);
        let mut reversed = doc.clone();
        reversed.garments[0].stack.reverse();
        assert_eq!(positions(&reversed), normal, "{name}");
    }
}

/// The editor places the garment again on every frame of a drag (`Placer::positions`), so
/// stacking has to stay cheap.
#[test]
fn placing_again_stays_cheap() {
    let doc = example("hoodie");
    let pg = ProjectGarment::new(&doc).unwrap();
    let edge = pg.edge_for_vertices(4000).unwrap();
    let (_, placer) = pg.build_with_placer(edge).unwrap();
    let cut = doc.garments[0].cuts().next().unwrap().1.placement.clone();
    let t = std::time::Instant::now();
    for _ in 0..10 {
        placer.positions(0, &cut).unwrap();
    }
    let each = t.elapsed() / 10;
    eprintln!("placing the hoodie again: {each:?}");
    assert!(each.as_millis() < 250, "{each:?}");
}

/// A copy of the T-shirt's front on the same spot of the body: which one is outside is the
/// stack's to say, and swapping them moves the cut that was pushed out.
#[test]
fn the_stack_decides_which_of_two_cuts_on_one_spot_is_outside() {
    let mut doc = example("tshirt");
    let g = &mut doc.garments[0];
    let front = g
        .cuts()
        .find(|(_, c)| c.name.as_deref() == Some("front"))
        .unwrap()
        .1
        .id
        .clone();
    let mut copy = g.cuts().find(|(_, c)| c.id == front).unwrap().1.clone();
    copy.id = vitryne_format::IdGen::new(1_792_022_400_000, b"copy").next_id();
    copy.layout = None;
    let copy_id = copy.id.clone();
    g.pieces
        .iter_mut()
        .find(|p| p.cuts.iter().any(|c| c.id == front))
        .unwrap()
        .cuts
        .push(copy);
    let build = |doc: &Document| {
        assert!(
            doc.validate().errors.is_empty(),
            "{:?}",
            doc.validate().errors
        );
        let pg = ProjectGarment::new(doc).unwrap();
        let edge = pg.edge_for_vertices(4000).unwrap();
        pg.build(edge).unwrap().mesh.pos
    };
    let others: Vec<_> = doc.garments[0]
        .stack
        .iter()
        .filter(|&id| id != &front)
        .cloned()
        .collect();
    let mut copy_on_top = doc.clone();
    copy_on_top.garments[0].stack =
        [vec![front.clone()], others.clone(), vec![copy_id.clone()]].concat();
    let mut front_on_top = doc.clone();
    front_on_top.garments[0].stack = [vec![copy_id.clone()], others, vec![front.clone()]].concat();
    // The editor is told how far out each starts: the one on top by a gap, the other not at all.
    let starts_out = |doc: &Document| {
        let pg = ProjectGarment::new(doc).unwrap();
        let edge = pg.edge_for_vertices(4000).unwrap();
        let (_, placer) = pg.build_with_placer(edge).unwrap();
        let (ids, out) = (placer.cut_ids(), placer.starts_out().unwrap());
        let at = |id: &vitryne_format::Id| ids.iter().position(|x| x == id.as_str()).unwrap();
        (out[at(&front)], out[at(&copy_id)])
    };
    let (front_out, copy_out) = starts_out(&copy_on_top);
    assert_eq!(front_out, 0.0);
    assert!(copy_out >= 0.012 - 1e-6, "{copy_out}");
    let (front_out, copy_out) = starts_out(&front_on_top);
    assert_eq!(copy_out, 0.0);
    assert!(front_out >= 0.012 - 1e-6, "{front_out}");
    let (a, b) = (build(&copy_on_top), build(&front_on_top));
    assert_eq!(a.len(), b.len());
    assert_ne!(a, b);
    assert_eq!(a, build(&copy_on_top), "the same stack places the same");
}
