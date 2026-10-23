// SPDX-License-Identifier: AGPL-3.0-or-later
//! Constraint construction and graph colouring (hard rule 4: no float atomics, so the
//! stretch/bend passes are Gauss-Seidel per colour with no write conflicts inside a colour).

use bytemuck::{Pod, Zeroable};
use glam::Vec3;

use crate::mesh::{ClothMesh, tri_area};

/// GPU layout must match `Stretch` in sim.wgsl (16 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct Stretch {
    pub i: u32,
    pub j: u32,
    pub rest: f32,
    pub compliance: f32,
}

/// Isometric bending (Bergou et al. 2006, Wardetzky et al. 2007) on an edge stencil.
/// Vertices `idx = [x0, x1, x2, x3]`: `x0-x1` is the shared edge, `x2`/`x3` are the opposite
/// vertices. With cotangent weights `k`, the curvature vector is `C = Σ k_i x_i`. It is zero
/// for a flat stencil and linear in the positions, so the XPBD update is closed-form and has no
/// singularity at flat, unlike dihedral-angle bending. Energy = 3 kb / (A0+A1) |C|².
/// GPU layout must match `Bend` in sim.wgsl (48 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct Bend {
    pub idx: [u32; 4],
    pub k: [f32; 4],
    pub compliance: f32,
    pub _pad: [f32; 3],
}

#[derive(Debug, Clone, Copy)]
pub struct Material {
    /// kg/m²
    pub density: f32,
    /// Edge spring stiffness, N/m. XPBD compliance = 1/k.
    pub stretch_k: f32,
    /// Bending rigidity, N·m.
    pub bend_kb: f32,
}

impl Material {
    /// Roughly a mid-weight cotton jersey. Placeholder values, calibration is out of scope.
    pub fn cotton() -> Self {
        Self {
            density: 0.15,
            stretch_k: 1.0e4,
            bend_kb: 5.0e-6,
        }
    }
}

/// Constraints sorted so each colour is a contiguous range `(offset, count)`.
#[derive(Debug, Clone)]
pub struct Colored<T> {
    pub items: Vec<T>,
    pub ranges: Vec<(u32, u32)>,
}

impl<T> Colored<T> {
    pub fn n_colors(&self) -> usize {
        self.ranges.len()
    }
}

/// Greedy colouring: each constraint takes the lowest colour none of its vertices has used yet.
/// Max 64 colours (u64 mask per vertex), which is far more than meshes need.
pub fn color<T: Copy>(
    items: &[T],
    n_verts: usize,
    verts: impl Fn(&T) -> [u32; 4],
    arity: usize,
) -> Colored<T> {
    let mut used = vec![0u64; n_verts];
    let mut color_of = Vec::with_capacity(items.len());
    let mut n_colors = 0usize;
    for it in items {
        let vs = verts(it);
        let mask = vs[..arity].iter().fold(0u64, |m, &v| m | used[v as usize]);
        let c = (!mask).trailing_zeros() as usize;
        assert!(c < 64, "more than 64 colours needed");
        for &v in &vs[..arity] {
            used[v as usize] |= 1 << c;
        }
        color_of.push(c);
        n_colors = n_colors.max(c + 1);
    }
    let mut buckets: Vec<Vec<T>> = vec![Vec::new(); n_colors];
    for (it, &c) in items.iter().zip(&color_of) {
        buckets[c].push(*it);
    }
    let mut out = Vec::with_capacity(items.len());
    let mut ranges = Vec::with_capacity(n_colors);
    for b in buckets {
        ranges.push((out.len() as u32, b.len() as u32));
        out.extend(b);
    }
    Colored { items: out, ranges }
}

pub struct Constraints {
    pub stretch: Colored<Stretch>,
    pub bend: Colored<Bend>,
    /// Zero-length seam constraints (`rest` = 0; compliance comes from the ramp schedule).
    pub sew: Colored<Stretch>,
}

fn cot(a: Vec3, b: Vec3) -> f32 {
    // cot of the angle between a and b
    let c = a.dot(b);
    let s = a.cross(b).length();
    c / s.max(1e-12)
}

impl Constraints {
    #[allow(clippy::single_range_in_vec_init)]
    pub fn build(mesh: &ClothMesh, mat: &Material) -> Self {
        Self::build_with_panel_materials(mesh, &[*mat], &[(0..mesh.n_verts() as u32)])
    }

