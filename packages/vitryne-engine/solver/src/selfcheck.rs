// SPDX-License-Identifier: AGPL-3.0-or-later
//! Cloth self-intersection count (CPU, on a position readback). Benchmark-only: the
//! self-collision metric. Triangle pairs are found with a uniform grid over their bounding boxes
//! and tested exactly (an edge of one crossing the other's interior). Pairs that share a vertex,
//! directly or through a seam, are skipped: they touch by construction.

use std::collections::{HashMap, HashSet};

use glam::{IVec3, Vec3};
use serde::Serialize;

use crate::{constraints::Constraints, mesh::ClothMesh};

#[derive(Debug, Clone, Serialize)]
pub struct SelfIntersections {
    /// Intersecting triangle pairs.
    pub pairs: usize,
    /// Distinct triangles in at least one intersecting pair.
    pub triangles: usize,
    /// Pairs also present in the previous check (`persistent_since`), if one was given.
    pub persistent_pairs: Option<usize>,
    /// Up to 8 pair centroids, to locate hotspots.
    pub sample: Vec<[f32; 3]>,
    #[serde(skip)]
    pub pair_set: HashSet<(u32, u32)>,
}

/// Welded vertex ids: sewn vertices get one representative.
pub fn weld_map(n: usize, cons: &Constraints) -> Vec<u32> {
    let mut parent: Vec<u32> = (0..n as u32).collect();
    fn find(p: &mut [u32], mut x: u32) -> u32 {
        while p[x as usize] != x {
            p[x as usize] = p[p[x as usize] as usize];
            x = p[x as usize];
        }
        x
    }
    for s in &cons.sew.items {
        let (a, b) = (find(&mut parent, s.i), find(&mut parent, s.j));
        if a != b {
            parent[a.max(b) as usize] = a.min(b);
        }
    }
    (0..n as u32).map(|v| find(&mut parent, v)).collect()
}

/// Segment p→q against triangle (a, b, c), Möller-Trumbore. Coplanar contact is not counted.
fn segment_hits_triangle(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3) -> bool {
    let d = q - p;
    let (e1, e2) = (b - a, c - a);
    let h = d.cross(e2);
    let det = e1.dot(h);
    if det.abs() < 1e-14 {
        return false;
    }
    let f = 1.0 / det;
    let s = p - a;
    let u = f * s.dot(h);
    if !(0.0..=1.0).contains(&u) {
        return false;
    }
    let qv = s.cross(e1);
    let v = f * d.dot(qv);
    if v < 0.0 || u + v > 1.0 {
        return false;
    }
    let t = f * e2.dot(qv);
    (0.0..=1.0).contains(&t)
}

fn tris_intersect(t: [Vec3; 3], o: [Vec3; 3]) -> bool {
    (0..3).any(|k| segment_hits_triangle(t[k], t[(k + 1) % 3], o[0], o[1], o[2]))
        || (0..3).any(|k| segment_hits_triangle(o[k], o[(k + 1) % 3], t[0], t[1], t[2]))
}

pub fn check(
    mesh: &ClothMesh,
    weld: &[u32],
    pos: &[Vec3],
    previous: Option<&SelfIntersections>,
) -> SelfIntersections {
    let cell = 2.0 * mesh.mean_edge_length();
    let tri = |t: &[u32; 3]| [pos[t[0] as usize], pos[t[1] as usize], pos[t[2] as usize]];
    let cell_of = |p: Vec3| (p / cell).floor().as_ivec3();
    let mut grid: HashMap<IVec3, Vec<u32>> = HashMap::new();
    let mut boxes = Vec::with_capacity(mesh.tris.len());
    for (ti, t) in mesh.tris.iter().enumerate() {
        let p = tri(t);
        let (lo, hi) = (p[0].min(p[1]).min(p[2]), p[0].max(p[1]).max(p[2]));
        boxes.push((lo, hi));
        if !(lo.is_finite() && hi.is_finite()) {
            continue;
        }
        let (a, b) = (cell_of(lo), cell_of(hi));
        for z in a.z..=b.z {
            for y in a.y..=b.y {
                for x in a.x..=b.x {
                    grid.entry(IVec3::new(x, y, z)).or_default().push(ti as u32);
                }
            }
        }
    }
    let mut pairs = HashSet::new();
    for (c, list) in &grid {
        for (k, &i) in list.iter().enumerate() {
            let ti = mesh.tris[i as usize];
            let wi = ti.map(|v| weld[v as usize]);
            let (lo_i, hi_i) = boxes[i as usize];
            for &j in &list[k + 1..] {
                let (lo_j, hi_j) = boxes[j as usize];
                let (lo, hi) = (lo_i.max(lo_j), hi_i.min(hi_j));
                // Overlapping boxes, tested once: in the cell holding the overlap's min corner.
                if lo.cmpgt(hi).any() || cell_of(lo) != *c {
                    continue;
                }
                let tj = mesh.tris[j as usize];
                if tj.iter().any(|v| wi.contains(&weld[*v as usize])) {
                    continue;
                }
                if tris_intersect(tri(&ti), tri(&tj)) {
                    pairs.insert((i.min(j), i.max(j)));
                }
            }
        }
    }
    let triangles = pairs
        .iter()
        .flat_map(|&(a, b)| [a, b])
        .collect::<HashSet<_>>()
        .len();
    let mut sorted: Vec<_> = pairs.iter().copied().collect();
    sorted.sort_unstable();
    let sample = sorted
        .iter()
        .take(8)
        .map(|&(a, b)| {
            let (pa, pb) = (tri(&mesh.tris[a as usize]), tri(&mesh.tris[b as usize]));
            ((pa[0] + pa[1] + pa[2] + pb[0] + pb[1] + pb[2]) / 6.0).to_array()
        })
        .collect();
    SelfIntersections {
        pairs: pairs.len(),
        triangles,
        persistent_pairs: previous.map(|p| pairs.intersection(&p.pair_set).count()),
        sample,
        pair_set: pairs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constraints::Material;

    #[test]
    fn crossing_sheets_intersect_and_flat_sheet_does_not() {
        let mut m = ClothMesh::grid(6, 1.0, 0.0);
        let cons = Constraints::build(&m, &Material::cotton());
        let weld = weld_map(m.n_verts(), &cons);
        assert_eq!(check(&m, &weld, &m.pos.clone(), None).pairs, 0);
        // Fold the far half back through the near half: x > 0.1 mirrored under, slightly
        // rotated so it pierces the near half.
        for p in &mut m.pos {
            if p.x > 0.1 {
                *p = Vec3::new(
                    0.2 - p.x,
                    (p.x - 0.1) * 0.5 * if p.z > 0.0 { 1.0 } else { -1.0 },
                    p.z,
                );
            }
        }
        let r = check(&m, &weld, &m.pos.clone(), None);
        assert!(r.pairs > 0, "folded-through sheet must have intersections");
        let again = check(&m, &weld, &m.pos.clone(), Some(&r));
        assert_eq!(again.persistent_pairs, Some(r.pairs));
    }
}
