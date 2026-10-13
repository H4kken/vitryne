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
    let ok = match doc.kind {
        Kind::Project => project,
        Kind::Garment => g == 1 && !project && a == 0,
        Kind::Fabric => f >= 1 && g == 0 && a == 0 && !project,
        Kind::Avatar => a == 1 && g == 0 && !project,
    };
    if !ok {
        err(
            &mut r,
            format!(
                "a {:?} file can't hold {} project, {g} garments, {f} fabrics, {a} avatars (FORMAT.md, Files and kinds)",
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
        if doc.avatar(&p.avatar).is_none() {
            r.errors
                .push(format!("project: avatar {} has no part", p.avatar));
        }
    }
    let regions = doc.project_avatar().map(|a| &a.regions);
    for gar in &doc.garments {
        check_garment(gar, &fabrics, regions, &mut r);
    }
    r
}

fn finite(v: &[f64]) -> bool {
    v.iter().all(|x| x.is_finite())
}

fn check_garment(
    g: &Garment,
    fabrics: &BTreeSet<&Id>,
    regions: Option<&BTreeMap<String, Region>>,
    r: &mut Report,
) {
    let at = |m: String| format!("garment {}: {m}", g.name);
    if !fabrics.contains(&g.fabric) {
        r.errors
            .push(at(format!("fabric {} has no part", g.fabric)));
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
                    if e.kind != EDGE_POLYLINE {
                        r.errors.push(pa(format!(
                            "edge type {:?} is not supported (made with a newer Vitryne?)",
                            e.kind
                        )));
                    }
                    if !e.points.iter().all(|q| finite(q)) {
                        r.errors.push(pa("an edge point is not a number".into()));
                    }
                }
                (None, false) => {}
            }
        };
        for n in &p.outline {
            check_node(n, true, r);
        }
        for l in &p.lines {
            if l.nodes.len() < 2 {
                r.errors.push(pa("a line needs at least 2 nodes".into()));
            }
            for (k, n) in l.nodes.iter().enumerate() {
                check_node(n, k + 1 < l.nodes.len(), r);
            }
        }
        let outline: BTreeSet<&Id> = p.outline.iter().map(|n| &n.id).collect();
        for f in &p.folds {
            if !outline.contains(&f.from) || !outline.contains(&f.to) || f.from == f.to {
                r.errors
                    .push(pa("fold ends must be two outline nodes".into()));
            }
        }
        for c in &p.cuts {
            cuts.insert(&c.id, (p, c));
            if let Some(fab) = &c.fabric
                && !fabrics.contains(fab)
            {
                r.errors.push(pa(format!("cut fabric {fab} has no part")));
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
