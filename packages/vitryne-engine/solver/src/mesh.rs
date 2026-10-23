// SPDX-License-Identifier: AGPL-3.0-or-later
//! CPU-side cloth mesh. `rest` holds the undeformed shape (for a garment: the flat 2D pattern),
//! `pos` the initial placement. Rest lengths, bending weights and masses come from `rest`.

use std::collections::HashMap;

use glam::Vec3;

#[derive(Debug, Clone)]
pub struct ClothMesh {
    pub rest: Vec<Vec3>,
    pub pos: Vec<Vec3>,
    pub tris: Vec<[u32; 3]>,
    pub pinned: Vec<bool>,
}

/// An edge and the vertices opposite it in its (one or two) adjacent triangles.
#[derive(Debug, Clone)]
pub struct Edge {
    pub v: [u32; 2],
    pub opposite: Vec<u32>,
}

impl ClothMesh {
    pub fn n_verts(&self) -> usize {
        self.pos.len()
    }

    /// Square sheet of `n`×`n` vertices and side `size`, lying in the XZ plane at height `y`,
    /// centred on (0, y, 0). Diagonals alternate so the mesh has no directional bias.
    pub fn grid(n: u32, size: f32, y: f32) -> Self {
        assert!(n >= 2);
        let mut rest = Vec::with_capacity((n * n) as usize);
        for j in 0..n {
            for i in 0..n {
                let u = i as f32 / (n - 1) as f32 - 0.5;
                let v = j as f32 / (n - 1) as f32 - 0.5;
                rest.push(Vec3::new(u * size, y, v * size));
            }
        }
        let id = |i: u32, j: u32| j * n + i;
        let mut tris = Vec::with_capacity(((n - 1) * (n - 1) * 2) as usize);
        for j in 0..n - 1 {
            for i in 0..n - 1 {
                let (a, b, c, d) = (id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1));
                // Wound so normals point +Y.
                if (i + j) % 2 == 0 {
                    tris.push([a, c, b]);
                    tris.push([b, c, d]);
                } else {
                    tris.push([a, c, d]);
                    tris.push([a, d, b]);
                }
            }
        }
        let pos = rest.clone();
        let pinned = vec![false; pos.len()];
        Self {
            rest,
            pos,
            tris,
            pinned,
        }
    }

    /// Lumped vertex masses from rest triangle areas. `density` in kg/m².
    #[allow(clippy::single_range_in_vec_init)]
    pub fn masses(&self, density: f32) -> Vec<f32> {
        self.masses_per_panel(&[density], &[(0..self.n_verts() as u32)])
    }

    /// Lumped vertex masses from rest triangle areas with per-panel densities.
    pub fn masses_per_panel(
        &self,
        panel_densities: &[f32],
        panel_ranges: &[std::ops::Range<u32>],
    ) -> Vec<f32> {
        let density_for = |v: u32| -> f32 {
            if panel_ranges.is_empty() || panel_densities.is_empty() {
                return *panel_densities.first().unwrap_or(&0.15);
            }
            let idx = panel_ranges
                .iter()
                .position(|range| range.contains(&v))
                .unwrap_or(0);
            panel_densities[idx.min(panel_densities.len() - 1)]
        };

        let mut m = vec![0.0; self.n_verts()];
        for t in &self.tris {
            let a = tri_area(
                self.rest[t[0] as usize],
                self.rest[t[1] as usize],
                self.rest[t[2] as usize],
            );
            let d = density_for(t[0]);
            for &v in t {
                m[v as usize] += d * a / 3.0;
            }
        }
        m
    }

    #[allow(clippy::single_range_in_vec_init)]
    pub fn inv_masses(&self, density: f32) -> Vec<f32> {
        self.inv_masses_per_panel(&[density], &[(0..self.n_verts() as u32)])
    }

    pub fn inv_masses_per_panel(
        &self,
        panel_densities: &[f32],
        panel_ranges: &[std::ops::Range<u32>],
    ) -> Vec<f32> {
        self.masses_per_panel(panel_densities, panel_ranges)
            .iter()
            .zip(&self.pinned)
            .map(|(&m, &p)| if p || m == 0.0 { 0.0 } else { 1.0 / m })
            .collect()
    }

    pub fn edges(&self) -> Vec<Edge> {
        let mut map: HashMap<(u32, u32), Vec<u32>> = HashMap::new();
        for t in &self.tris {
            for k in 0..3 {
                let (a, b, o) = (t[k], t[(k + 1) % 3], t[(k + 2) % 3]);
                map.entry((a.min(b), a.max(b))).or_default().push(o);
            }
        }
        let mut edges: Vec<Edge> = map
            .into_iter()
            .map(|((a, b), opposite)| Edge {
                v: [a, b],
                opposite,
            })
            .collect();
        edges.sort_by_key(|e| e.v); // deterministic order -> deterministic colouring
        edges
    }

    /// CSR vertex -> incident triangles, for gathering normals on the GPU without atomics.
    pub fn vertex_triangles(&self) -> (Vec<u32>, Vec<u32>) {
        let n = self.n_verts();
        let mut count = vec![0u32; n + 1];
        for t in &self.tris {
            for &v in t {
                count[v as usize + 1] += 1;
            }
        }
        for i in 0..n {
            count[i + 1] += count[i];
        }
        let mut fill = count.clone();
        let mut list = vec![0u32; count[n] as usize];
        for (ti, t) in self.tris.iter().enumerate() {
            for &v in t {
                list[fill[v as usize] as usize] = ti as u32;
                fill[v as usize] += 1;
            }
        }
        (count, list)
    }

    /// Vertex adjacency over mesh edges.
    pub fn neighbors(&self) -> Vec<Vec<u32>> {
        let mut adj = vec![Vec::new(); self.n_verts()];
        for e in self.edges() {
            adj[e.v[0] as usize].push(e.v[1]);
            adj[e.v[1] as usize].push(e.v[0]);
        }
        adj
    }

    /// Area-weighted vertex normals of the surface at `pos`.
    pub fn vertex_normals(&self, pos: &[Vec3]) -> Vec<Vec3> {
        let mut n = vec![Vec3::ZERO; self.n_verts()];
        for t in &self.tris {
            let f = (pos[t[1] as usize] - pos[t[0] as usize])
                .cross(pos[t[2] as usize] - pos[t[0] as usize]);
            for &v in t {
                n[v as usize] += f;
            }
        }
        n.iter().map(|v| v.normalize_or_zero()).collect()
    }

    pub fn mean_edge_length(&self) -> f32 {
        let e = self.edges();
        e.iter()
            .map(|e| (self.rest[e.v[0] as usize] - self.rest[e.v[1] as usize]).length())
            .sum::<f32>()
            / e.len() as f32
    }
}

pub fn tri_area(a: Vec3, b: Vec3, c: Vec3) -> f32 {
    0.5 * (b - a).cross(c - a).length()
}
