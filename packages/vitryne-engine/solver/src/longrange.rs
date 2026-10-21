// SPDX-License-Identifier: AGPL-3.0-or-later
//! Long-range stretch limits (M2): unilateral distance constraints between vertices of the same
//! panel that are several edges apart in the rest shape, |x_i - x_j| <= d_ij, where d_ij is
//! their rest distance.
//!
//! Why: with one Gauss-Seidel iteration per substep, a correction travels about one edge per
//! substep, so the stretch error of a hanging panel grows with the square of its size in edges
//! (docs/history/PROGRESS.md S2; M2 in docs/PROGRESS.md). A constraint spanning 4, 16 or 64 edges
//! carries the load across the panel in one step.
//!
//! Method: the unilateral long-distance constraints of Hierarchical Position Based Dynamics
//! (Müller 2008, "Hierarchical Position Based Dynamics", VRIPHYS), applied directly between
//! fine-mesh vertices, without HPBD's coarse meshes and interpolation; and, like Long Range
//! Attachments (Kim, Chentanez & Müller 2012, "Long Range Attachments - A Method to Simulate
//! Inextensible Clothing in Computer Games", SCA), active only when stretched, with the rest
//! distance measured along the cloth, so they never resist folding or bending.
//!
//! The rest shape is the flat pattern, so the straight rest segment between two vertices of a
//! panel is their geodesic distance, if it lies inside the panel. For an inextensible cloth
//! their 3D distance can never exceed it. Pairs whose segment leaves the panel (across a
//! concave notch, e.g. between the sleeves of a front) are skipped.
//!
//! Solved as Jacobi with constraint averaging (longrange.wgsl): two dispatches per substep
//! whatever the number of constraints, instead of one per graph colour.

use bytemuck::{Pod, Zeroable};
use glam::{Vec2, Vec3};
use serde::Serialize;
use wgpu::util::DeviceExt;

use crate::mesh::ClothMesh;

pub const SHADER: &str = include_str!("../shaders/longrange.wgsl");

/// Long-range constraints as CSR, both directions stored: vertex `i`'s partners are
/// `items[offsets[i]..offsets[i + 1]]`.
#[derive(Debug, Clone, Default)]
pub struct LongRange {
    pub offsets: Vec<u32>,
    pub items: Vec<LongRangeItem>,
}

/// GPU layout must match `Lr` in longrange.wgsl (8 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct LongRangeItem {
    pub j: u32,
    /// Rest distance; negative for pairs across a seam, which only act once the seams have
    /// closed (`LongRangeGpu::set_cross`).
    pub rest: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongRangeInfo {
    /// Spans, in mean rest edge lengths.
    pub spans_edges: Vec<f32>,
    /// Constraints (each pair once), per span.
    pub pairs: Vec<usize>,
    /// Across seams: spans and constraints per span.
    pub cross_spans_edges: Vec<f32>,
    pub cross_pairs: Vec<usize>,
    /// Candidate pairs skipped because the rest segment leaves the panel.
    pub skipped_outside: usize,
    pub build_ms: f64,
}

/// Uniform grid over rest-space triangles, for point-in-panel tests.
struct TriGrid {
    min: Vec2,
    inv: f32,
    dims: (usize, usize),
    cells: Vec<Vec<u32>>,
}

