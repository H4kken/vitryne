//! Cloth self-collision (M4): spatial hash by counting sort + vertex-vertex repulsion, on the
//! GPU every substep (selfcol.wgsl). Own pipeline layout, so the solver's bind groups keep
//! their storage-buffer count under the WebGPU default of 8 per stage (this one uses all 8).

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::{constraints::Constraints, mesh::ClothMesh};

pub const SHADER: &str = concat!(
    include_str!("../shaders/selfcol.wgsl"),
    include_str!("../shaders/hashgrid.wgsl")
);

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct SelfParams {
    n_verts: u32,
    table_size: u32,
    n_blocks: u32,
    radius: f32,
    inv_cell: f32,
    friction: f32,
    query_radius: f32,
    max_neighbors: u32,
    max_elastic: f32,
    tangle_flags: u32,
    _p: [u32; 2],
}

/// Kernels in dispatch order: the first `REBUILD_KERNELS` rebuild the hash and the neighbour
/// lists, the rest run every substep. The two scans are shared with untangling (hashgrid.wgsl).
pub const ENTRY_POINTS: [&str; 7] = [
    "sc_count",
    "hg_scan_local",
    "hg_scan_blocks",
    "sc_scatter",
    "sc_query",
    "sc_snapshot",
    "sc_collide",
];
/// Phase labels (profiling, attribution), in `ENTRY_POINTS` order.
pub const PHASES: [&str; 7] = [
    "sc_count",
    "sc_scan_local",
    "sc_scan_blocks",
    "sc_scatter",
    "sc_query",
    "sc_snapshot",
    "sc_collide",
];
pub const REBUILD_KERNELS: usize = 5;
/// Neighbour-list capacity per vertex (a fold of 3-4 layers lists ~25 within the query radius).
pub const MAX_NEIGHBORS: u32 = 32;

/// Vertices within geodesic distance `max_dist` of each vertex in the rest shape, walking mesh
/// edges (rest length) and seams (length 0). These pairs are close because the cloth is
/// connected there, not because two layers met, so they must not repel. CSR: offsets [0, n],
/// then the sorted lists, offsets pointing into the same array.
pub fn exclusion_lists(mesh: &ClothMesh, cons: &Constraints, max_dist: f32) -> Vec<u32> {
    let n = mesh.n_verts();
    let mut adj: Vec<Vec<(u32, f32)>> = vec![Vec::new(); n];
    for e in mesh.edges() {
        let [a, b] = e.v;
        let l = (mesh.rest[a as usize] - mesh.rest[b as usize]).length();
        adj[a as usize].push((b, l));
        adj[b as usize].push((a, l));
    }
    for s in &cons.sew.items {
        adj[s.i as usize].push((s.j, 0.0));
        adj[s.j as usize].push((s.i, 0.0));
    }
    let mut lists: Vec<Vec<u32>> = Vec::with_capacity(n);
    let mut dist: HashMap<u32, f32> = HashMap::new();
    for v in 0..n as u32 {
        dist.clear();
        let mut heap = BinaryHeap::from([Reverse((0u32, v))]); // f32 bits order like the value for d >= 0
        dist.insert(v, 0.0);
        while let Some(Reverse((db, u))) = heap.pop() {
            let d = f32::from_bits(db);
            if d > dist[&u] {
                continue;
            }
            for &(w, l) in &adj[u as usize] {
                let nd = d + l;
                if nd < max_dist && dist.get(&w).is_none_or(|&o| nd < o) {
                    dist.insert(w, nd);
                    heap.push(Reverse((nd.to_bits(), w)));
                }
            }
        }
        let mut l: Vec<u32> = dist.keys().copied().filter(|&w| w != v).collect();
        l.sort_unstable();
        lists.push(l);
    }
    let base = n as u32 + 1;
    let mut out = Vec::with_capacity(base as usize + lists.iter().map(Vec::len).sum::<usize>());
    let mut o = base;
    for l in &lists {
        out.push(o);
        o += l.len() as u32;
    }
    out.push(o);
    for l in lists {
        out.extend(l);
    }
    out
}

