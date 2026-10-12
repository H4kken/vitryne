//! Pattern -> cloth mesh. Boundary edges are resampled at the target edge length (paired seam
//! edges get the same segment count), the interior is filled with an equilateral lattice, and
//! everything is triangulated with a constrained Delaunay triangulation (spade). The result is
//! close to uniform: the lattice gives equilateral interior triangles.

use std::collections::HashMap;

use glam::{Vec2, Vec3};
use spade::{ConstrainedDelaunayTriangulation, Point2, Triangulation};

use crate::pattern::{EdgeRef, Pattern, dist_to_polygon, dist_to_polyline, point_in_polygon};
use drape_core::mesh::ClothMesh;

pub struct MeshedPattern {
    /// Rest shape = flat pattern coordinates (x, y, 0). Panels overlap in rest space; that's fine,
    /// rest positions are only used for lengths, areas and bending weights within a panel.
    pub mesh: ClothMesh,
    /// Per panel, the global vertex range and each vertex's 2D pattern coordinate.
    pub panel_vertices: Vec<std::ops::Range<u32>>,
    pub uv: Vec<Vec2>,
    /// Per panel, per edge (boundary edges, then internal lines): global vertex indices along
    /// the edge, both ends included.
    pub edge_vertices: Vec<Vec<Vec<u32>>>,
    /// Sewing pairs from all seams (corner vertices may appear in several seams).
    pub sew_pairs: Vec<(u32, u32)>,
    /// The same pairs grouped by seam name.
    pub seam_pairs: Vec<(String, Vec<(u32, u32)>)>,
    /// Per panel, its triangle range in `mesh.tris`.
    pub panel_tris: Vec<std::ops::Range<usize>>,
}

/// Splits `n` segments over edges of the given lengths, proportionally (largest remainder),
/// at least one each.
fn distribute(lengths: &[f32], n: usize) -> Vec<usize> {
    let total: f32 = lengths.iter().sum();
    let n = n.max(lengths.len());
    let exact: Vec<f32> = lengths
        .iter()
        .map(|l| l / total.max(1e-12) * n as f32)
        .collect();
    let mut out: Vec<usize> = exact.iter().map(|x| (x.floor() as usize).max(1)).collect();
    while out.iter().sum::<usize>() < n {
        let k = (0..out.len())
            .max_by(|&i, &j| {
                (exact[i] - out[i] as f32)
                    .partial_cmp(&(exact[j] - out[j] as f32))
                    .unwrap()
            })
            .unwrap();
        out[k] += 1;
    }
    while out.iter().sum::<usize>() > n {
        let k = (0..out.len())
            .filter(|&i| out[i] > 1)
            .min_by(|&i, &j| {
                (exact[i] - out[i] as f32)
                    .partial_cmp(&(exact[j] - out[j] as f32))
                    .unwrap()
            })
            .unwrap();
        out[k] -= 1;
    }
    out
}

