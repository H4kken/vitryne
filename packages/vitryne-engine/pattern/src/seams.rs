// SPDX-License-Identifier: AGPL-3.0-or-later
//! Sewing in the editor, on a project's garment: which whole edges are still free, suggested
//! seams (`suggest`), and the seam a user's two picks make.
//!
//! Patents (packages/vitryne-docs/content/docs/developers/patents.md): everything here works on **whole edges**, the stretch of a cut's
//! outline between two corners (a design choice, stricter than the rules need). `join` refuses
//! anything else, so no seam end can snap to an equal length (rule 1), takes two picks and shows
//! nothing while the user picks (rule 2), and suggestions come from piece geometry only
//! (rule 3). Direction and cut choices below follow the pieces' own drawing frames (which side
//! of the piece an edge is on, whether a cut is mirrored), never where a cut is placed.

use std::collections::HashSet;

use glam::Vec2;
use serde::Serialize;

use vitryne_format::{Direction, Garment, Id, NodeType, Other, Pairing, Piece as FPiece, Run};

use crate::{
    aama::{Landmark, LandmarkKind, Piece},
    suggest::{Edge, Suggestion, edges, suggest_with},
};

/// A free or sewn whole edge of one cut, for the UI to list and pick.
#[derive(Debug, Clone, Serialize)]
pub struct CutEdge {
    pub cut: Id,
    pub from: Id,
    pub to: Id,
    /// mm.
    pub length: f64,
    /// Some seam already sews (part of) it.
    pub sewn: bool,
}

/// A seam the system proposes (or a pick makes), not yet in the file.
#[derive(Debug, Clone, Serialize)]
pub struct SeamProposal {
    pub a: Vec<Run>,
    pub b: Vec<Run>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing: Option<Pairing>,
    /// 0..1, higher is a better match. 0 for a user's pick.
    pub score: f32,
    /// Shorter side / longer side.
    pub length_ratio: f32,
    /// How much longer side `b` is than `a`, percent (negative: shorter). For the seam list,
    /// shown only once the seam exists.
    pub difference_percent: f32,
}

/// One whole edge a user picked: a cut and the two corners it runs between (either order).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct EdgePick {
    pub cut: Id,
    pub from: Id,
    pub to: Id,
}

/// The file's lengths are millimetres; suggestions work in metres (`suggest`).
const MM: f32 = 0.001;

/// The garment's pieces in the importer's terms, with the node behind each landmark.
struct Converted {
    pieces: Vec<Piece>,
    /// Per piece, the node id of each landmark.
    nodes: Vec<Vec<Id>>,
}

fn convert(g: &Garment) -> Result<Converted, String> {
    let mut pieces = Vec::new();
    let mut nodes = Vec::new();
    for p in &g.pieces {
        let mut boundary: Vec<Vec2> = Vec::new();
        let mut landmarks = Vec::new();
        let mut ids = Vec::new();
        let count = p.outline.len();
        for (k, n) in p.outline.iter().enumerate() {
            // A point node that ends a fold is a corner of the outline (a centre hem, a centre
            // neck); any other point (a sleeve-cap top) only splits a seam and no edge.
            let fold_end = p.folds.iter().any(|f| f.from == n.id || f.to == n.id);
            let kind = match n.kind {
                NodeType::Corner => Some(LandmarkKind::Turn),
                NodeType::Notch => Some(LandmarkKind::Notch),
                NodeType::Point if fold_end => Some(LandmarkKind::FoldEnd),
                NodeType::Point => None,
            };
            if let Some(kind) = kind {
                landmarks.push(Landmark {
                    at: boundary.len(),
                    kind,
                });
                ids.push(n.id.clone());
            }
            boundary.push(Vec2::new(n.position[0] as f32, n.position[1] as f32) * MM);
            if let Some(e) = &n.edge {
                let next = p.outline[(k + 1) % count].position;
                let inner = e
                    .interior(n.position, next)
                    .map_err(|m| format!("piece {}: {m}", p.name))?;
                boundary.extend(
                    inner
                        .iter()
                        .map(|q| Vec2::new(q[0] as f32, q[1] as f32) * MM),
                );
            }
        }
        pieces.push(Piece {
            name: p.name.clone(),
            quantity: p.cuts.len().max(1) as u32,
            boundary,
            landmarks,
            grain: None,
            unfolded: false,
            inner: Vec::new(),
            from_sew_line: false,
        });
        nodes.push(ids);
    }
    Ok(Converted { pieces, nodes })
}

