// SPDX-License-Identifier: AGPL-3.0-or-later
//! Seam suggestions for imported pieces, from the pieces' own geometry.
//!
//! An **edge** is the stretch of a piece's outline between two corners (turn points, fold ends
//! and where an internal line meets the outline). Notches inside an edge are kept as fractions
//! of its length. A suggestion pairs two whole edges whose lengths and notches agree.
//!
//! Patents (docs/PATENTS.md, rules 1 and 3): the unit is a whole edge, the user only accepts or
//! rejects a suggestion, and the only inputs are lengths, notch positions and counts. No
//! placement, no body place, no piece role or name, no directed outline graph, no learning.

use crate::aama::{LandmarkKind, Piece};

/// One edge of a piece: its outline stretch from corner `from` to corner `to` (landmark
/// indices, going counter-clockwise).
#[derive(Debug, Clone)]
pub struct Edge {
    pub piece: usize,
    pub from: usize,
    pub to: usize,
    /// Arc-length coordinates along the outline, metres; `s1 < s0` when the edge wraps.
    pub s0: f32,
    pub s1: f32,
    pub length: f32,
    /// Notches strictly inside, as fractions of `length` from `from`, ascending.
    pub notches: Vec<f32>,
    /// Where the edge sits across its piece, -1 (left of the piece's middle) to 1; 0 at the
    /// middle. In the piece's own drawing frame.
    pub side: f32,
    /// The edge ends on the piece's middle line (a centre hem, a centre neck, a fold).
    pub touches_middle: bool,
    /// Signed total turning along the edge, radians (+ = turns left, counter-clockwise).
    pub turn: f32,
    /// How sharply the outline turns at corner `to`, into the next edge, radians (unsigned).
    pub end_turn: f32,
}

/// A proposed seam: side `a` sewn to side `b`, each one whole edge or a chain of two whole
/// edges (a sleeve cap against the front and back armholes). The user accepts or rejects it.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    /// Indices into the edge list.
    pub a: Vec<usize>,
    pub b: Vec<usize>,
    /// 0..1, higher is a better match.
    pub score: f32,
    /// shorter / longer length.
    pub length_ratio: f32,
}

/// Shortest ratio of lengths a suggestion may have (easing and gathers go up to this).
const MIN_RATIO: f32 = 0.6;
/// A suggestion needs at least this score.
const MIN_SCORE: f32 = 0.55;

fn perimeter(p: &Piece) -> (Vec<f32>, f32) {
    let n = p.boundary.len();
    let mut s = Vec::with_capacity(n);
    let mut acc = 0.0;
    for i in 0..n {
        s.push(acc);
        acc += p.boundary[i].distance(p.boundary[(i + 1) % n]);
    }
    (s, acc)
}

/// Position of landmark `k` along the outline, metres.
pub fn landmark_s(p: &Piece, k: usize) -> f32 {
    perimeter(p).0[p.landmarks[k].at]
}

