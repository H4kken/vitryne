// SPDX-License-Identifier: AGPL-3.0-or-later
//! The rules of FORMAT.md that a JSON Schema can't express: what each kind holds, unique ids,
//! references between entities, run ends on the right nodes, placement chains without loops.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::{
    Document, Id, Kind,
    manifest::{MEDIA_GLB, MEDIA_JSON},
    model::*,
};

/// Errors make a file unreadable (and a document unwritable); warnings are reported and the
/// file still opens.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Report {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

pub(crate) fn check(doc: &Document) -> Report {
    let mut r = Report::default();
    let err = |r: &mut Report, m: String| r.errors.push(m);

    // What each kind holds.
    let (project, g, f, a) = (
        doc.project.is_some(),
        doc.garments.len(),
        doc.fabrics.len(),
        doc.avatars.len(),
    );
    let looks = doc.appearances.len();
    let ok = match doc.kind {
        Kind::Project => project,
        Kind::Garment => g == 1 && !project && a == 0,
        Kind::Fabric => f >= 1 && g == 0 && a == 0 && !project,
        Kind::Avatar => a == 1 && g == 0 && !project && looks == 0,
    };
    if !ok {
        err(
            &mut r,
            format!(
                "a {:?} file can't hold {} project, {g} garments, {f} fabrics, {looks} appearances, {a} avatars (FORMAT.md, Files and kinds)",
                doc.kind,
                if project { "a" } else { "no" }
            ),
        );
    }
    let used: BTreeSet<&str> = doc.extensions_used.iter().map(String::as_str).collect();
    for e in &doc.extensions_required {
        if !used.contains(e.as_str()) {
            err(
                &mut r,
                format!("required extension {e} is not in extensionsUsed"),
            );
        }
    }

    // Ids are unique across the file.
    let mut seen: HashMap<&Id, String> = HashMap::new();
    let mut ids: Vec<(&Id, String)> = Vec::new();
    if let Some(p) = &doc.project {
        ids.push((&p.id, "project".into()));
    }
    for fab in &doc.fabrics {
        ids.push((&fab.id, format!("fabric {}", fab.name)));
    }
    for ap in &doc.appearances {
        ids.push((&ap.id, format!("appearance {}", ap.name)));
    }
    for av in &doc.avatars {
        ids.push((&av.id, format!("avatar {}", av.name)));
    }
    for gar in &doc.garments {
        let w = |what: &str| format!("garment {}: {what}", gar.name);
        ids.push((&gar.id, w("itself")));
        for s in &gar.sources {
            ids.push((&s.id, w("source")));
        }
        for s in &gar.seams {
            ids.push((&s.id, w("seam")));
        }
        for p in &gar.pieces {
            ids.push((&p.id, w(&format!("piece {}", p.name))));
            for n in &p.outline {
                ids.push((&n.id, w(&format!("piece {} node", p.name))));
            }
            for l in &p.lines {
                ids.push((&l.id, w(&format!("piece {} line", p.name))));
                for n in &l.nodes {
                    ids.push((&n.id, w(&format!("piece {} line node", p.name))));
                }
            }
            for fo in &p.folds {
                ids.push((&fo.id, w(&format!("piece {} fold", p.name))));
            }
            for c in &p.cuts {
                ids.push((&c.id, w(&format!("piece {} cut", p.name))));
            }
        }
    }
    for (i, where_) in ids {
        if let Some(first) = seen.insert(i, where_.clone()) {
            r.errors
                .push(format!("duplicate id {i} ({first} and {where_})"));
        }
    }

    // Parts.
    let entity_paths: BTreeSet<String> = doc
        .garments
        .iter()
        .map(|g| crate::document::garment_path(&g.id))
        .chain(
            doc.fabrics
                .iter()
                .map(|f| crate::document::fabric_path(&f.id)),
        )
        .chain(
            doc.appearances
                .iter()
                .map(|a| crate::document::appearance_path(&a.id)),
        )
        .chain(
            doc.avatars
                .iter()
                .map(|a| crate::document::avatar_path(&a.id)),
        )
        .chain(["project.json".to_string(), "view.json".to_string()])
        .collect();
    for (path, file) in &doc.files {
        if entity_paths.contains(path) || path == "mimetype" || path == "manifest.json" {
            r.errors
                .push(format!("{path}: a file part can't use an entity's path"));
        }
        if let Err(e) = crate::container::check_path(path) {
            r.errors.push(e.to_string());
        }
        if file.media_type == MEDIA_JSON
            && let Err(e) = serde_json::from_slice::<serde_json::Value>(&file.bytes)
        {
            r.errors.push(format!("{path}: not JSON: {e}"));
        }
    }
    for av in &doc.avatars {
        match doc.files.get(&av.mesh) {
            Some(f) if f.media_type == MEDIA_GLB => {}
            Some(f) => r.errors.push(format!(
                "avatar {}: mesh {} is {}, not {MEDIA_GLB}",
                av.name, av.mesh, f.media_type
            )),
            None => r.errors.push(format!(
                "avatar {}: mesh {} is not in the file",
                av.name, av.mesh
            )),
        }
        for (name, reg) in &av.regions {
            if let Region::Path(p) = reg
                && p.points.len() < 2
            {
                r.errors.push(format!(
                    "avatar {}: region {name} needs two points",
                    av.name
                ));
            }
        }
    }

    // References.
    let fabrics: BTreeSet<&Id> = doc.fabrics.iter().map(|f| &f.id).collect();
    let appearances: BTreeSet<&Id> = doc.appearances.iter().map(|a| &a.id).collect();
    if let Some(p) = &doc.project {
        for g in &p.garments {
            if doc.garment(g).is_none() {
                r.errors.push(format!("project: garment {g} has no part"));
            }
        }
        for fab in &p.fabrics {
            if !fabrics.contains(fab) {
                r.errors.push(format!("project: fabric {fab} has no part"));
            }
        }
        if fabrics.iter().any(|f| !p.fabrics.contains(f)) {
            r.errors
                .push("project: fabrics must list every fabric part".into());
        }
        for ap in &p.appearances {
            if !appearances.contains(ap) {
                r.errors
                    .push(format!("project: appearance {ap} has no part"));
            }
        }
        if appearances.iter().any(|a| !p.appearances.contains(a)) {
            r.errors
                .push("project: appearances must list every appearance part".into());
        }
        if doc.avatar(&p.avatar).is_none() {
            r.errors
                .push(format!("project: avatar {} has no part", p.avatar));
        }
    }
    // Physical ranges (the schemas say the same; checked here too, since a file edited by
    // hand, or an editor's JSON, reaches the engine through this check only).
    for f in &doc.fabrics {
        let positive = [
            ("density", f.density),
            ("stretch.warp", f.stretch.warp),
            ("stretch.weft", f.stretch.weft),
            ("stretch.shear", f.stretch.shear),
            ("bending.warp", f.bending.warp),
            ("bending.weft", f.bending.weft),
        ]
        .into_iter()
        .chain(f.bending.bias.map(|b| ("bending.bias", b)))
        .chain(f.thickness.map(|t| ("thickness", t)));
        for (k, v) in positive {
            if !(v.is_finite() && v > 0.0) {
                r.errors
                    .push(format!("fabric {}: {k} must be above 0 (is {v})", f.name));
            }
        }
        if let Some(ap) = &f.appearance
            && !appearances.contains(ap)
        {
            r.errors
                .push(format!("fabric {}: appearance {ap} has no part", f.name));
        }
        if !(f.friction.is_finite() && f.friction >= 0.0) {
            r.errors.push(format!(
                "fabric {}: friction must be 0 or more (is {})",
                f.name, f.friction
            ));
        }
    }
    for ap in &doc.appearances {
        if !is_hex_color(&ap.color) {
            r.errors.push(format!(
                "appearance {}: color must be #rrggbb, lowercase (is {:?})",
                ap.name, ap.color
            ));
        }
    }
    let low_res = |v: Option<u32>| v.is_some_and(|n| n < 100);
    if low_res(
        doc.project
            .as_ref()
            .and_then(|p| p.simulation.as_ref())
            .and_then(|s| s.target_vertices),
    ) {
        r.errors
            .push("project: targetVertices must be at least 100".into());
    }
    for g in &doc.garments {
        if low_res(g.simulation.as_ref().and_then(|s| s.target_vertices)) {
            r.errors.push(format!(
                "garment {}: targetVertices must be at least 100",
                g.name
            ));
        }
    }

    let regions = doc.project_avatar().map(|a| &a.regions);
    for gar in &doc.garments {
        check_garment(gar, &fabrics, &appearances, regions, &mut r);
    }
    r
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn finite(v: &[f64]) -> bool {
    v.iter().all(|x| x.is_finite())
}

/// Two outline nodes closer than this are in the same place, mm.
const SAME_PLACE_MM: f64 = 0.01;

/// An outline is a simple polygon, counter-clockwise (FORMAT.md, Pieces and outlines): no two
/// consecutive nodes in the same place, no edge crossing or touching another. The polygon is the
/// outline as meshed (`outline_points`, curves flattened).
pub fn check_outline_shape(outline: &[Node]) -> Result<(), String> {
    let n = outline.len();
    for (k, a) in outline.iter().enumerate() {
        let b = &outline[(k + 1) % n];
        let d = (a.position[0] - b.position[0]).hypot(a.position[1] - b.position[1]);
        // A polyline that leaves and comes back is caught as a crossing below.
        let straight = a
            .edge
            .as_ref()
            .is_some_and(|e| e.is_cubic() || e.points.as_ref().is_some_and(Vec::is_empty));
        if d < SAME_PLACE_MM && straight {
            return Err(format!("nodes {} and {} are in the same place", a.id, b.id));
        }
    }
    let mut pts = outline_points(outline)?;
    pts.dedup();
    if pts.len() > 1 && pts.first() == pts.last() {
        pts.pop();
    }
    if pts.len() < 3 {
        return Err("the outline has no area".into());
    }
    let area: f64 = (0..pts.len())
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        / 2.0;
    if area <= 0.0 {
        return Err(if area == 0.0 {
            "the outline has no area".into()
        } else {
            "the outline runs clockwise; it must run counter-clockwise".into()
        });
    }
    if let Some(i) = spike(&pts) {
        return Err(format!(
            "the outline folds back on itself at ({:.1}, {:.1}) mm",
            pts[i][0], pts[i][1]
        ));
    }
    if let Some((i, j)) = self_crossing(&pts) {
        return Err(format!(
            "the outline crosses itself (near ({:.1}, {:.1}) mm and ({:.1}, {:.1}) mm)",
            pts[i][0], pts[i][1], pts[j][0], pts[j][1]
        ));
    }
    Ok(())
}

/// The first vertex of the closed polygon `pts` where the outline turns back along the way it
/// came (a sliver of no width, which cannot be meshed).
fn spike(pts: &[Vec2]) -> Option<usize> {
    let n = pts.len();
    (0..n).find(|&i| {
        let (p, q, r) = (pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]);
        let (a, b) = ([q[0] - p[0], q[1] - p[1]], [r[0] - q[0], r[1] - q[1]]);
        let (la, lb) = (a[0].hypot(a[1]), b[0].hypot(b[1]));
        la > 0.0 && lb > 0.0 && (a[0] * b[0] + a[1] * b[1]) / (la * lb) < -0.99985
    })
}