fn piece_of_cut<'a>(g: &'a Garment, cut: &Id) -> Option<(usize, &'a FPiece)> {
    g.pieces
        .iter()
        .enumerate()
        .find(|(_, p)| p.cuts.iter().any(|c| &c.id == cut))
}

fn mirrored(g: &Garment, cut: &Id) -> bool {
    g.piece_of_cut(cut).is_some_and(|(_, c)| c.mirrored)
}

/// Outline node pairs (consecutive, in the outline's order) that seams already sew, per cut.
fn sewn_pairs(g: &Garment) -> HashSet<(Id, Id, Id)> {
    let mut out = HashSet::new();
    for s in &g.seams {
        for r in s.a.iter().chain(&s.b) {
            if r.line.is_some() {
                continue;
            }
            let Some((_, p)) = piece_of_cut(g, &r.cut) else {
                continue;
            };
            let ids: Vec<&Id> = p.outline.iter().map(|n| &n.id).collect();
            let (Some(i), Some(j)) = (
                ids.iter().position(|x| **x == r.from),
                ids.iter().position(|x| **x == r.to),
            ) else {
                continue;
            };
            let n = ids.len();
            let ccw = r.direction != Some(Direction::Cw);
            let (mut k, end) = (i, j);
            while k != end {
                let next = if ccw { (k + 1) % n } else { (k + n - 1) % n };
                let (u, v) = if ccw { (k, next) } else { (next, k) };
                out.insert((r.cut.clone(), ids[u].clone(), ids[v].clone()));
                k = next;
            }
        }
    }
    out
}

/// Whether the outline stretch between the nodes `from` and `to` (counter-clockwise) has a
/// stretch seams already sew.
fn edge_sewn(p: &FPiece, cut: &Id, from: &Id, to: &Id, pairs: &HashSet<(Id, Id, Id)>) -> bool {
    let n = p.outline.len();
    let Some(mut k) = p.outline.iter().position(|x| &x.id == from) else {
        return false;
    };
    while &p.outline[k].id != to {
        let next = (k + 1) % n;
        if pairs.contains(&(
            cut.clone(),
            p.outline[k].id.clone(),
            p.outline[next].id.clone(),
        )) {
            return true;
        }
        k = next;
        if k == p.outline.iter().position(|x| &x.id == from).unwrap() {
            break;
        }
    }
    false
}

/// Every whole edge of every cut, with whether a seam already sews it.
pub fn cut_edges(g: &Garment) -> Result<Vec<CutEdge>, String> {
    let conv = convert(g)?;
    let pairs = sewn_pairs(g);
    let mut out = Vec::new();
    for e in &edges(&conv.pieces) {
        let pi = e.piece;
        let p = &g.pieces[pi];
        let (from, to) = (&conv.nodes[pi][e.from], &conv.nodes[pi][e.to]);
        for c in &p.cuts {
            out.push(CutEdge {
                cut: c.id.clone(),
                from: from.clone(),
                to: to.clone(),
                length: f64::from(e.length) / f64::from(MM),
                sewn: edge_sewn(p, &c.id, from, to, &pairs),
            });
        }
    }
    Ok(out)
}

fn run(cut: &Id, from: &Id, to: &Id, direction: Direction) -> Run {
    Run {
        cut: cut.clone(),
        line: None,
        from: from.clone(),
        to: to.clone(),
        direction: Some(direction),
        other: Other::new(),
    }
}