impl TriGrid {
    fn new(uv: &[Vec2], tris: &[[u32; 3]], cell: f32) -> Self {
        let p = |v: u32| uv[v as usize];
        let (mut lo, mut hi) = (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN));
        for &r in uv {
            lo = lo.min(r);
            hi = hi.max(r);
        }
        let inv = 1.0 / cell;
        let dims = (
            ((hi.x - lo.x) * inv) as usize + 1,
            ((hi.y - lo.y) * inv) as usize + 1,
        );
        let mut cells = vec![Vec::new(); dims.0 * dims.1];
        for (t, tri) in tris.iter().enumerate() {
            let (a, b, c) = (p(tri[0]), p(tri[1]), p(tri[2]));
            let (tl, th) = (a.min(b).min(c), a.max(b).max(c));
            let (x0, y0) = (
                ((tl.x - lo.x) * inv) as usize,
                ((tl.y - lo.y) * inv) as usize,
            );
            let (x1, y1) = (
                ((th.x - lo.x) * inv) as usize,
                ((th.y - lo.y) * inv) as usize,
            );
            for y in y0..=y1.min(dims.1 - 1) {
                for x in x0..=x1.min(dims.0 - 1) {
                    cells[y * dims.0 + x].push(t as u32);
                }
            }
        }
        Self {
            min: lo,
            inv,
            dims,
            cells,
        }
    }

    fn cell(&self, q: Vec2) -> Option<&[u32]> {
        let x = ((q.x - self.min.x) * self.inv).floor();
        let y = ((q.y - self.min.y) * self.inv).floor();
        if x < 0.0 || y < 0.0 || x as usize >= self.dims.0 || y as usize >= self.dims.1 {
            return None;
        }
        Some(&self.cells[y as usize * self.dims.0 + x as usize])
    }
}

fn in_tri(q: Vec2, a: Vec2, b: Vec2, c: Vec2) -> bool {
    let e = 1e-7;
    let cr = |p: Vec2, u: Vec2, v: Vec2| (u - p).perp_dot(v - p);
    let (d0, d1, d2) = (cr(q, a, b), cr(q, b, c), cr(q, c, a));
    let neg = d0 < -e || d1 < -e || d2 < -e;
    let pos = d0 > e || d1 > e || d2 > e;
    !(neg && pos)
}