/// The first pair of non-adjacent segments (by their start vertex) of the closed polygon `pts`
/// (no repeated consecutive points) that cross or touch. Segments are swept in order of their
/// left end, so only those overlapping in x are compared.
fn self_crossing(pts: &[Vec2]) -> Option<(usize, usize)> {
    let n = pts.len();
    let seg = |i: usize| (pts[i], pts[(i + 1) % n]);
    let mut order: Vec<usize> = (0..n).collect();
    let lo = |i: usize| seg(i).0[0].min(seg(i).1[0]);
    let hi = |i: usize| seg(i).0[0].max(seg(i).1[0]);
    order.sort_by(|&a, &b| lo(a).total_cmp(&lo(b)).then(a.cmp(&b)));
    for (k, &i) in order.iter().enumerate() {
        for &j in &order[k + 1..] {
            if lo(j) > hi(i) {
                break;
            }
            let adjacent = (i + 1) % n == j || (j + 1) % n == i;
            if !adjacent && segments_meet(seg(i), seg(j)) {
                return Some((i.min(j), i.max(j)));
            }
        }
    }
    None
}

fn orient(a: Vec2, b: Vec2, c: Vec2) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// Whether two closed segments share a point.
fn segments_meet((a, b): (Vec2, Vec2), (c, d): (Vec2, Vec2)) -> bool {
    let within = |p: Vec2, q: Vec2, r: Vec2| {
        r[0] >= p[0].min(q[0])
            && r[0] <= p[0].max(q[0])
            && r[1] >= p[1].min(q[1])
            && r[1] <= p[1].max(q[1])
    };
    let (d1, d2) = (orient(c, d, a), orient(c, d, b));
    let (d3, d4) = (orient(a, b, c), orient(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    (d1 == 0.0 && within(c, d, a))
        || (d2 == 0.0 && within(c, d, b))
        || (d3 == 0.0 && within(a, b, c))
        || (d4 == 0.0 && within(a, b, d))
}

/// Even-odd point-in-polygon.
fn inside(p: Vec2, poly: &[Vec2]) -> bool {
    let mut c = false;
    let n = poly.len();
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + n - 1) % n]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            c = !c;
        }
    }
    c
}