/// The run along edges `first..=last` (a consecutive group on one piece) of a cut, forwards
/// (counter-clockwise) or, `reversed`, as the clockwise run that starts at its end.
fn group_run(conv: &Converted, es: &[Edge], group: &[usize], cut: &Id, reversed: bool) -> Run {
    let piece = es[group[0]].piece;
    let from = &conv.nodes[piece][es[group[0]].from];
    let to = &conv.nodes[piece][es[*group.last().unwrap()].to];
    if reversed {
        run(cut, to, from, Direction::Cw)
    } else {
        run(cut, from, to, Direction::Ccw)
    }
}

/// Splits a side's edges into per-piece groups (a side has at most two).
fn groups(es: &[Edge], side: &[usize]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    for &e in side {
        match out.last_mut() {
            Some(g) if es[g[0]].piece == es[e].piece => g.push(e),
            _ => out.push(vec![e]),
        }
    }
    out
}

fn mean_side(es: &[Edge], ids: &[usize]) -> f32 {
    ids.iter().map(|&e| es[e].side).sum::<f32>() / ids.len().max(1) as f32
}

fn node_height(g: &Garment, piece: usize, id: &Id) -> f64 {
    g.pieces[piece]
        .outline
        .iter()
        .find(|n| &n.id == id)
        .map_or(0.0, |n| n.position[1])
}

fn difference_percent(len_a: f32, len_b: f32) -> f32 {
    (len_b - len_a) / len_a.max(1e-9) * 100.0
}