/// The edges of every piece, in piece order then outline order.
pub fn edges(pieces: &[Piece]) -> Vec<Edge> {
    let mut out = Vec::new();
    for (pi, p) in pieces.iter().enumerate() {
        let (s, total) = perimeter(p);
        let corners: Vec<usize> = (0..p.landmarks.len())
            .filter(|&k| p.landmarks[k].kind != LandmarkKind::Notch)
            .collect();
        if corners.is_empty() || total <= 0.0 {
            continue;
        }
        for (ci, &from) in corners.iter().enumerate() {
            let to = corners[(ci + 1) % corners.len()];
            let (s0, s1) = (s[p.landmarks[from].at], s[p.landmarks[to].at]);
            let length = if s1 > s0 || corners.len() == 1 {
                if corners.len() == 1 { total } else { s1 - s0 }
            } else {
                total - s0 + s1
            };
            if length <= 0.0 {
                continue;
            }
            let mut notches: Vec<f32> = (0..p.landmarks.len())
                .filter(|&k| p.landmarks[k].kind == LandmarkKind::Notch)
                .filter_map(|k| {
                    let d = (s[p.landmarks[k].at] - s0).rem_euclid(total);
                    (d > 1e-5 && d < length - 1e-5).then_some(d / length)
                })
                .collect();
            notches.sort_by(f32::total_cmp);
            let (xmin, xmax) = p.boundary.iter().fold((f32::MAX, f32::MIN), |(lo, hi), q| {
                (lo.min(q.x), hi.max(q.x))
            });
            let (mid, half) = ((xmin + xmax) * 0.5, ((xmax - xmin) * 0.5).max(1e-6));
            let n = p.boundary.len();
            let (a, b) = (p.landmarks[from].at, p.landmarks[to].at);
            let verts: Vec<f32> = {
                let mut v = vec![p.boundary[a].x];
                let mut i = (a + 1) % n;
                while i != b {
                    v.push(p.boundary[i].x);
                    i = (i + 1) % n;
                }
                v.push(p.boundary[b].x);
                v
            };
            let turn = {
                let pts: Vec<_> = {
                    let mut v = vec![p.boundary[a]];
                    let mut i = (a + 1) % n;
                    while i != b {
                        v.push(p.boundary[i]);
                        i = (i + 1) % n;
                    }
                    v.push(p.boundary[b]);
                    v
                };
                pts.windows(3)
                    .map(|w| {
                        let (d0, d1) = (w[1] - w[0], w[2] - w[1]);
                        d0.perp_dot(d1).atan2(d0.dot(d1))
                    })
                    .sum::<f32>()
            };
            let end_turn = {
                let d0 = p.boundary[b] - p.boundary[(b + n - 1) % n];
                let d1 = p.boundary[(b + 1) % n] - p.boundary[b];
                d0.perp_dot(d1).atan2(d0.dot(d1)).abs()
            };
            let side = (verts.iter().sum::<f32>() / verts.len() as f32 - mid) / half;
            // An end on the middle line (a centre hem, a centre neck), not an edge passing across it
            // (a sleeve cap).
            let at_middle = |x: f32| ((x - mid) / half).abs() < 0.03;
            let touches_middle = at_middle(verts[0]) || at_middle(*verts.last().unwrap());
            out.push(Edge {
                piece: pi,
                from,
                to,
                s0,
                s1,
                length,
                notches,
                side,
                touches_middle,
                turn,
                end_turn,
            });
        }
    }
    out
}

/// How well two edges agree: lengths, then notches (same count, same places measured from the
/// start of one and the end of the other, as two outlines meet). `None` when they don't.
fn score(a: &Edge, b: &Edge) -> Option<(f32, f32)> {
    let ratio = a.length.min(b.length) / a.length.max(b.length);
    if ratio < MIN_RATIO {
        return None;
    }
    let notch = if a.notches.len() == b.notches.len() {
        if a.notches.is_empty() {
            1.0
        } else {
            // a's start meets b's end: compare a's fractions with b's mirrored.
            let err = a
                .notches
                .iter()
                .zip(b.notches.iter().rev())
                .map(|(x, y)| (x - (1.0 - y)).abs())
                .sum::<f32>()
                / a.notches.len() as f32;
            (1.0 - err * 4.0).clamp(0.0, 1.0)
        }
    } else {
        0.0
    };
    Some((0.5 * ratio + 0.5 * notch, ratio))
}

/// Turning (radians) beyond which an edge counts as curved.
const CURVED: f32 = 0.4;
/// A chain's two sides must agree in length at least this well.
const CHAIN_RATIO: f32 = 0.85;
/// A run of edges carries on through a corner only if the outline turns less than this there
/// (radians, 45°): the corner splits one smooth line. Through a sharper corner, two rectangles'
/// sides and top made one chain against each other, closing them into a bag.
const RUN_CORNER: f32 = std::f32::consts::FRAC_PI_4;

/// The penalties that depend on where the edges sit and how they bend, for sides made of
/// `a_edges` and `b_edges`.
fn adjust(edges: &[Edge], a: &[usize], b: &[usize], mut s: f32) -> f32 {
    let (ea, eb): (Vec<&Edge>, Vec<&Edge>) = (
        a.iter().map(|&i| &edges[i]).collect(),
        b.iter().map(|&i| &edges[i]).collect(),
    );
    let (ta, tb): (f32, f32) = (
        ea.iter().map(|e| e.turn).sum(),
        eb.iter().map(|e| e.turn).sum(),
    );
    if ea.iter().chain(&eb).any(|e| e.touches_middle) {
        // Centre hems, centre necks and folds are usually free edges.
        s -= 0.5;
    }
    // (An edge against its own mirrored copy bends the opposite way there, so it is exempt.)
    if a != b && ta.abs() > CURVED && tb.abs() > CURVED && ta * tb > 0.0 {
        // Two outlines bending the same way rarely fit: a cap is convex, an armhole concave.
        s -= 0.3;
    }
    let same_piece = ea.iter().chain(&eb).all(|e| e.piece == ea[0].piece);
    if same_piece && a != b {
        // Two edges of one piece meet rarely (an underarm seam): second choice.
        s -= 0.2;
    } else if !same_piece && ea.len() == 1 && eb.len() == 1 {
        let (x, y) = (ea[0].side, eb[0].side);
        if x.abs() > 0.3 && y.abs() > 0.3 && x * y > 0.0 {
            // Pieces drawn the same way up meet with opposite sides: a front's left meets a
            // back's right.
            s -= 0.25;
        }
    }
    s
}