fn dist_to_segment(p: Vec2, (a, b): (Vec2, Vec2)) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}

/// A fold is the straight line between two outline nodes `a` and `b` (FORMAT.md, Cut on the
/// fold): it must run inside the piece, touching the outline only at its ends. `poly`: the
/// outline as meshed.
fn check_fold(poly: &[Vec2], a: Vec2, b: Vec2) -> Result<(), String> {
    if (a[0] - b[0]).hypot(a[1] - b[1]) < SAME_PLACE_MM {
        return Err("a fold's ends are in the same place".into());
    }
    let n = poly.len();
    for i in 0..n {
        let (c, d) = (poly[i], poly[(i + 1) % n]);
        if c == a || c == b || d == a || d == b {
            continue;
        }
        if segments_meet((a, b), (c, d)) {
            return Err("a fold must run inside the piece (it meets the outline)".into());
        }
    }
    let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let on = (0..n).any(|i| dist_to_segment(mid, (poly[i], poly[(i + 1) % n])) < SAME_PLACE_MM);
    if on || !inside(mid, poly) {
        return Err("a fold must run inside the piece".into());
    }
    Ok(())
}

/// Whether the open path `pts` leaves the polygon `poly`: a point outside it (and not on the
/// outline), or a segment crossing the outline.
fn leaves(poly: &[Vec2], pts: &[Vec2]) -> bool {
    let n = poly.len();
    let seg = |i: usize| (poly[i], poly[(i + 1) % n]);
    let on = |p: Vec2| (0..n).any(|i| dist_to_segment(p, seg(i)) < SAME_PLACE_MM);
    if pts.iter().any(|&p| !inside(p, poly) && !on(p)) {
        return true;
    }
    pts.windows(2).any(|w| {
        (0..n).any(|i| {
            let (c, d) = seg(i);
            let (d1, d2) = (orient(c, d, w[0]), orient(c, d, w[1]));
            let (d3, d4) = (orient(w[0], w[1], c), orient(w[0], w[1], d));
            d1 * d2 < 0.0 && d3 * d4 < 0.0
        })
    })
}