/// Builds the constraints: for each vertex and each span `s` (in mean edge lengths), partners at
/// rest distance ~s in three directions (0, 60 and 120 degrees; the reverse directions come
/// from the partners' own picks), within the same panel and with the rest segment inside it.
///
/// Across seams (`sew`: the sewing pairs), for each span `s` in `cross_spans_edges` and each
/// sewn pair: a vertex s/2 into each panel, straight in from the seam, with rest distance the
/// shortest path through any pair of the same seam, min |a - s_A| + |s_B - b|, both segments
/// inside their panels. That's the geodesic on the sewn surface for paths that cross this seam
/// once, so it bounds their 3D distance like the in-panel distances do.
pub fn build(
    mesh: &ClothMesh,
    sew: &[(u32, u32)],
    spans_edges: &[f32],
    cross_spans_edges: &[f32],
) -> (LongRange, LongRangeInfo) {
    let t0 = web_time::Instant::now();
    let n = mesh.n_verts();
    let e = mesh.mean_edge_length();
    let rest = &mesh.rest;

    // Panels = connected components over mesh edges (seams aren't edges).
    let adj = mesh.neighbors();
    let mut comp = vec![u32::MAX; n];
    let mut n_comp = 0;
    for s in 0..n {
        if comp[s] != u32::MAX {
            continue;
        }
        let mut stack = vec![s as u32];
        comp[s] = n_comp;
        while let Some(v) = stack.pop() {
            for &u in &adj[v as usize] {
                if comp[u as usize] == u32::MAX {
                    comp[u as usize] = n_comp;
                    stack.push(u);
                }
            }
        }
        n_comp += 1;
    }
    let tri_comp: Vec<u32> = mesh.tris.iter().map(|t| comp[t[0] as usize]).collect();
    // Each panel's rest shape in its own plane (garments: the pattern plane z = 0; the sheet
    // scene: y = const). A panel that isn't flat at rest gets no long-range constraints.
    let mut normal = vec![Vec3::ZERO; n_comp as usize];
    for (t, &c) in mesh.tris.iter().zip(&tri_comp) {
        let [a, b, cc] = t.map(|v| rest[v as usize]);
        normal[c as usize] += (b - a).cross(cc - a);
    }
    let origin: Vec<Vec3> = (0..n_comp)
        .map(|c| rest[comp.iter().position(|&k| k == c).unwrap()])
        .collect();
    let normal: Vec<Vec3> = normal.iter().map(|v| v.normalize_or(Vec3::Z)).collect();
    let mut flat = vec![true; n_comp as usize];
    for v in 0..n {
        let c = comp[v] as usize;
        if (rest[v] - origin[c]).dot(normal[c]).abs() > 1e-4 {
            flat[c] = false;
        }
    }
    let uv: Vec<Vec2> = (0..n)
        .map(|v| {
            let c = comp[v] as usize;
            let (b1, b2) = normal[c].any_orthonormal_pair();
            let d = rest[v] - origin[c];
            Vec2::new(d.dot(b1), d.dot(b2))
        })
        .collect();
    let r2 = |v: u32| uv[v as usize];
    let tgrid = TriGrid::new(&uv, &mesh.tris, e);
    let inside = |q: Vec2, c: u32| {
        tgrid.cell(q).is_some_and(|ts| {
            ts.iter().any(|&t| {
                tri_comp[t as usize] == c && {
                    let [a, b, cc] = mesh.tris[t as usize];
                    in_tri(q, r2(a), r2(b), r2(cc))
                }
            })
        })
    };
    // Vertex grid in rest space, for the nearest vertex to a target point.
    let vgrid = {
        let inv = 1.0 / e;
        let mut m: std::collections::HashMap<(i32, i32), Vec<u32>> = Default::default();
        for v in 0..n as u32 {
            let q = r2(v) * inv;
            m.entry((q.x.floor() as i32, q.y.floor() as i32))
                .or_default()
                .push(v);
        }
        m
    };
    let nearest = |q: Vec2, c: u32| {
        let k = q / e;
        let (cx, cy) = (k.x.floor() as i32, k.y.floor() as i32);
        let mut best = (f32::MAX, u32::MAX);
        for dy in -1..=1 {
            for dx in -1..=1 {
                for &v in vgrid.get(&(cx + dx, cy + dy)).map_or(&[][..], |v| v) {
                    if comp[v as usize] == c {
                        let d = (r2(v) - q).length_squared();
                        if d < best.0 {
                            best = (d, v);
                        }
                    }
                }
            }
        }
        (best.1 != u32::MAX && best.0.sqrt() < 0.5 * e).then_some(best.1)
    };

    let segment_inside = |pa: Vec2, pb: Vec2, c: u32| {
        // Sample every half edge, endpoints excluded.
        let steps = ((pb - pa).length() / (0.5 * e)).ceil() as u32;
        (1..steps).all(|t| inside(pa.lerp(pb, t as f32 / steps as f32), c))
    };
    // Pair -> rest distance.
    let mut pairs: std::collections::HashMap<(u32, u32), f32> = Default::default();
    let mut per_span = Vec::new();
    let mut skipped_outside = 0;
    for &s in spans_edges {
        let before = pairs.len();
        let d = s * e;
        for i in 0..n as u32 {
            let c = comp[i as usize];
            if !flat[c as usize] {
                continue;
            }
            for k in 0..3 {
                let a = k as f32 * std::f32::consts::FRAC_PI_3;
                let q = r2(i) + Vec2::new(a.cos(), a.sin()) * d;
                let Some(j) = nearest(q, c) else { continue };
                if j == i || adj[i as usize].contains(&j) {
                    continue;
                }
                let key = (i.min(j), i.max(j));
                if pairs.contains_key(&key) {
                    continue;
                }
                if !segment_inside(r2(i), r2(j), c) {
                    skipped_outside += 1;
                    continue;
                }
                pairs.insert(key, (rest[i as usize] - rest[j as usize]).length());
            }
        }
        per_span.push(pairs.len() - before);
    }

    // Across seams. Inward direction at a seam vertex: perpendicular to the boundary through
    // its two boundary neighbours, pointing into the panel.
    let mut bnbr: Vec<Vec<u32>> = vec![Vec::new(); n];
    for ed in mesh.edges() {
        if ed.opposite.len() == 1 {
            let [a, b] = ed.v;
            bnbr[a as usize].push(b);
            bnbr[b as usize].push(a);
        }
    }
    let inward = |v: u32| -> Option<Vec2> {
        let nb = &bnbr[v as usize];
        let t = match nb.as_slice() {
            [a, b] => r2(*b) - r2(*a),
            [a] => r2(v) - r2(*a),
            _ => return None,
        };
        let nrm = t.perp().normalize_or_zero();
        let c = comp[v as usize];
        [nrm, -nrm]
            .into_iter()
            .find(|&d| d != Vec2::ZERO && inside(r2(v) + d * (0.5 * e), c))
    };
    // Sewing pairs grouped by the two panels they join, oriented (lower panel, higher panel).
    let mut seams: std::collections::BTreeMap<(u32, u32), Vec<(u32, u32)>> = Default::default();
    for &(i, j) in sew {
        let (ci, cj) = (comp[i as usize], comp[j as usize]);
        if ci == cj || !flat[ci as usize] || !flat[cj as usize] {
            continue;
        }
        let p = if ci < cj { (i, j) } else { (j, i) };
        seams.entry((ci.min(cj), ci.max(cj))).or_default().push(p);
    }
    let mut cross_pairs = Vec::new();
    for &s in cross_spans_edges {
        let before = pairs.len();
        let h = 0.5 * s * e;
        for (&(ca, cb), sp) in &seams {
            for &(a0, b0) in sp {
                let (Some(da), Some(db)) = (inward(a0), inward(b0)) else {
                    continue;
                };
                let (Some(a), Some(b)) =
                    (nearest(r2(a0) + da * h, ca), nearest(r2(b0) + db * h, cb))
                else {
                    continue;
                };
                let key = (a.min(b), a.max(b));
                if pairs.contains_key(&key) {
                    continue;
                }
                let (pa, pb) = (r2(a), r2(b));
                let best = sp
                    .iter()
                    .map(|&(sa, sb)| ((pa - r2(sa)).length() + (r2(sb) - pb).length(), sa, sb))
                    .min_by(|x, y| x.0.total_cmp(&y.0))
                    .unwrap();
                if !segment_inside(pa, r2(best.1), ca) || !segment_inside(r2(best.2), pb, cb) {
                    skipped_outside += 1;
                    continue;
                }
                pairs.insert(key, -best.0);
            }
        }
        cross_pairs.push(pairs.len() - before);
    }

    let mut lists: Vec<Vec<LongRangeItem>> = vec![Vec::new(); n];
    let mut sorted: Vec<((u32, u32), f32)> = pairs.into_iter().collect();
    sorted.sort_unstable_by_key(|p| p.0);
    for ((i, j), rest) in sorted {
        lists[i as usize].push(LongRangeItem { j, rest });
        lists[j as usize].push(LongRangeItem { j: i, rest });
    }
    let mut lr = LongRange::default();
    lr.offsets.push(0);
    for l in lists {
        lr.items.extend(l);
        lr.offsets.push(lr.items.len() as u32);
    }
    let info = LongRangeInfo {
        spans_edges: spans_edges.to_vec(),
        pairs: per_span,
        cross_spans_edges: cross_spans_edges.to_vec(),
        cross_pairs,
        skipped_outside,
        build_ms: t0.elapsed().as_secs_f64() * 1e3,
    };
    (lr, info)
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct LrParams {
    n_verts: u32,
    /// Jacobi relaxation: each vertex moves by omega times the mean of its active corrections.
    omega: f32,
    /// Allowed strain beyond the rest distance (0 = inextensible at long range).
    slack: f32,
    gamma: f32,
    cross_on: u32,
    _p: [u32; 3],
}

pub const ENTRY_POINTS: [&str; 2] = ["lr_gather", "lr_apply"];
pub const PHASES: [&str; 2] = ["lr_gather", "lr_apply"];

pub struct LongRangeGpu {
    pub info: LongRangeInfo,
    params: wgpu::Buffer,
    base: LrParams,
    cross_on: std::cell::Cell<bool>,
    pub bind_group: wgpu::BindGroup,
    pub pipelines: Vec<wgpu::ComputePipeline>,
    pub groups: u32,
    pub buffer_bytes: u64,
}

impl LongRangeGpu {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &wgpu::Device,
        lr: &LongRange,
        info: LongRangeInfo,
        pos: &wgpu::Buffer,
        prev: &wgpu::Buffer,
        omega: f32,
        slack: f32,
        gamma: f32,
    ) -> Self {
        let n = (lr.offsets.len() - 1) as u32;
        let p = LrParams {
            n_verts: n,
            omega,
            slack,
            gamma,
            cross_on: 0,
            _p: [0; 3],
        };
        let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("lr-params"),
            contents: bytemuck::bytes_of(&p),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let st = wgpu::BufferUsages::STORAGE;
        let offsets = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("lr-offsets"),
            contents: bytemuck::cast_slice(&lr.offsets),
            usage: st,
        });
        let zero = [LongRangeItem::zeroed()];
        let items = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("lr-items"),
            contents: bytemuck::cast_slice(if lr.items.is_empty() {
                &zero
            } else {
                &lr.items
            }),
            usage: st,
        });
        let delta = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("lr-delta"),
            size: n as u64 * 16,
            usage: st,
            mapped_at_creation: false,
        });
        let buffer_bytes = offsets.size() + items.size() + delta.size();
        let entry = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let ro = wgpu::BufferBindingType::Storage { read_only: true };
        let rw = wgpu::BufferBindingType::Storage { read_only: false };
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("long-range"),
            entries: &[
                entry(0, wgpu::BufferBindingType::Uniform),
                entry(1, rw),
                entry(2, ro),
                entry(3, ro),
                entry(4, rw),
                entry(5, ro),
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("long-range"),
            layout: &bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: pos.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: offsets.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: items.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: delta.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: prev.as_entire_binding(),
                },
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("longrange.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("long-range"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });
        let pipelines = ENTRY_POINTS
            .iter()
            .map(|e| {
                device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(e),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some(e),
                    compilation_options: Default::default(),
                    cache: None,
                })
            })
            .collect();
        Self {
            info,
            params,
            base: p,
            cross_on: std::cell::Cell::new(false),
            bind_group,
            pipelines,
            groups: n.div_ceil(crate::sim::WG),
            buffer_bytes,
        }
    }
}