pub struct SelfCollision {
    pub radius: f32,
    pub query_radius: f32,
    pub table_size: u32,
    pub excluded_pairs: usize,
    pub buffer_bytes: u64,
    pub n_verts: u32,
    sorted: wgpu::Buffer,
    nbr: wgpu::Buffer,
    pub bind_group: wgpu::BindGroup,
    pub pipelines: Vec<wgpu::ComputePipeline>,
    /// Workgroups per kernel, in `ENTRY_POINTS` order.
    pub groups: [u32; 7],
}

impl SelfCollision {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &wgpu::Device,
        mesh: &ClothMesh,
        cons: &Constraints,
        pos: &wgpu::Buffer,
        prev: &wgpu::Buffer,
        radius: f32,
        query_radius: f32,
        exclude_dist: f32,
        friction: f32,
        max_elastic: f32,
        tangled: Option<&wgpu::Buffer>,
    ) -> Self {
        let n = mesh.n_verts() as u32;
        let table_size = (2 * n).next_power_of_two().max(256);
        let n_blocks = table_size / 256;
        let p = SelfParams {
            n_verts: n,
            table_size,
            n_blocks,
            radius,
            inv_cell: 1.0 / query_radius,
            friction,
            query_radius,
            max_neighbors: MAX_NEIGHBORS,
            max_elastic,
            tangle_flags: tangled.is_some() as u32,
            _p: [0; 2],
        };
        let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("self-params"),
            contents: bytemuck::bytes_of(&p),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let t0 = web_time::Instant::now();
        let excl = exclusion_lists(mesh, cons, exclude_dist);
        let excluded_pairs = (excl.len() - n as usize - 1) / 2;
        log::info!(
            "self-collision: radius {:.2} mm, exclusion {:.2} mm, {excluded_pairs} excluded pairs ({:.1}/vertex) in {:.0} ms, table {table_size}",
            radius * 1e3,
            exclude_dist * 1e3,
            2.0 * excluded_pairs as f32 / n as f32,
            t0.elapsed().as_secs_f64() * 1e3
        );
        let st = wgpu::BufferUsages::STORAGE;
        let zeroed = |label, size: u64| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage: st,
                mapped_at_creation: false,
            })
        };
        // Zero-initialised: the scatter pass returns every count to zero, so no clear pass.
        let cell_count = zeroed("self-cell-count", table_size as u64 * 4);
        let cell_start = zeroed("self-cell-start", (table_size + n_blocks) as u64 * 4);
        let sorted = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("self-sorted"),
            size: n as u64 * 48,
            usage: st | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let nbr = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("self-neighbors"),
            size: n as u64 * (MAX_NEIGHBORS as u64 + 1) * 4,
            usage: st | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let excl_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("self-exclusions"),
            contents: bytemuck::cast_slice(&excl),
            usage: st,
        });
        // Untangling's flags (S4), or a dummy the shader never reads.
        let dummy = tangled.is_none().then(|| zeroed("self-tangled-dummy", 4));
        let tangled = tangled.or(dummy.as_ref()).unwrap();
        let buffer_bytes =
            cell_count.size() + cell_start.size() + sorted.size() + excl_buf.size() + nbr.size();

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
            label: Some("self-collision"),
            entries: &[
                entry(0, wgpu::BufferBindingType::Uniform),
                entry(1, rw),
                entry(2, rw),
                entry(3, rw),
                entry(4, rw),
                entry(5, rw),
                entry(6, wgpu::BufferBindingType::Storage { read_only: true }),
                entry(7, rw),
                entry(8, wgpu::BufferBindingType::Storage { read_only: true }),
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("self-collision"),
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
                    resource: prev.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: cell_count.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: cell_start.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: sorted.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: excl_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: nbr.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: tangled.as_entire_binding(),
                },
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("selfcol.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("self-collision"),
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
        let vg = n.div_ceil(crate::sim::WG);
        Self {
            radius,
            query_radius,
            table_size,
            excluded_pairs,
            buffer_bytes,
            n_verts: n,
            sorted,
            nbr,
            bind_group,
            pipelines,
            groups: [vg, n_blocks, 1, vg, vg, vg, vg],
        }
    }

    /// Benchmark-only check of the last rebuild: the cell-sorted copy must hold every vertex
    /// exactly once, grouped by hash cell in increasing order; and neighbour-list usage.
    pub async fn verify(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> SelfCheck {
        let n = self.n_verts as usize;
        let read = |buf: &wgpu::Buffer| {
            let rb = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("self-readback"),
                size: buf.size(),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut enc = device.create_command_encoder(&Default::default());
            enc.copy_buffer_to_buffer(buf, 0, &rb, 0, buf.size());
            queue.submit([enc.finish()]);
            rb
        };
        let (rs, rn) = (read(&self.sorted), read(&self.nbr));
        let v: Vec<[f32; 4]> = crate::gpu_async::read_buffer(device, &rs).await;
        let nb: Vec<u32> = crate::gpu_async::read_buffer(device, &rn).await;
        let sort = (|| {
            let mut seen = vec![false; n];
            let mut last_cell = 0u32;
            let inv = 1.0 / self.query_radius;
            for (s, e) in v[..n].iter().enumerate() {
                let i = e[3].to_bits() as usize;
                if i >= n || std::mem::replace(&mut seen[i], true) {
                    return Err(format!("slot {s}: vertex {i} out of range or duplicated"));
                }
                let c = (glam::Vec3::new(e[0], e[1], e[2]) * inv)
                    .floor()
                    .as_ivec3()
                    .as_uvec3(); // as the GPU computes it
                let h = ((c.y.wrapping_mul(19349663) ^ c.z.wrapping_mul(83492791))
                    .wrapping_add(c.x))
                    & (self.table_size - 1);
                if h < last_cell {
                    return Err(format!("slot {s}: cell {h} after cell {last_cell}"));
                }
                last_cell = h;
            }
            Ok(())
        })();
        let counts: Vec<u32> = (0..n)
            .map(|i| nb[i * (MAX_NEIGHBORS as usize + 1)])
            .collect();
        SelfCheck {
            sort,
            max_neighbors_found: counts.iter().copied().max().unwrap_or(0),
            mean_neighbors: counts.iter().sum::<u32>() as f32 / n.max(1) as f32,
            vertices_over_capacity: counts.iter().filter(|&&c| c > MAX_NEIGHBORS).count(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SelfCheck {
    pub sort: Result<(), String>,
    pub max_neighbors_found: u32,
    pub mean_neighbors: f32,
    /// Vertices whose list overflowed (extra neighbours ignored until the next rebuild).
    pub vertices_over_capacity: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constraints::Material;

    #[test]
    fn exclusion_lists_cover_rest_neighbourhood_and_seams() {
        let m = ClothMesh::grid(5, 0.4, 0.0); // 0.1 m spacing
        let mut cons = Constraints::build(&m, &Material::cotton());
        // Sew the two far corners together: they become geodesic neighbours.
        cons.set_sewing(&[(0, 24)], m.n_verts());
        let ex = exclusion_lists(&m, &cons, 0.15);
        let list = |v: usize| &ex[ex[v] as usize..ex[v + 1] as usize];
        // Vertex 12 (centre): 4 axis neighbours at 0.1 m, diagonals at 0.141 m only where a
        // triangle edge connects them; nothing at 0.2 m.
        assert!([7, 11, 13, 17].iter().all(|v| list(12).contains(v)));
        assert!(!list(12).contains(&2) && !list(12).contains(&10));
        assert!(list(12).windows(2).all(|w| w[0] < w[1]), "sorted");
        // Across the seam: 24 and its neighbours are within 0.15 of 0 through the seam.
        assert!(list(0).contains(&24) && list(0).contains(&23) && list(0).contains(&19));
        // Symmetric.
        for v in 0..m.n_verts() {
            for &w in list(v) {
                assert!(
                    list(w as usize).contains(&(v as u32)),
                    "{v} -> {w} not symmetric"
                );
            }
        }
    }
}
