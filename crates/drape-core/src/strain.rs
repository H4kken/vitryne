// SPDX-License-Identifier: AGPL-3.0-or-later
//! Edge strain diagnostics (M2): how far each stretch constraint is from its rest length,
//! (length - rest) / rest, as a distribution, by region and by panel. Benchmark-only, on the
//! CPU from a position readback.

use glam::Vec3;
use serde::Serialize;

use crate::{
    engine::{Body, Garment},
    sim::Collider,
};

/// Distribution of edge strain over a set of edges (fractions, not percent).
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct StrainStats {
    pub edges: usize,
    pub mean: f32,
    pub p50: f32,
    pub p90: f32,
    pub p99: f32,
    pub p999: f32,
    pub max: f32,
}

impl StrainStats {
    pub fn of(mut e: Vec<f32>) -> Self {
        if e.is_empty() {
            return Self::default();
        }
        e.sort_by(f32::total_cmp);
        let n = e.len();
        let q = |f: f64| e[((n - 1) as f64 * f).round() as usize];
        Self {
            edges: n,
            mean: e.iter().sum::<f32>() / n as f32,
            p50: q(0.5),
            p90: q(0.9),
            p99: q(0.99),
            p999: q(0.999),
            max: e[n - 1],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Hotspot {
    pub strain: f32,
    pub midpoint: [f32; 3],
    pub group: String,
    pub region: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct StrainReport {
    pub all: StrainStats,
    /// Each edge is in exactly one region, in this priority: `seam` (an endpoint within
    /// `SEAM_RINGS` edges of a sewn vertex), `contact` (an endpoint within the collision
    /// thickness + `CONTACT_MARGIN` of the body), `free`.
    pub by_region: Vec<(&'static str, StrainStats)>,
    pub by_group: Vec<(String, StrainStats)>,
    /// Per named seam: strain of the seam line itself, (3D length - rest length) / rest length,
    /// for side A and side B.
    pub seam_lines: Vec<(String, f32, f32)>,
    /// Fraction of edges over 1, 3, 8, 20 and 50% strain.
    pub over: Vec<(f32, f32)>,
    pub hotspots: Vec<Hotspot>,
}

pub const SEAM_RINGS: usize = 2;
pub const CONTACT_MARGIN: f32 = 0.001;

/// Per-edge strain of the stretch constraints (sewing excluded), in constraint order.
pub fn edge_strains(garment: &Garment, pos: &[Vec3]) -> Vec<f32> {
    garment
        .constraints
        .stretch
        .items
        .iter()
        .map(|s| {
            if s.rest > 0.0 {
                (pos[s.i as usize] - pos[s.j as usize]).length() / s.rest - 1.0
            } else {
                0.0
            }
        })
        .collect()
}

/// Vertices within `rings` edges of a sewn vertex.
fn near_seam(garment: &Garment, rings: usize) -> Vec<bool> {
    let n = garment.mesh().n_verts();
    let adj = garment.mesh().neighbors();
    let mut mark = vec![false; n];
    let mut front: Vec<u32> = Vec::new();
    for s in &garment.constraints.sew.items {
        for v in [s.i, s.j] {
            if !mark[v as usize] {
                mark[v as usize] = true;
                front.push(v);
            }
        }
    }
    for _ in 0..rings {
        let mut next = Vec::new();
        for v in front {
            for &u in &adj[v as usize] {
                if !mark[u as usize] {
                    mark[u as usize] = true;
                    next.push(u);
                }
            }
        }
        front = next;
    }
    mark
}

pub fn report(garment: &Garment, body: &Body, thickness: f32, pos: &[Vec3]) -> StrainReport {
    let e = edge_strains(garment, pos);
    #[cfg(not(target_arch = "wasm32"))]
    if let Ok(path) = std::env::var("DRAPE_STRAIN_DUMP") {
        // Debug: one line per edge: strain, midpoint, body distance, vertex indices.
        let sdf = match &body.collider {
            Collider::Sdf(s) => Some(s),
            _ => None,
        };
        let lines: Vec<String> = garment
            .constraints
            .stretch
            .items
            .iter()
            .zip(&e)
            .map(|(s, x)| {
                let m = (pos[s.i as usize] + pos[s.j as usize]) * 0.5;
                let d = sdf.map_or(0.0, |sdf| sdf.sample(m));
                format!("{x} {} {} {} {d} {} {}", m.x, m.y, m.z, s.i, s.j)
            })
            .collect();
        std::fs::write(&path, lines.join("\n")).ok();
        let sew: Vec<String> = garment
            .constraints
            .sew
            .items
            .iter()
            .map(|s| format!("{} {}", s.i, s.j))
            .collect();
        std::fs::write(format!("{path}.sew"), sew.join("\n")).ok();
        let rest: Vec<String> = garment
            .mesh()
            .rest
            .iter()
            .zip(pos)
            .map(|(r, p)| format!("{} {} {} {} {}", r.x, r.y, p.x, p.y, p.z))
            .collect();
        std::fs::write(format!("{path}.verts"), rest.join("\n")).ok();
        let tris: Vec<String> = garment
            .mesh()
            .tris
            .iter()
            .map(|t| format!("{} {} {}", t[0], t[1], t[2]))
            .collect();
        std::fs::write(format!("{path}.tris"), tris.join("\n")).ok();
    }
    let items = &garment.constraints.stretch.items;
    let seam = near_seam(garment, SEAM_RINGS);
    let contact: Vec<bool> = match &body.collider {
        Collider::Sdf(sdf) => pos
            .iter()
            .map(|p| sdf.sample(*p) < thickness + CONTACT_MARGIN)
            .collect(),
        Collider::Sphere(s) => pos
            .iter()
            .map(|p| (*p - s.truncate()).length() < s.w + thickness + CONTACT_MARGIN)
            .collect(),
    };
    let region = |k: usize| {
        let (i, j) = (items[k].i as usize, items[k].j as usize);
        if seam[i] || seam[j] {
            "seam"
        } else if contact[i] || contact[j] {
            "contact"
        } else {
            "free"
        }
    };
    let group_of = |v: u32| {
        garment
            .desc
            .groups
            .iter()
            .position(|(_, r)| r.contains(&v))
            .unwrap_or(usize::MAX)
    };
    let valid: Vec<usize> = (0..items.len()).filter(|&k| items[k].rest > 0.0).collect();

    let by_region = ["seam", "contact", "free"]
        .into_iter()
        .map(|r| {
            let v = valid
                .iter()
                .filter(|&&k| region(k) == r)
                .map(|&k| e[k])
                .collect();
            (r, StrainStats::of(v))
        })
        .collect();
    let by_group = garment
        .desc
        .groups
        .iter()
        .enumerate()
        .map(|(g, (name, _))| {
            let v = valid
                .iter()
                .filter(|&&k| group_of(items[k].i) == g)
                .map(|&k| e[k])
                .collect();
            (name.clone(), StrainStats::of(v))
        })
        .collect();
    let all: Vec<f32> = valid.iter().map(|&k| e[k]).collect();
    let over = [0.01, 0.03, 0.08, 0.20, 0.50]
        .into_iter()
        .map(|t| {
            (
                t,
                all.iter().filter(|&&x| x > t).count() as f32 / all.len().max(1) as f32,
            )
        })
        .collect();
    let mut order = valid.clone();
    order.sort_by(|&a, &b| e[b].total_cmp(&e[a]));
    let hotspots = order
        .iter()
        .take(10)
        .map(|&k| {
            let s = &items[k];
            Hotspot {
                strain: e[k],
                midpoint: ((pos[s.i as usize] + pos[s.j as usize]) * 0.5).to_array(),
                group: garment
                    .desc
                    .groups
                    .get(group_of(s.i))
                    .map(|g| g.0.clone())
                    .unwrap_or_default(),
                region: region(k),
            }
        })
        .collect();
    let line = |vs: &[u32]| {
        let (mut l, mut r) = (0.0, 0.0);
        for w in vs.windows(2) {
            let (a, b) = (w[0] as usize, w[1] as usize);
            l += (pos[a] - pos[b]).length();
            r += (garment.mesh().rest[a] - garment.mesh().rest[b]).length();
        }
        if r > 0.0 { l / r - 1.0 } else { 0.0 }
    };
    let seam_lines = garment
        .desc
        .seams
        .iter()
        .map(|(name, pairs)| {
            let a: Vec<u32> = pairs.iter().map(|p| p.0).collect();
            let b: Vec<u32> = pairs.iter().map(|p| p.1).collect();
            (name.clone(), line(&a), line(&b))
        })
        .collect();
    StrainReport {
        all: StrainStats::of(all),
        seam_lines,
        by_region,
        by_group,
        over,
        hotspots,
    }
}