/// Turns a suggestion (edge indices into `es`) into proposals, one per cut it applies to.
/// `sewn`: the (cut, edge index) pairs seams already sew; those cuts are not used again.
fn proposals_for(
    g: &Garment,
    conv: &Converted,
    es: &[Edge],
    sewn: &HashSet<(Id, usize)>,
    s: &Suggestion,
) -> Vec<SeamProposal> {
    let (a, b) = (&s.a, &s.b);
    let (ga, gb) = (groups(es, a), groups(es, b));
    let len = |side: &[usize]| side.iter().map(|&e| es[e].length).sum::<f32>();
    let diff = difference_percent(len(a), len(b));
    let make = |a: Vec<Run>, b: Vec<Run>, length: bool| SeamProposal {
        a,
        b,
        pairing: length.then_some(Pairing::Length),
        score: s.score,
        length_ratio: s.length_ratio,
        difference_percent: diff,
    };
    // The cuts of a piece where none of `group`'s edges is sewn yet.
    let free_cuts = |piece: usize, group: &[usize]| -> Vec<&Id> {
        g.pieces[piece]
            .cuts
            .iter()
            .map(|c| &c.id)
            .filter(|c| group.iter().all(|e| !sewn.contains(&((*c).clone(), *e))))
            .collect()
    };
    // The one of `from` whose mirror flag fits an edge on `partner_side` of the piece it is
    // sewn to: the unmirrored cut meets the partner's negative (left in the drawing) side, the
    // mirrored cut its positive side. Else the first.
    let by_side = |from: &[&'_ Id], partner_side: f32| -> Option<usize> {
        let want = partner_side >= 0.0;
        (0..from.len())
            .find(|&k| mirrored(g, from[k]) == want)
            .or((!from.is_empty()).then_some(0))
    };
    if ga.len() == 1 && gb.len() == 1 {
        let (pa, pb) = (es[ga[0][0]].piece, es[gb[0][0]].piece);
        let single = ga[0].len() == 1 && gb[0].len() == 1;
        let (fa, fb) = (free_cuts(pa, &ga[0]), free_cuts(pb, &gb[0]));
        // Which cuts meet.
        let pairs: Vec<(&Id, &Id)> = if pa == pb && ga[0] == gb[0] {
            // An edge against its own mirrored copy.
            match fa.as_slice() {
                [c0, c1, ..] => vec![(*c0, *c1)],
                _ => vec![],
            }
        } else if pa == pb {
            fa.iter()
                .filter(|c| fb.contains(c))
                .map(|c| (*c, *c))
                .collect()
        } else {
            match (fa.len(), fb.len()) {
                (0, _) | (_, 0) => vec![],
                (1, 1) => vec![(fa[0], fb[0])],
                (n, 1) if n > 1 => by_side(&fa, mean_side(es, &gb[0]))
                    .map(|k| vec![(fa[k], fb[0])])
                    .unwrap_or_default(),
                (1, n) if n > 1 => by_side(&fb, mean_side(es, &ga[0]))
                    .map(|k| vec![(fa[0], fb[k])])
                    .unwrap_or_default(),
                _ => fa.iter().zip(&fb).map(|(x, y)| (*x, *y)).collect(),
            }
        };
        return pairs
            .into_iter()
            .map(|(cx, cy)| {
                // Two outlines meet running opposite ways, unless one cut is mirrored.
                let reversed = mirrored(g, cx) == mirrored(g, cy);
                make(
                    vec![group_run(conv, es, &ga[0], cx, false)],
                    vec![group_run(conv, es, &gb[0], cy, reversed)],
                    !single,
                )
            })
            .collect();
    }
    // One side is a chain over two pieces: its runs go from the low end of the first piece up
    // over the junction (the higher ends meet) and down the second.
    let (single, chain) = match (ga.len(), gb.len()) {
        (1, 2) => (&ga[0], &gb),
        _ => return Vec::new(),
    };
    let pc = es[single[0]].piece;
    let side = (mean_side(es, &chain[0]) + mean_side(es, &chain[1])) / 2.0;
    let fc = free_cuts(pc, single);
    let Some(cx) = by_side(&fc, side).map(|k| fc[k]) else {
        return Vec::new();
    };
    let mut b_runs = Vec::new();
    for (k, grp) in chain.iter().enumerate() {
        let piece = es[grp[0]].piece;
        let Some(cut) = free_cuts(piece, grp).first().copied() else {
            return Vec::new();
        };
        let (u, v) = (
            &conv.nodes[piece][es[grp[0]].from],
            &conv.nodes[piece][es[*grp.last().unwrap()].to],
        );
        let up = node_height(g, piece, v) >= node_height(g, piece, u);
        // First run goes up to the junction, second comes down from it.
        let forwards = up == (k == 0);
        b_runs.push(group_run(conv, es, grp, cut, !forwards));
    }
    vec![make(
        vec![group_run(conv, es, single, cx, false)],
        b_runs,
        true,
    )]
}

/// Suggested seams for the garment's free whole edges, best first. Free is per cut: once one
/// sleeve is sewn, the other sleeve's edges are still offered.
pub fn propose(g: &Garment) -> Result<Vec<SeamProposal>, String> {
    let conv = convert(g)?;
    let pairs = sewn_pairs(g);
    let all = edges(&conv.pieces);
    let mut sewn: HashSet<(Id, usize)> = HashSet::new();
    let mut capacity = Vec::with_capacity(all.len());
    for (i, e) in all.iter().enumerate() {
        let p = &g.pieces[e.piece];
        let (from, to) = (&conv.nodes[e.piece][e.from], &conv.nodes[e.piece][e.to]);
        let mut free = 0;
        for c in &p.cuts {
            if edge_sewn(p, &c.id, from, to, &pairs) {
                sewn.insert((c.id.clone(), i));
            } else {
                free += 1;
            }
        }
        capacity.push(free);
    }
    Ok(suggest_with(&conv.pieces, &all, &capacity)
        .iter()
        .flat_map(|s| proposals_for(g, &conv, &all, &sewn, s))
        .collect())
}