fn check_garment(
    g: &Garment,
    fabrics: &BTreeSet<&Id>,
    appearances: &BTreeSet<&Id>,
    regions: Option<&BTreeMap<String, Region>>,
    r: &mut Report,
) {
    let at = |m: String| format!("garment {}: {m}", g.name);
    if !fabrics.contains(&g.fabric) {
        r.errors
            .push(at(format!("fabric {} has no part", g.fabric)));
    }
    if let Some(ap) = &g.appearance
        && !appearances.contains(ap)
    {
        r.errors.push(at(format!("appearance {ap} has no part")));
    }
    let sources: BTreeSet<&Id> = g.sources.iter().map(|s| &s.id).collect();
    // Per cut: its piece's outline node ids (in order) and its lines' node ids.
    let mut cuts: HashMap<&Id, (&Piece, &Cut)> = HashMap::new();
    for p in &g.pieces {
        let pa = |m: String| at(format!("piece {}: {m}", p.name));
        if let Some(s) = &p.source
            && !sources.contains(&s.source)
        {
            r.errors
                .push(pa(format!("source {} is not in sources", s.source)));
        }
        if p.outline.len() < 3 {
            r.errors
                .push(pa("the outline needs at least 3 nodes".into()));
        }
        let check_node = |n: &Node, needs_edge: bool, r: &mut Report| {
            if !finite(&n.position) {
                r.errors.push(pa("a node position is not a number".into()));
            }
            match (&n.edge, needs_edge) {
                (None, true) => r
                    .errors
                    .push(pa(format!("node {} has no edge to the next one", n.id))),
                (Some(_), false) => r.errors.push(pa(format!(
                    "node {}: the last node of a line has no edge",
                    n.id
                ))),
                (Some(e), true) => {
                    if let Err(m) = e.check() {
                        r.errors.push(pa(m));
                    }
                    let mut pts = e.points.iter().flatten().chain(e.controls.iter().flatten());
                    if !pts.all(|q| finite(q)) {
                        r.errors.push(pa("an edge point is not a number".into()));
                    }
                }
                (None, false) => {}
            }
        };
        let before = r.errors.len();
        for n in &p.outline {
            check_node(n, true, r);
        }
        if r.errors.len() == before
            && p.outline.len() >= 3
            && let Err(m) = check_outline_shape(&p.outline)
        {
            r.errors.push(pa(m));
        }
        for l in &p.lines {
            if l.nodes.len() < 2 {
                r.errors.push(pa("a line needs at least 2 nodes".into()));
            }
            for (k, n) in l.nodes.iter().enumerate() {
                check_node(n, k + 1 < l.nodes.len(), r);
            }
        }
        let shape_ok = r.errors.len() == before;
        let outline: BTreeSet<&Id> = p.outline.iter().map(|n| &n.id).collect();
        let polygon = outline_points(&p.outline).ok().filter(|_| shape_ok);
        for f in &p.folds {
            if !outline.contains(&f.from) || !outline.contains(&f.to) || f.from == f.to {
                r.errors
                    .push(pa("fold ends must be two outline nodes".into()));
                continue;
            }
            let at = |id: &Id| p.outline.iter().find(|n| &n.id == id).map(|n| n.position);
            if let (Some(poly), Some(a), Some(b)) = (&polygon, at(&f.from), at(&f.to))
                && let Err(m) = check_fold(poly, a, b)
            {
                r.errors.push(pa(m));
            }
        }
        if let Some(poly) = &polygon {
            for l in &p.lines {
                if l.nodes.len() >= 2
                    && let Ok(pts) = path_points(&l.nodes, 0, l.nodes.len() - 1)
                    && leaves(poly, &pts)
                {
                    r.warnings.push(pa(format!(
                        "line {} leaves the piece",
                        l.name.as_deref().unwrap_or(l.id.as_str())
                    )));
                }
            }
        }
        if let Some(gr) = &p.grain {
            let d = (gr.to[0] - gr.from[0]).hypot(gr.to[1] - gr.from[1]);
            if !finite(&gr.from) || !finite(&gr.to) {
                r.errors
                    .push(pa("the grain line's ends must be numbers".into()));
            } else if d < SAME_PLACE_MM {
                r.errors.push(pa("the grain line has no length".into()));
            }
        }
        for c in &p.cuts {
            cuts.insert(&c.id, (p, c));
            if let Some(fab) = &c.fabric
                && !fabrics.contains(fab)
            {
                r.errors.push(pa(format!("cut fabric {fab} has no part")));
            }
            if let Some(ap) = &c.appearance
                && !appearances.contains(ap)
            {
                r.errors
                    .push(pa(format!("cut appearance {ap} has no part")));
            }
        }
    }
    let cut_name = |c: &Cut| c.name.clone().unwrap_or_else(|| c.id.to_string());
    for (&cid, &(_, c)) in &cuts {
        match &c.placement {
            Placement::Wrap(w) => {
                if let Some(regions) = regions
                    && !regions.contains_key(&w.region)
                {
                    r.warnings.push(at(format!(
                        "cut {}: the avatar has no region {:?}; the cut can't be placed",
                        cut_name(c),
                        w.region
                    )));
                }
                if w.radius.is_nan() || w.radius <= 0.0 {
                    r.errors
                        .push(at(format!("cut {}: radius must be positive", cut_name(c))));
                }
            }
            Placement::Follow(_) => {
                let mut chain = BTreeSet::from([cid]);
                let mut k = cid;
                while let Some((_, kc)) = cuts.get(k) {
                    let Placement::Follow(f) = &kc.placement else {
                        break;
                    };
                    if !cuts.contains_key(&f.cut) {
                        r.errors.push(at(format!(
                            "cut {}: follows {}, which isn't a cut of this garment",
                            cut_name(c),
                            f.cut
                        )));
                        break;
                    }
                    if !chain.insert(&f.cut) {
                        r.errors.push(at(format!(
                            "cut {}: its placement follows itself",
                            cut_name(c)
                        )));
                        break;
                    }
                    k = &f.cut;
                }
            }
        }
    }
    for s in &g.seams {
        let sa = |m: String| {
            at(format!(
                "seam {}: {m}",
                s.name.as_deref().unwrap_or(s.id.as_str())
            ))
        };
        if s.a.is_empty() || s.b.is_empty() {
            r.errors.push(sa("both sides need at least one run".into()));
        }
        for run in s.a.iter().chain(&s.b) {
            let Some(&(p, _)) = cuts.get(&run.cut) else {
                r.errors.push(sa(format!("unknown cut {}", run.cut)));
                continue;
            };
            let nodes: Vec<&Id> = match &run.line {
                Some(l) => match p.lines.iter().find(|x| &x.id == l) {
                    Some(line) => line.nodes.iter().map(|n| &n.id).collect(),
                    None => {
                        r.errors
                            .push(sa(format!("no line {l} on piece {}", p.name)));
                        continue;
                    }
                },
                None => {
                    if run.direction.is_none() {
                        r.errors.push(sa("an outline run needs a direction".into()));
                    }
                    p.outline.iter().map(|n| &n.id).collect()
                }
            };
            if !nodes.contains(&&run.from) || !nodes.contains(&&run.to) {
                r.errors.push(sa(format!(
                    "run ends must be nodes of piece {}'s {}",
                    p.name,
                    if run.line.is_some() {
                        "line"
                    } else {
                        "outline"
                    }
                )));
            }
            if run.from == run.to {
                r.errors.push(sa("a run needs two different nodes".into()));
            }
        }
    }
}
