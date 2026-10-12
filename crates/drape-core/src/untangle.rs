//! Untangling (spike 2, S4): intersection contour minimization (Volino & Magnenat-Thalmann
//! 2006) on the GPU every `untangle_every` substeps (untangle.wgsl). Own pipeline layout, like
//! self-collision. Its accumulator buffer also holds the per-vertex "tangled" flags that the
//! self-collision repulsion reads, so it is created first and handed to `SelfCollision::new`.

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use wgpu::util::DeviceExt;

use crate::{constraints::Constraints, mesh::ClothMesh, selfcheck::weld_map};

pub const SHADER: &str = concat!(
    include_str!("../shaders/untangle.wgsl"),
    include_str!("../shaders/hashgrid.wgsl")
);

/// Kernels in dispatch order, all run every `untangle_every` substeps.
pub const ENTRY_POINTS: [&str; 6] = [
    "ut_count",
    "hg_scan_local",
    "hg_scan_blocks",
    "ut_scatter",
    "ut_detect",
    "ut_apply",
];
/// Phase labels (profiling, attribution), in `ENTRY_POINTS` order: the full detection, and the
/// gated one (only triangles touching a vertex flagged by the last detection).
pub const PHASES: [&str; 6] = [
    "ut_count",
    "ut_scan_local",
    "ut_scan_blocks",
    "ut_scatter",
    "ut_detect",
    "ut_apply",
];
pub const PHASES_GATED: [&str; 6] = [
    "utg_count",
    "utg_scan_local",
    "utg_scan_blocks",
    "utg_scatter",
    "utg_detect",
    "utg_apply",
];
/// The hash supports triangles stretched to this many times the 99th-percentile rest reach
/// (centroid to vertex). Larger ones can miss a crossing; the CPU count would still see it.
/// Sizing by the largest triangle instead made the cell 3.4x the mean edge on the hoodie (one
/// outlier) and the detection cost 12 ms per frame; 1.5 cost 1.4-1.9 ms per full pass at 10k.
/// The candidate count goes with the cell squared (cloth is a surface).
pub const REACH_STRETCH: f32 = 1.2;

const NONE: u32 = u32::MAX;

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct UtParams {
    n_tris: u32,
    table_size: u32,
    n_blocks: u32,
    inv_cell: f32,
    n_verts: u32,
    step: f32,
    max_ratio: f32,
    max_reach: f32,
    gated: u32,
    _p: [u32; 3],
}

/// Per triangle, 3 rows: vertices, welded ids, and for edge k = (v_k, v_k+1) the third vertex
/// of the triangle on the other side (matched by welded ids, so across a seam too), or NONE.
pub fn triangle_rows(mesh: &ClothMesh, weld: &[u32]) -> Vec<[u32; 4]> {
    let key = |a: u32, b: u32| {
        let (a, b) = (weld[a as usize], weld[b as usize]);
        (a.min(b), a.max(b))
    };
    let mut by_edge: HashMap<(u32, u32), Vec<(u32, u32)>> = HashMap::new();
    for (ti, t) in mesh.tris.iter().enumerate() {
        for k in 0..3 {
            by_edge
                .entry(key(t[k], t[(k + 1) % 3]))
                .or_default()
                .push((ti as u32, t[(k + 2) % 3]));
        }
    }
    let mut rows = Vec::with_capacity(mesh.tris.len() * 3);
    for (ti, t) in mesh.tris.iter().enumerate() {
        let mut opp = [NONE; 4];
        for k in 0..3 {
            // A junction where 3+ panels meet along one edge: the first other side.
            opp[k] = by_edge[&key(t[k], t[(k + 1) % 3])]
                .iter()
                .find(|(o, _)| *o != ti as u32)
                .map_or(NONE, |&(_, v)| v);
        }
        rows.push([t[0], t[1], t[2], 0]);
        rows.push([
            weld[t[0] as usize],
            weld[t[1] as usize],
            weld[t[2] as usize],
            0,
        ]);
        rows.push(opp);
    }
    rows
}