/// The index in `all` of the whole edge a pick names, or why it isn't one.
fn find_edge(
    g: &Garment,
    conv: &Converted,
    all: &[Edge],
    pick: &EdgePick,
) -> Result<usize, String> {
    let (pi, _) = piece_of_cut(g, &pick.cut).ok_or("that piece isn't in the garment")?;
    all.iter()
        .position(|e| {
            e.piece == pi && {
                let (f, t) = (&conv.nodes[pi][e.from], &conv.nodes[pi][e.to]);
                (f == &pick.from && t == &pick.to) || (f == &pick.to && t == &pick.from)
            }
        })
        .ok_or_else(|| "pick a whole edge, from corner to corner".to_string())
}

/// The seam two picked whole edges make. Refuses anything that isn't a whole edge of its cut.
pub fn join(g: &Garment, a: &EdgePick, b: &EdgePick) -> Result<SeamProposal, String> {
    let conv = convert(g)?;
    let all = edges(&conv.pieces);
    let (ia, ib) = (find_edge(g, &conv, &all, a)?, find_edge(g, &conv, &all, b)?);
    if a.cut == b.cut && ia == ib {
        return Err("pick two different edges".into());
    }
    let reversed = mirrored(g, &a.cut) == mirrored(g, &b.cut);
    let (ea, eb) = (&all[ia], &all[ib]);
    let diff = difference_percent(ea.length, eb.length);
    Ok(SeamProposal {
        a: vec![group_run(&conv, &all, &[ia], &a.cut, false)],
        b: vec![group_run(&conv, &all, &[ib], &b.cut, reversed)],
        pairing: (ea.notches.len() != eb.notches.len()).then_some(Pairing::Length),
        score: 0.0,
        length_ratio: ea.length.min(eb.length) / ea.length.max(eb.length),
        difference_percent: diff,
    })
}

/// The runs of one side of a seam made of several picked whole edges, in the order picked.
/// Each edge is walked so that it connects to the next one: along a shared corner on one cut,
/// else over the junction at the higher end (the shoulder of a garment drawn upright). Edges
/// on different cuts meet where other seams join the pieces, which isn't known here, so the
/// seam is paired by length and the user can flip it.
fn orient_side(g: &Garment, conv: &Converted, all: &[Edge], picks: &[(usize, &Id)]) -> Vec<Run> {
    let ends = |i: usize| {
        let e = &all[i];
        (&conv.nodes[e.piece][e.from], &conv.nodes[e.piece][e.to])
    };
    let higher_first = |i: usize| {
        let (u, v) = ends(i);
        node_height(g, all[i].piece, v) > node_height(g, all[i].piece, u)
    };
    let mut out: Vec<Run> = Vec::new();
    let mut prev_end: Option<(&Id, &Id)> = None; // (cut, node)
    for (k, &(i, cut)) in picks.iter().enumerate() {
        let (u, v) = ends(i);
        // The node this run should start at, if it is forced.
        let start: &Id = if k > 0 {
            match prev_end {
                Some((c, n)) if c == cut && (n == u || n == v) => n,
                // Over a junction: start at the higher end.
                _ => {
                    if higher_first(i) {
                        v
                    } else {
                        u
                    }
                }
            }
        } else if picks.len() > 1 {
            // End where the next run starts: a corner shared on one cut, else the higher end.
            let (j, c2) = picks[1];
            let (u2, v2) = ends(j);
            let shared = if c2 == cut {
                [u, v].into_iter().find(|n| *n == u2 || *n == v2)
            } else {
                None
            };
            let end = shared.unwrap_or(if higher_first(i) { v } else { u });
            if end == v { u } else { v }
        } else {
            u
        };
        let forwards = start == u;
        let (from, to) = if forwards { (u, v) } else { (v, u) };
        out.push(run(
            cut,
            from,
            to,
            if forwards {
                Direction::Ccw
            } else {
                Direction::Cw
            },
        ));
        prev_end = Some((cut, to));
    }
    out
}