/// Runs of consecutive edges on one piece, as lists of edge indices: every single edge, and
/// every run of two or three (never the whole outline) through gentle corners (`RUN_CORNER`).
fn runs(edges: &[Edge]) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    while start < edges.len() {
        let piece = edges[start].piece;
        let end = (start..edges.len())
            .find(|&k| edges[k].piece != piece)
            .unwrap_or(edges.len());
        let m = end - start;
        for k in 0..m {
            for len in 1..=3.min(m.saturating_sub(1).max(1)) {
                let run: Vec<usize> = (0..len).map(|d| start + (k + d) % m).collect();
                // Consecutive: each edge starts where the previous one ended, the outline carrying
                // on there.
                if run.windows(2).all(|w| {
                    edges[w[0]].to == edges[w[1]].from && edges[w[0]].end_turn < RUN_CORNER
                }) {
                    out.push(run);
                }
            }
        }
        start = end;
    }
    out
}

fn side_of(edges: &[Edge], r: &[usize]) -> f32 {
    r.iter().map(|&e| edges[e].side).sum::<f32>() / r.len().max(1) as f32
}

fn run_length(edges: &[Edge], r: &[usize]) -> f32 {
    r.iter().map(|&e| edges[e].length).sum()
}

/// Suggested seams, best first. An edge is used at most as many times as its piece is cut
/// (`quantity`), so a sleeve cut twice pairs with both armholes, and an edge of a piece cut
/// twice may be sewn to its own mirrored copy (a trouser centre seam). A side is a run of up to
/// three consecutive whole edges of one piece; the other side may be two such runs from two
/// pieces (a sleeve cap against the front and back armholes).
pub fn suggest(pieces: &[Piece], edges: &[Edge]) -> Vec<Suggestion> {
    let capacity: Vec<u32> = edges
        .iter()
        .map(|e| pieces[e.piece].quantity.max(1))
        .collect();
    suggest_with(pieces, edges, &capacity)
}