    /// Builds stretch and bend constraints with per-panel materials.
    pub fn build_with_panel_materials(
        mesh: &ClothMesh,
        panel_mats: &[Material],
        panel_ranges: &[std::ops::Range<u32>],
    ) -> Self {
        let n = mesh.n_verts();
        let r = &mesh.rest;
        let edges = mesh.edges();

        let mat_for = |v: u32| -> &Material {
            if panel_ranges.is_empty() || panel_mats.is_empty() {
                return &panel_mats[0];
            }
            let idx = panel_ranges
                .iter()
                .position(|range| range.contains(&v))
                .unwrap_or(0);
            &panel_mats[idx.min(panel_mats.len() - 1)]
        };

        let stretch: Vec<Stretch> = edges
            .iter()
            .map(|e| {
                let m = mat_for(e.v[0]);
                Stretch {
                    i: e.v[0],
                    j: e.v[1],
                    rest: (r[e.v[0] as usize] - r[e.v[1] as usize]).length(),
                    compliance: 1.0 / m.stretch_k,
                }
            })
            .collect();

        let bend: Vec<Bend> = edges
            .iter()
            .filter(|e| e.opposite.len() == 2)
            .map(|e| {
                let [i0, i1] = e.v;
                let (i2, i3) = (e.opposite[0], e.opposite[1]);
                let (x0, x1, x2, x3) = (
                    r[i0 as usize],
                    r[i1 as usize],
                    r[i2 as usize],
                    r[i3 as usize],
                );
                // Angles of each triangle at the shared-edge endpoints.
                let a0a = cot(x1 - x0, x2 - x0);
                let a1a = cot(x0 - x1, x2 - x1);
                let a0b = cot(x1 - x0, x3 - x0);
                let a1b = cot(x0 - x1, x3 - x1);
                let k = [a1a + a1b, a0a + a0b, -(a0a + a1a), -(a0b + a1b)];
                let area = tri_area(x0, x1, x2) + tri_area(x0, x1, x3);
                let m = mat_for(i0);
                Bend {
                    idx: [i0, i1, i2, i3],
                    k,
                    compliance: area / (6.0 * m.bend_kb),
                    _pad: [0.0; 3],
                }
            })
            .collect();

        Self {
            stretch: color(&stretch, n, |s| [s.i, s.j, 0, 0], 2),
            bend: color(&bend, n, |b| b.idx, 4),
            sew: Colored {
                items: Vec::new(),
                ranges: Vec::new(),
            },
        }
    }

    /// Sewing constraints between vertex pairs (each pair: two vertices that must meet).
    pub fn set_sewing(&mut self, pairs: &[(u32, u32)], n_verts: usize) {
        let items: Vec<Stretch> = pairs
            .iter()
            .map(|&(i, j)| Stretch {
                i,
                j,
                rest: 0.0,
                compliance: 0.0,
            })
            .collect();
        self.sew = color(&items, n_verts, |s| [s.i, s.j, 0, 0], 2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_coloring<T>(c: &Colored<T>, verts: impl Fn(&T) -> Vec<u32>) {
        for &(off, cnt) in &c.ranges {
            let mut seen = std::collections::HashSet::new();
            for it in &c.items[off as usize..(off + cnt) as usize] {
                for v in verts(it) {
                    assert!(seen.insert(v), "vertex {v} appears twice in one colour");
                }
            }
        }
    }

    #[test]
    fn grid_coloring_is_conflict_free() {
        let m = ClothMesh::grid(20, 1.0, 0.0);
        let c = Constraints::build(&m, &Material::cotton());
        check_coloring(&c.stretch, |s| vec![s.i, s.j]);
        check_coloring(&c.bend, |b| b.idx.to_vec());
        assert!(
            c.stretch.n_colors() <= 12,
            "stretch colours: {}",
            c.stretch.n_colors()
        );
        assert!(
            c.bend.n_colors() <= 24,
            "bend colours: {}",
            c.bend.n_colors()
        );
    }

    #[test]
    fn bending_vector_zero_when_flat_nonzero_when_folded() {
        let m = ClothMesh::grid(6, 1.0, 0.0);
        let c = Constraints::build(&m, &Material::cotton());
        for b in &c.bend.items {
            let sum_k: f32 = b.k.iter().sum();
            assert!(
                sum_k.abs() < 1e-4,
                "weights must sum to 0 (translation invariance)"
            );
            let cv: Vec3 = (0..4).map(|i| b.k[i] * m.rest[b.idx[i] as usize]).sum();
            assert!(
                cv.length() < 1e-5,
                "flat stencil must have zero curvature, got {cv}"
            );
        }
        // Lift one opposite vertex: curvature becomes nonzero.
        let b = c.bend.items[0];
        let mut p: Vec<Vec3> = b.idx.iter().map(|&i| m.rest[i as usize]).collect();
        p[2].y += 0.05;
        let cv: Vec3 = (0..4).map(|i| b.k[i] * p[i]).sum();
        assert!(cv.length() > 1e-3);
    }
}