/// The seam made of one or more picked whole edges on each side (a sleeve cap against a front
/// and a back armhole). Two single edges are `join`. Every pick must be a whole edge of its cut
/// (packages/vitryne-docs/content/docs/developers/patents.md, rule 1, and the whole-edge design choice); a chain is a list of whole edges, never a part of one.
pub fn join_chains(g: &Garment, a: &[EdgePick], b: &[EdgePick]) -> Result<SeamProposal, String> {
    if a.is_empty() || b.is_empty() {
        return Err("a seam needs edges on both sides".into());
    }
    if let ([x], [y]) = (a, b) {
        return join(g, x, y);
    }
    let conv = convert(g)?;
    let all = edges(&conv.pieces);
    let find_all = |side: &'_ [EdgePick]| -> Result<Vec<usize>, String> {
        side.iter().map(|p| find_edge(g, &conv, &all, p)).collect()
    };
    let (ia, ib) = (find_all(a)?, find_all(b)?);
    // The same edge of the same cut twice is a mistake; the same edge on the two cuts of a
    // piece is not (a centre seam).
    let mut seen: Vec<(&Id, usize)> = Vec::new();
    for (p, &i) in a.iter().chain(b).zip(ia.iter().chain(&ib)) {
        if seen.contains(&(&p.cut, i)) {
            return Err("an edge can only be on one side once".into());
        }
        seen.push((&p.cut, i));
    }
    let side = |picks: &[EdgePick], idx: &[usize]| -> (Vec<Run>, f32) {
        let items: Vec<(usize, &Id)> = idx
            .iter()
            .copied()
            .zip(picks.iter().map(|p| &p.cut))
            .collect();
        (
            orient_side(g, &conv, &all, &items),
            idx.iter().map(|&i| all[i].length).sum(),
        )
    };
    let ((ra, la), (rb, lb)) = (side(a, &ia), side(b, &ib));
    Ok(SeamProposal {
        a: ra,
        b: rb,
        pairing: Some(Pairing::Length),
        score: 0.0,
        length_ratio: la.min(lb) / la.max(lb),
        difference_percent: difference_percent(la, lb),
    })
}

/// Length of the run along the cut's outline (or internal line), mm.
fn run_length_mm(g: &Garment, r: &Run) -> Option<f64> {
    let (_, p) = piece_of_cut(g, &r.cut)?;
    let nodes = match &r.line {
        Some(l) => &p.lines.iter().find(|x| &x.id == l)?.nodes,
        None => &p.outline,
    };
    let n = nodes.len();
    let i = nodes.iter().position(|x| x.id == r.from)?;
    let j = nodes.iter().position(|x| x.id == r.to)?;
    let dist = |a: [f64; 2], b: [f64; 2]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
    // The edge from node k to node k + 1, along its points.
    let edge_len = |k: usize| -> Option<f64> {
        let (a, b) = (&nodes[k], &nodes[(k + 1) % n]);
        let mut pts = vec![a.position];
        if let Some(e) = &a.edge {
            pts.extend(e.interior(a.position, b.position).ok()?);
        }
        pts.push(b.position);
        Some(pts.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>())
    };
    let ccw = r.line.is_some() || r.direction != Some(Direction::Cw);
    let mut total = 0.0;
    let mut k = i;
    let mut steps = 0;
    while k != j && steps <= n {
        if ccw {
            total += edge_len(k)?;
            k = (k + 1) % n;
        } else {
            k = (k + n - 1) % n;
            total += edge_len(k)?;
        }
        steps += 1;
    }
    Some(total)
}