/// As `suggest`, with how many times each edge may still be used (`capacity[i]`: the cuts of
/// its piece where it is free); an edge with none is left out.
pub fn suggest_with(pieces: &[Piece], edges: &[Edge], capacity: &[u32]) -> Vec<Suggestion> {
    let n = edges.len();
    let usable = |i: usize| capacity[i] > 0;
    let rs = runs(edges);
    let adjacent = |i: usize, j: usize| {
        edges[i].piece == edges[j].piece
            && (edges[i].to == edges[j].from || edges[j].to == edges[i].from)
    };
    let mut cand: Vec<Suggestion> = Vec::new();
    // Edge against edge: lengths and notches, as in `score`.
    for i in (0..n).filter(|&i| usable(i)) {
        for j in (i..n).filter(|&j| usable(j)) {
            if i == j {
                // Its own mirrored copy: needs two cuts, and the edge out on the piece's side.
                if pieces[edges[i].piece].quantity < 2
                    || edges[i].side.abs() < 0.6
                    || edges[i].touches_middle
                {
                    continue;
                }
            } else if adjacent(i, j) {
                continue;
            }
            if let Some((s, r)) = score(&edges[i], &edges[j]) {
                let s = adjust(edges, &[i], &[j], s) - if i == j { 0.3 } else { 0.0 };
                if s >= MIN_SCORE {
                    cand.push(Suggestion {
                        a: vec![i],
                        b: vec![j],
                        score: s,
                        length_ratio: r,
                    });
                }
            }
        }
    }
    // A run (of two or three edges) against one edge of another piece, or against two edges or
    // runs of two other pieces. Lengths only (notches are across corners there).
    let rs: Vec<Vec<usize>> = rs
        .into_iter()
        .filter(|r| r.iter().all(|&e| usable(e)))
        .collect();
    let multi: Vec<&Vec<usize>> = rs.iter().filter(|r| r.len() > 1).collect();
    let disjoint = |x: &[usize], y: &[usize]| !x.iter().any(|e| y.contains(e));
    for x in &multi {
        let lx = run_length(edges, x);
        for y in &rs {
            if edges[y[0]].piece == edges[x[0]].piece || !disjoint(x, y) {
                continue;
            }
            let ly = run_length(edges, y);
            let r = lx.min(ly) / lx.max(ly);
            if r >= CHAIN_RATIO {
                let s = adjust(edges, x, y, 0.5 * r + 0.4) - 0.05 * (x.len() + y.len()) as f32;
                if s >= MIN_SCORE && (y.len() == 1 || x[0] < y[0]) {
                    cand.push(Suggestion {
                        a: (*x).clone(),
                        b: y.clone(),
                        score: s,
                        length_ratio: r,
                    });
                }
            }
        }
    }
    // One run or edge against two edges, runs on different pieces.
    for x in &rs {
        let lx = run_length(edges, x);
        for (yi, y) in rs.iter().enumerate() {
            for z in &rs[yi + 1..] {
                if edges[y[0]].piece == edges[z[0]].piece
                    || edges[x[0]].piece == edges[y[0]].piece
                    || edges[x[0]].piece == edges[z[0]].piece
                {
                    continue;
                }
                // The two pieces meet at the junction: a front's left side with a back's right
                // (opposite sides), not the same side.
                let (sy, sz) = (side_of(edges, y), side_of(edges, z));
                if sy.abs() > 0.3 && sz.abs() > 0.3 && sy * sz > 0.0 {
                    continue;
                }
                let ly = run_length(edges, y) + run_length(edges, z);
                let r = lx.min(ly) / lx.max(ly);
                if r < CHAIN_RATIO {
                    continue;
                }
                let yz: Vec<usize> = y.iter().chain(z.iter()).copied().collect();
                let s = adjust(edges, x, &yz, 0.5 * r + 0.4)
                    - 0.05 * (x.len() + y.len() + z.len()) as f32
                    - 0.1;
                if s >= MIN_SCORE {
                    cand.push(Suggestion {
                        a: x.clone(),
                        b: yz,
                        score: s,
                        length_ratio: r,
                    });
                }
            }
        }
    }
    // Best first, and where scores are close the seam that sews more outline wins: a cap
    // against both armholes before an armhole against an armhole.
    let weight = |c: &Suggestion| {
        let len: f32 = c.a.iter().chain(&c.b).map(|&e| edges[e].length).sum();
        c.score + 0.3 * len
    };
    cand.sort_by(|x, y| weight(y).total_cmp(&weight(x)));
    let mut left: Vec<u32> = capacity.to_vec();
    let mut out: Vec<Suggestion> = Vec::new();
    for c in cand {
        let self_pair = c.a == c.b;
        let used: Vec<usize> = if self_pair {
            c.a.clone()
        } else {
            c.a.iter().chain(&c.b).copied().collect()
        };
        // A mirrored-copy seam takes both cuts of its edge.
        let take = if self_pair { 2 } else { 1 };
        let mut need = vec![0u32; n];
        for &e in &used {
            need[e] += take;
        }
        if used.iter().any(|&e| left[e] < need[e]) {
            continue;
        }
        if out.iter().any(|o| o.a == c.a && o.b == c.b) {
            continue;
        }
        for &e in &used {
            left[e] -= take;
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::garment::Garment;

    /// Which sidecar seams a suggestion list reproduces: a seam is found when one suggestion
    /// pairs an edge that overlaps its side `a` with an edge that overlaps its side `b`.
    fn report(name: &str) -> (usize, usize, Vec<String>, Vec<String>) {
        let dir = format!(
            "{}/../../../assets/garments/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        let g = Garment::load_file(&format!("{dir}/garment.toml")).unwrap();
        let es = edges(&g.pieces);
        let sg = suggest(&g.pieces, &es);
        let covers = |run: &str| -> Option<(usize, f32, f32)> {
            let run = run.trim_start_matches('!');
            let (piece, rest) = run.split_once(':')?;
            if rest.starts_with('L') {
                return None;
            }
            let dxf = &g.spec.piece.iter().find(|p| p.name == piece)?.dxf;
            let pi = g.pieces.iter().position(|p| &p.name == dxf)?;
            let tok = |t: &str| -> Option<f32> {
                let (k, f) = match t.split_once('+') {
                    Some((k, f)) => (k.parse::<usize>().ok()?, f.parse::<f32>().ok()?),
                    None => (t.parse::<usize>().ok()?, 0.0),
                };
                let s0 = landmark_s(&g.pieces[pi], k);
                if f == 0.0 {
                    return Some(s0);
                }
                let s1 = landmark_s(&g.pieces[pi], (k + 1) % g.pieces[pi].landmarks.len());
                let total = perimeter(&g.pieces[pi]).1;
                let span = (s1 - s0).rem_euclid(total);
                Some((s0 + f * span).rem_euclid(total))
            };
            let (a, b) = rest.split_once('-')?;
            Some((pi, tok(a)?, tok(b)?))
        };
        let overlap = |e: &Edge, pi: usize, a: f32, b: f32| -> f32 {
            if e.piece != pi {
                return 0.0;
            }
            let total = perimeter(&g.pieces[pi]).1;
            let (ea, run) = (e.s0, (b - a).rem_euclid(total).max(1e-6));
            // Sample the edge and count how much lies inside the run.
            let n = 40;
            let inside = (0..n)
                .filter(|&i| {
                    let s = (ea + e.length * (i as f32 + 0.5) / n as f32).rem_euclid(total);
                    (s - a).rem_euclid(total) <= run
                })
                .count();
            inside as f32 / n as f32
        };
        let (mut found, mut total_seams) = (0, 0);
        let (mut missed, mut extra) = (Vec::new(), Vec::new());
        let mut used = vec![false; sg.len()];
        for s in &g.spec.seam {
            let (ra, rb) = (s.a.list(), s.b.list());
            let side = |runs: &[&str], e: &Edge| {
                runs.iter()
                    .filter_map(|r| covers(r))
                    .map(|(pi, a, b)| overlap(e, pi, a, b))
                    .fold(0.0, f32::max)
            };
            total_seams += 1;
            let covered =
                |runs: &[&str], edges: &[usize]| edges.iter().any(|&e| side(runs, &es[e]) >= 0.4);
            let hit = sg.iter().position(|c| {
                (covered(&ra, &c.a) && covered(&rb, &c.b))
                    || (covered(&ra, &c.b) && covered(&rb, &c.a))
            });
            match hit {
                Some(i) => {
                    found += 1;
                    used[i] = true;
                }
                None => missed.push(format!("{} ({:?} | {:?})", s.name, ra, rb)),
            }
        }
        for (i, c) in sg.iter().enumerate() {
            if !used[i] {
                let label = |ids: &[usize]| {
                    ids.iter()
                        .map(|&e| {
                            format!("{}:{}-{}", g.pieces[es[e].piece].name, es[e].from, es[e].to)
                        })
                        .collect::<Vec<_>>()
                        .join("+")
                };
                extra.push(format!(
                    "{} ~ {} ratio {:.2} score {:.2}",
                    label(&c.a),
                    label(&c.b),
                    c.length_ratio,
                    c.score
                ));
            }
        }
        (found, total_seams, missed, extra)
    }

    #[test]
    #[ignore = "prints the edges of DUMP=<garment> for tuning"]
    fn dump_edges() {
        let name = std::env::var("DUMP").unwrap_or("tshirt".into());
        let g = Garment::load_file(&format!(
            "{}/../../../assets/garments/{name}/garment.toml",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap();
        for (i, e) in edges(&g.pieces).iter().enumerate() {
            println!(
                "{i:2} {:8} {}-{} len {:.3} turn {:+.2} side {:+.2} mid {} notches {:?}",
                g.pieces[e.piece].name,
                e.from,
                e.to,
                e.length,
                e.turn,
                e.side,
                e.touches_middle,
                e.notches
            );
        }
        for p in &g.pieces {
            println!(
                "{} q{} lm {:?}",
                p.name,
                p.quantity,
                p.landmarks
                    .iter()
                    .map(|l| format!("{:?}", l.kind))
                    .collect::<Vec<_>>()
            );
        }
    }

    /// How many of the sidecar's seams the suggestions reproduce, per sample garment. These are
    /// floors measured in M8 (docs/PROGRESS.md): geometry alone sews the T-shirt, mostly the trousers
    /// (the centre front needs the user), and a third of the hoodie, whose cuff, waistband and
    /// binding strips are interchangeable by length. Raising a floor is fine; lowering one is a
    /// quality change that needs its reasoning. The hoodie's went from 5 to 4 when a centre hem
    /// stopped being proposed against the other piece's hem (a wrong suggestion on every
    /// garment) at the price of the pocket bottom, which is sewn along such an edge.
    #[test]
    fn sample_garments() {
        for (name, floor) in [("tshirt", 10), ("trousers", 5), ("hoodie", 4)] {
            let (found, total, missed, extra) = report(name);
            println!("== {name}: {found}/{total} sidecar seams found");
            for m in &missed {
                println!("   missed: {m}");
            }
            for e in &extra {
                println!("   extra:  {e}");
            }
            assert!(
                found >= floor,
                "{name}: {found}/{total} seams, floor {floor}"
            );
        }
    }
}