/// Centroid-to-vertex distance of every rest triangle, sorted.
pub fn rest_reaches(mesh: &ClothMesh) -> Vec<f32> {
    let mut r: Vec<f32> = mesh
        .tris
        .iter()
        .map(|t| {
            let p = t.map(|v| mesh.rest[v as usize]);
            let c: Vec3 = (p[0] + p[1] + p[2]) / 3.0;
            p.iter().map(|q| (*q - c).length()).fold(0.0, f32::max)
        })
        .collect();
    r.sort_by(f32::total_cmp);
    r
}

pub struct Untangle {
    pub n_tris: u32,
    pub step: f32,
    pub cell: f32,
    pub table_size: u32,
    pub buffer_bytes: u64,
    n_verts: u32,
    /// Correction accumulator; [5n, 6n) are the tangled flags (bound by self-collision).
    pub acc: wgpu::Buffer,
    /// Full detection, gated detection: the same buffers, `gated` differs in the params.
    pub bind_groups: [wgpu::BindGroup; 2],
    pub pipelines: Vec<wgpu::ComputePipeline>,
    /// Workgroups per kernel, in `ENTRY_POINTS` order.
    pub groups: [u32; 6],
}

impl Untangle {
    pub fn new(
        device: &wgpu::Device,
        mesh: &ClothMesh,
        cons: &Constraints,
        pos: &wgpu::Buffer,
        prev: &wgpu::Buffer,
        step: f32,
        max_ratio: f32,
    ) -> Self {
        let n = mesh.n_verts() as u32;
        let n_tris = mesh.tris.len() as u32;
        let reaches = rest_reaches(mesh);
        let max_reach = REACH_STRETCH * reaches[(reaches.len() * 99 / 100).min(reaches.len() - 1)];
        let over = reaches.len() - reaches.partition_point(|&r| r <= max_reach);
        let cell = 2.0 * max_reach;
        let table_size = (2 * n_tris).next_power_of_two().max(256);
        let n_blocks = table_size / 256;
        let p = UtParams {
            n_tris,
            table_size,
            n_blocks,
            inv_cell: 1.0 / cell,
            n_verts: n,
            step,
            max_ratio,
            max_reach,
            gated: 0,
            _p: [0; 3],
        };
        let params = [0, 1].map(|gated| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("untangle-params"),
                contents: bytemuck::bytes_of(&UtParams { gated, ..p }),
                usage: wgpu::BufferUsages::UNIFORM,
            })
        });
        let weld = weld_map(mesh.n_verts(), cons);
        let rows = triangle_rows(mesh, &weld);
        let boundary = rows
            .chunks(3)
            .map(|r| r[2][..3].iter().filter(|&&o| o == NONE).count())
            .sum::<usize>();
        log::info!(
            "untangle: {n_tris} triangles, {boundary} boundary edges, cell {:.2} mm (rest reach median {:.2}, max {:.2} mm; {over} over the supported reach at rest), step {:.2} mm, table {table_size}",
            cell * 1e3,
            reaches[reaches.len() / 2] * 1e3,
            reaches[reaches.len() - 1] * 1e3,
            step * 1e3
        );
        let st = wgpu::BufferUsages::STORAGE;
        let zeroed = |label, size: u64, extra| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage: st | extra,
                mapped_at_creation: false,
            })
        };
        let cell_count = zeroed(
            "untangle-cell-count",
            table_size as u64 * 4,
            wgpu::BufferUsages::empty(),
        );
        let cell_start = zeroed(
            "untangle-cell-start",
            (table_size + n_blocks) as u64 * 4,
            wgpu::BufferUsages::empty(),
        );
        let tsorted = zeroed(
            "untangle-sorted",
            n_tris as u64 * 16,
            wgpu::BufferUsages::empty(),
        );
        let acc = zeroed(
            "untangle-acc",
            (6 * n as u64 + 2) * 4,
            wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
        );
        let tri_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("untangle-tris"),
            contents: bytemuck::cast_slice(&rows),
            usage: st,
        });
        let buffer_bytes =
            cell_count.size() + cell_start.size() + tsorted.size() + acc.size() + tri_buf.size();

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
        let rw = wgpu::BufferBindingType::Storage { read_only: false };
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("untangle"),
            entries: &[
                entry(0, wgpu::BufferBindingType::Uniform),
                entry(1, rw),
                entry(2, rw),
                entry(3, rw),
                entry(4, rw),
                entry(5, rw),
                entry(6, wgpu::BufferBindingType::Storage { read_only: true }),
                entry(7, rw),
            ],
        });
        let bind_groups = params.each_ref().map(|params| {
            let bufs = [
                params,
                pos,
                prev,
                &cell_count,
                &cell_start,
                &tsorted,
                &tri_buf,
                &acc,
            ];
            let entries: Vec<_> = bufs
                .iter()
                .enumerate()
                .map(|(k, b)| wgpu::BindGroupEntry {
                    binding: k as u32,
                    resource: b.as_entire_binding(),
                })
                .collect();
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("untangle"),
                layout: &bgl,
                entries: &entries,
            })
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("untangle.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("untangle"),
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
        let tg = n_tris.div_ceil(crate::sim::WG);
        let vg = n.div_ceil(crate::sim::WG);
        Self {
            n_tris,
            step,
            cell,
            table_size,
            buffer_bytes,
            n_verts: n,
            acc,
            bind_groups,
            pipelines,
            groups: [
                tg,
                n_blocks,
                1,
                tg,
                (9 * n_tris).div_ceil(crate::sim::WG),
                vg,
            ],
        }
    }

    /// Benchmark-only readback: intersecting triangle pairs found by the last detection (pairs
    /// listed twice by overlapping hash rows count twice), and vertices flagged tangled.
    pub async fn last_detection(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> (u32, u32) {
        let rb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("untangle-readback"),
            size: self.acc.size(),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(&self.acc, 0, &rb, 0, self.acc.size());
        queue.submit([enc.finish()]);
        let v: Vec<i32> = crate::gpu_async::read_buffer(device, &rb).await;
        let n = self.n_verts as usize;
        (
            v[6 * n + 1] as u32,
            v[5 * n..6 * n].iter().filter(|&&f| f != 0).count() as u32,
        )
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UntangleInfo {
    pub every: u32,
    pub check_every: u32,
    pub step_mm: f32,
    pub cell_mm: f32,
    pub table_size: u32,
    pub buffer_bytes: u64,
    /// At the end of the run (last detection): GPU-detected pairs and flagged vertices.
    pub gpu_pairs_last: u32,
    pub tangled_vertices_last: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constraints::Material;

    #[test]
    fn triangle_rows_find_neighbours_across_edges_and_seams() {
        let m = ClothMesh::grid(4, 0.3, 0.0); // 4x4 vertices, 18 triangles
        let mut cons = Constraints::build(&m, &Material::cotton());
        let weld = weld_map(m.n_verts(), &cons);
        let rows = triangle_rows(&m, &weld);
        let opp = |t: usize| rows[3 * t + 2];
        // Interior edges have a neighbour, the outer boundary doesn't: 12 boundary edges.
        let boundary = (0..m.tris.len())
            .map(|t| opp(t)[..3].iter().filter(|&&o| o == NONE).count())
            .sum::<usize>();
        assert_eq!(boundary, 12);
        // Each neighbour vertex is the third vertex of a triangle sharing that edge.
        for (t, tri) in m.tris.iter().enumerate() {
            for k in 0..3 {
                let o = opp(t)[k];
                if o != NONE {
                    let (a, b) = (tri[k], tri[(k + 1) % 3]);
                    assert!(m.tris.iter().enumerate().any(|(u, x)| u != t
                        && x.contains(&a)
                        && x.contains(&b)
                        && x.contains(&o)));
                }
            }
        }
        // Sew the left column onto the right one (a tube): those 6 boundary edges get neighbours.
        cons.set_sewing(&[(0, 3), (4, 7), (8, 11), (12, 15)], m.n_verts());
        let weld = weld_map(m.n_verts(), &cons);
        let rows = triangle_rows(&m, &weld);
        let boundary = rows
            .chunks(3)
            .map(|r| r[2][..3].iter().filter(|&&o| o == NONE).count())
            .sum::<usize>();
        assert_eq!(boundary, 6);
    }
}