impl LongRangeGpu {
    /// Switch the across-seam pairs on or off (a small upload, only when it changes).
    pub fn set_cross(&self, queue: &wgpu::Queue, on: bool) {
        if self.cross_on.replace(on) != on {
            let mut p = self.base;
            p.cross_on = on as u32;
            queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&p));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_pairs_are_symmetric_and_at_the_right_spans() {
        let m = ClothMesh::grid(40, 1.0, 0.0);
        let (lr, info) = build(&m, &[], &[4.0, 16.0], &[]);
        assert!(info.pairs.iter().all(|&p| p > 0), "{info:?}");
        let e = m.mean_edge_length();
        for i in 0..m.n_verts() {
            for it in &lr.items[lr.offsets[i] as usize..lr.offsets[i + 1] as usize] {
                let j = it.j as usize;
                let back = &lr.items[lr.offsets[j] as usize..lr.offsets[j + 1] as usize];
                assert!(back.iter().any(|b| b.j as usize == i && b.rest == it.rest));
                assert!(it.rest > 0.0, "no seams, so no cross-seam pairs");
                assert!(
                    it.rest > 2.0 * e && it.rest < 18.0 * e,
                    "rest {}",
                    it.rest / e
                );
            }
        }
    }

    #[test]
    fn segments_leaving_a_concave_panel_are_skipped() {
        // A U-shaped panel: a 40x40 grid with the middle of the top half cut out. No pair may
        // connect the two arms of the U across the gap.
        let mut m = ClothMesh::grid(40, 1.0, 0.0);
        let gap = |p: Vec3| p.x.abs() < 0.2 && p.z > 0.0;
        m.tris
            .retain(|t| !t.iter().any(|&v| gap(m.rest[v as usize])));
        let (lr, info) = build(&m, &[], &[16.0, 32.0], &[]);
        assert!(info.skipped_outside > 0);
        for i in 0..m.n_verts() {
            let a = m.rest[i];
            for it in &lr.items[lr.offsets[i] as usize..lr.offsets[i + 1] as usize] {
                let b = m.rest[it.j as usize];
                let crosses = a.z > 0.05 && b.z > 0.05 && a.x.signum() != b.x.signum();
                assert!(!crosses, "pair across the gap: {a} - {b}");
            }
        }
    }
}