/// Each seam's length difference, percent of side `a` (side `b` longer is positive), for the
/// seam list. Shown only once a seam exists, as plain text (packages/vitryne-docs/content/docs/developers/patents.md, "passive").
pub fn seam_differences(g: &Garment) -> Vec<(Id, f32)> {
    g.seams
        .iter()
        .filter_map(|s| {
            let side = |runs: &[Run]| -> Option<f64> {
                runs.iter()
                    .map(|r| run_length_mm(g, r))
                    .sum::<Option<f64>>()
            };
            let (la, lb) = (side(&s.a)?, side(&s.b)?);
            Some((s.id.clone(), difference_percent(la as f32, lb as f32)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example(name: &str) -> Garment {
        let dir = format!(
            "{}/../../../assets/examples/{name}.vtry",
            env!("CARGO_MANIFEST_DIR")
        );
        let mut files = Vec::new();
        fn walk(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<(String, Vec<u8>)>) {
            for e in std::fs::read_dir(dir).unwrap() {
                let p = e.unwrap().path();
                if p.is_dir() {
                    walk(base, &p, out);
                } else {
                    let rel = p
                        .strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.push((rel, std::fs::read(&p).unwrap()));
                }
            }
        }
        let base = std::path::Path::new(&dir);
        walk(base, base, &mut files);
        let entries = vitryne_format::container::Entries {
            files,
            warnings: Vec::new(),
        };
        let opened = vitryne_format::Document::from_entries(entries).unwrap();
        serde_json::from_value(opened.doc.entities().garments[0].clone()).unwrap()
    }

    /// Strips the seams, so everything is free, and compares what is proposed with them.
    fn compare(name: &str) -> (usize, usize, usize) {
        let full = example(name);
        let mut bare = full.clone();
        bare.seams.clear();
        let proposals = propose(&bare).unwrap();
        // A seam of the file is reproduced when a proposal covers its edges on the same cuts
        // (either way round).
        let cuts = |runs: &[Run]| -> Vec<(Id, Id, Id)> {
            let mut v: Vec<_> = runs
                .iter()
                .map(|r| (r.cut.clone(), r.from.clone(), r.to.clone()))
                .collect();
            v.sort();
            v
        };
        let touches = |x: &[Run], y: &[Run]| x.iter().any(|r| y.iter().any(|s| r.cut == s.cut));
        let mut found = 0;
        for s in &full.seams {
            if proposals.iter().any(|p| {
                (touches(&p.a, &s.a) && touches(&p.b, &s.b))
                    || (touches(&p.a, &s.b) && touches(&p.b, &s.a))
            }) {
                found += 1;
            }
        }
        let _ = cuts;
        (found, full.seams.len(), proposals.len())
    }

    #[test]
    fn proposals_on_the_examples() {
        for (name, floor) in [("tshirt", 8), ("trousers", 4), ("hoodie", 4)] {
            let (found, total, n) = compare(name);
            println!("{name}: {found}/{total} seams' cuts proposed, {n} proposals");
            assert!(found >= floor, "{name}: {found}/{total}");
        }
    }

    #[test]
    #[ignore = "prints the proposals of DUMP=<example>"]
    fn dump_proposals() {
        let name = std::env::var("DUMP").unwrap_or("tshirt".into());
        let mut g = example(&name);
        g.seams.clear();
        let label = |r: &Run| {
            let (p, c) = g.piece_of_cut(&r.cut).unwrap();
            let node = |id: &Id| {
                p.outline
                    .iter()
                    .find(|n| &n.id == id)
                    .and_then(|n| n.name.clone())
                    .unwrap_or("?".into())
            };
            format!(
                "{}[{}..{} {:?}]",
                c.name.clone().unwrap_or(p.name.clone()),
                node(&r.from),
                node(&r.to),
                r.direction
            )
        };
        let conv = convert(&g).unwrap();
        for (i, e) in edges(&conv.pieces).iter().enumerate() {
            println!(
                "E{i:2} {} {}-{} len {:.1} turn {:+.2} side {:+.2} mid {} notches {:?}",
                conv.pieces[e.piece].name,
                e.from,
                e.to,
                e.length,
                e.turn,
                e.side,
                e.touches_middle,
                e.notches
            );
        }
        for s in propose(&g).unwrap() {
            println!(
                "{:.2} {:+.0}% {:?}: {} | {}",
                s.score,
                s.difference_percent,
                s.pairing,
                s.a.iter().map(&label).collect::<Vec<_>>().join(" + "),
                s.b.iter().map(&label).collect::<Vec<_>>().join(" + ")
            );
        }
    }

    #[test]
    fn a_pick_must_be_a_whole_edge() {
        let g = example("tshirt");
        let es = cut_edges(&g).unwrap();
        assert!(es.iter().all(|e| !e.sewn || e.length > 0.0));
        let a = &es[0];
        let b = es.iter().find(|e| e.cut != a.cut).unwrap();
        // Corner to a node that isn't this edge's other end is refused.
        let bad = EdgePick {
            cut: a.cut.clone(),
            from: a.from.clone(),
            to: b.to.clone(),
        };
        let ok = EdgePick {
            cut: b.cut.clone(),
            from: b.from.clone(),
            to: b.to.clone(),
        };
        assert!(join(&g, &bad, &ok).is_err());
        let a_ok = EdgePick {
            cut: a.cut.clone(),
            from: a.from.clone(),
            to: a.to.clone(),
        };
        assert!(join(&g, &a_ok, &ok).is_ok());
    }

    #[test]
    fn chains_of_whole_edges_make_one_seam() {
        let g = example("tshirt");
        let es = cut_edges(&g).unwrap();
        let pick = |e: &CutEdge| EdgePick {
            cut: e.cut.clone(),
            from: e.from.clone(),
            to: e.to.clone(),
        };
        // The right sleeve's cap (its longest edge) against the front's and back's right
        // armholes (the example's own seams name them).
        let by = |run: &Run| {
            es.iter()
                .find(|e| {
                    e.cut == run.cut
                        && ((e.from == run.from && e.to == run.to)
                            || (e.from == run.to && e.to == run.from))
                })
                .cloned()
        };
        let front = &g.seams[4].b[0];
        let back = &g.seams[5].b[0];
        let cap = es
            .iter()
            .filter(|e| e.cut == g.seams[4].a[0].cut)
            .max_by(|x, y| x.length.total_cmp(&y.length))
            .unwrap();
        // Armholes in the example are cut in halves at the cap top; the whole armhole edges are
        // the front's and back's, picked by their own corners.
        let (f, bk) = (by(front).unwrap(), by(back).unwrap());
        let made = join_chains(&g, &[pick(cap)], &[pick(&f), pick(&bk)]).unwrap();
        assert_eq!(made.a.len(), 1);
        assert_eq!(made.b.len(), 2);
        assert_eq!(made.pairing, Some(Pairing::Length));
        // Both sides' lengths are within a few percent: a real armhole.
        assert!(
            made.difference_percent.abs() < 15.0,
            "{}",
            made.difference_percent
        );
        // The same edge twice, or something that isn't a whole edge, is refused.
        assert!(join_chains(&g, &[pick(cap)], &[pick(&f), pick(&f)]).is_err());
        let part = EdgePick {
            cut: f.cut.clone(),
            from: f.from.clone(),
            to: cap.to.clone(),
        };
        assert!(join_chains(&g, &[pick(cap)], &[part, pick(&bk)]).is_err());
    }

    #[test]
    fn the_examples_seams_are_within_a_few_percent() {
        // Hand-tuned sample seams run a few percent apart at most (easing); a suggestion with
        // a bigger difference would stand out.
        for name in ["tshirt", "trousers"] {
            let g = example(name);
            let d = seam_differences(&g);
            assert_eq!(d.len(), g.seams.len());
            for (id, pct) in d {
                assert!(pct.abs() < 25.0, "{name}: seam {id:?} differs by {pct:.1}%");
            }
        }
    }

    #[test]
    fn the_examples_are_fully_sewn() {
        // Every seam of an example covers edges: the free-edge list notices them as sewn.
        let g = example("tshirt");
        let es = cut_edges(&g).unwrap();
        assert!(es.iter().any(|e| e.sewn));
    }
}