pub fn mesh_pattern(pat: &Pattern, h: f32) -> MeshedPattern {
    // Segment count per (panel, edge): both sides of a seam get the same count.
    let n_of = |l: f32| ((l / h).round() as usize).max(1);
    let mut segs: Vec<Vec<usize>> = pat
        .panels
        .iter()
        .map(|p| {
            p.edges
                .iter()
                .chain(p.inner.iter())
                .map(|e| n_of(e.length()))
                .collect()
        })
        .collect();
    let mut owner: HashMap<(usize, usize), (String, usize)> = HashMap::new();
    let mut assign = |r: EdgeRef, n: usize, seam: &str, segs: &mut Vec<Vec<usize>>| {
        if let Some((other, m)) = owner.get(&(r.panel, r.edge)) {
            assert!(
                *m == n,
                "edge {}/{} is in seams {other} ({m} segments) and {seam} ({n})",
                pat.panels[r.panel].name,
                r.edge
            );
        }
        owner.insert((r.panel, r.edge), (seam.to_string(), n));
        segs[r.panel][r.edge] = n;
    };
    for s in &pat.seams {
        let (la, lb) = (pat.chain_length(&s.a), pat.chain_length(&s.b));
        if (la - lb).abs() / la.max(lb) > 0.10 {
            log::warn!(
                "seam {}: lengths differ by more than 10% ({:.3} vs {:.3} m)",
                s.name,
                la,
                lb
            );
        }
        if s.a.len() == s.b.len() && !s.by_length {
            // Reversed: a's first edge meets b's last.
            let b_in_order: Vec<EdgeRef> = if s.reversed {
                s.b.iter().rev().copied().collect()
            } else {
                s.b.clone()
            };
            for (&ra, &rb) in s.a.iter().zip(&b_in_order) {
                let n = n_of(pat.edge(ra).length().max(pat.edge(rb).length()));
                assign(ra, n, &s.name, &mut segs);
                assign(rb, n, &s.name, &mut segs);
            }
        } else {
            let n = n_of(la.max(lb)).max(s.a.len()).max(s.b.len());
            for chain in [&s.a, &s.b] {
                let lens: Vec<f32> = chain.iter().map(|&r| pat.edge(r).length()).collect();
                for (&r, k) in chain.iter().zip(distribute(&lens, n)) {
                    assign(r, k, &s.name, &mut segs);
                }
            }
        }
    }

    let mut rest: Vec<Vec3> = Vec::new();
    let mut uv: Vec<Vec2> = Vec::new();
    let mut tris: Vec<[u32; 3]> = Vec::new();
    let mut panel_vertices = Vec::new();
    let mut panel_tris = Vec::new();
    let mut edge_vertices: Vec<Vec<Vec<u32>>> = Vec::new();

    for (pi, panel) in pat.panels.iter().enumerate() {
        let base = rest.len() as u32;
        // Boundary points, edge by edge; each edge owns its start corner, not its end.
        let mut boundary: Vec<Vec2> = Vec::new();
        let mut edge_local: Vec<Vec<u32>> = Vec::new();
        for (ei, e) in panel.edges.iter().enumerate() {
            let pts = e.resample(segs[pi][ei]);
            let start = boundary.len() as u32;
            boundary.extend_from_slice(&pts[..pts.len() - 1]);
            edge_local.push((0..pts.len() as u32 - 1).map(|k| start + k).collect());
        }
        let nb = boundary.len() as u32;
        for (ei, ev) in edge_local.iter_mut().enumerate() {
            let next_corner = if ei + 1 < panel.edges.len() {
                edge_local_start(&segs[pi], ei + 1)
            } else {
                0
            };
            ev.push(next_corner % nb);
        }

        // Internal lines: resampled, deduplicated against the boundary (an end may sit on a
        // boundary corner) and each other.
        let mut points = boundary.clone();
        let mut key_of: HashMap<(u32, u32), u32> = points
            .iter()
            .enumerate()
            .map(|(k, p)| ((p.x.to_bits(), p.y.to_bits()), k as u32))
            .collect();
        let mut inner_local: Vec<Vec<u32>> = Vec::new();
        let mut inner_pts: Vec<Vec<Vec2>> = Vec::new();
        for (k, e) in panel.inner.iter().enumerate() {
            let pts = e.resample(segs[pi][panel.edges.len() + k]);
            let ids = pts
                .iter()
                .map(|p| {
                    *key_of
                        .entry((p.x.to_bits(), p.y.to_bits()))
                        .or_insert_with(|| {
                            points.push(*p);
                            points.len() as u32 - 1
                        })
                })
                .collect();
            inner_local.push(ids);
            inner_pts.push(pts);
        }

        // Interior lattice.
        let outline = panel.outline();
        let (mut lo, mut hi) = (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN));
        for p in &outline {
            lo = lo.min(*p);
            hi = hi.max(*p);
        }
        let dy = h * 3f32.sqrt() / 2.0;
        let mut row = 0;
        let mut y = lo.y + dy * 0.5;
        while y < hi.y {
            let mut x = lo.x + if row % 2 == 1 { h * 0.5 } else { 0.0 };
            while x < hi.x {
                let p = Vec2::new(x, y);
                if point_in_polygon(p, &outline)
                    && dist_to_polygon(p, &outline) > 0.6 * h
                    && inner_pts.iter().all(|l| dist_to_polyline(p, l) > 0.6 * h)
                {
                    points.push(p);
                }
                x += h;
            }
            y += dy;
            row += 1;
        }

        // Constrained Delaunay.
        let mut cdt: ConstrainedDelaunayTriangulation<Point2<f64>> =
            ConstrainedDelaunayTriangulation::new();
        let mut handles = Vec::with_capacity(points.len());
        for p in &points {
            handles.push(
                cdt.insert(Point2::new(p.x as f64, p.y as f64))
                    .expect("cdt insert"),
            );
        }
        assert_eq!(
            cdt.num_vertices(),
            points.len(),
            "{}: duplicate points",
            panel.name
        );
        // spade numbers vertices in insertion order; keep our own map to be safe.
        let mut local_of = vec![u32::MAX; points.len()];
        for (k, hnd) in handles.iter().enumerate() {
            local_of[hnd.index()] = k as u32;
        }
        for k in 0..nb as usize {
            cdt.add_constraint(handles[k], handles[(k + 1) % nb as usize]);
        }
        for ids in &inner_local {
            for w in ids.windows(2) {
                cdt.add_constraint(handles[w[0] as usize], handles[w[1] as usize]);
            }
        }
        let mut used = vec![false; points.len()];
        let mut local_tris = Vec::new();
        for f in cdt.inner_faces() {
            let v = f.vertices().map(|v| local_of[v.fix().index()]);
            let (a, b, cc) = (
                points[v[0] as usize],
                points[v[1] as usize],
                points[v[2] as usize],
            );
            // Zero-area triangles along straight boundary runs have their centroid on the
            // boundary, where the inside test is ambiguous: drop them by area first.
            if (b - a).perp_dot(cc - a).abs() < 1e-3 * h * h {
                continue;
            }
            if !point_in_polygon((a + b + cc) / 3.0, &outline) {
                continue;
            }
            for &k in &v {
                used[k as usize] = true;
            }
            local_tris.push(v);
        }
        assert!(
            used[..nb as usize].iter().all(|&u| u),
            "{}: boundary vertex left without triangles",
            panel.name
        );
        // Drop unused interior points (none expected), compacting indices.
        let mut remap = vec![u32::MAX; points.len()];
        for (k, p) in points.iter().enumerate() {
            if used[k] {
                remap[k] = rest.len() as u32;
                rest.push(Vec3::new(p.x, p.y, 0.0));
                uv.push(*p);
            }
        }
        let tri_start = tris.len();
        for t in local_tris {
            // Ensure counter-clockwise winding in pattern space.
            let [a, b, c] = t.map(|k| remap[k as usize]);
            let (pa, pb, pc) = (uv[a as usize], uv[b as usize], uv[c as usize]);
            if (pb - pa).perp_dot(pc - pa) >= 0.0 {
                tris.push([a, b, c])
            } else {
                tris.push([a, c, b])
            }
        }
        edge_vertices.push(
            edge_local
                .into_iter()
                .chain(inner_local)
                .map(|ev| ev.into_iter().map(|k| remap[k as usize]).collect())
                .collect(),
        );
        panel_vertices.push(base..rest.len() as u32);
        panel_tris.push(tri_start..tris.len());
    }

    let chain_vertices = |chain: &[EdgeRef]| {
        let mut out: Vec<u32> = Vec::new();
        for r in chain {
            let mut ev = edge_vertices[r.panel][r.edge].clone();
            if r.backward {
                ev.reverse();
            }
            let skip = usize::from(!out.is_empty());
            out.extend_from_slice(&ev[skip..]);
        }
        out
    };
    let mut sew_pairs = Vec::new();
    let mut seam_pairs = Vec::new();
    for s in &pat.seams {
        let ea = chain_vertices(&s.a);
        let mut eb = chain_vertices(&s.b);
        assert_eq!(ea.len(), eb.len(), "seam {}: vertex counts differ", s.name);
        if s.reversed {
            eb.reverse();
        }
        let pairs: Vec<(u32, u32)> = ea.into_iter().zip(eb).filter(|(i, j)| i != j).collect();
        sew_pairs.extend_from_slice(&pairs);
        seam_pairs.push((s.name.clone(), pairs));
    }

    let pos = rest.clone();
    let pinned = vec![false; rest.len()];
    MeshedPattern {
        mesh: ClothMesh {
            rest,
            pos,
            tris,
            pinned,
        },
        panel_vertices,
        uv,
        edge_vertices,
        sew_pairs,
        seam_pairs,
        panel_tris,
    }
}

fn edge_local_start(segs: &[usize], ei: usize) -> u32 {
    segs[..ei].iter().sum::<usize>() as u32
}
