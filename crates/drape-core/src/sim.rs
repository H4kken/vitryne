//! GPU XPBD solver. Everything per frame stays on the GPU (hard rule 5).

use bytemuck::{Pod, Zeroable};
use glam::{Vec3, Vec4};
use serde::Serialize;
use wgpu::util::DeviceExt;

use crate::{constraints::Constraints, mesh::ClothMesh, timer::GpuTimer};

pub const SHADER: &str = include_str!("../shaders/sim.wgsl");
pub const WG: u32 = 64;
/// Dynamic uniform offsets must be multiples of `min_uniform_buffer_offset_alignment` (256 by default).
const RANGE_STRIDE: u64 = 256;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SimConfig {
    pub substeps: u32,
    pub frame_dt: f32,
    pub gravity: [f32; 3],
    /// Linear velocity damping, 1/s.
    pub damping: f32,
    /// Collision thickness, m.
    pub thickness: f32,
    pub friction: f32,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self { substeps: 20, frame_dt: 1.0 / 60.0, gravity: [0.0, -9.81, 0.0], damping: 1.0, thickness: 0.002, friction: 0.3 }
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct Params {
    gravity_dt: [f32; 4],
    sphere: [f32; 4],
    n_verts: u32,
    damping: f32,
    thickness: f32,
    friction: f32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct Range {
    offset: u32,
    count: u32,
    _p: [u32; 2],
}

#[derive(Clone, Copy)]
enum Kernel {
    Predict = 0,
    Stretch = 1,
    Bend = 2,
    Collide = 3,
    Update = 4,
}

struct Dispatch {
    kernel: Kernel,
    range_offset: u32,
    groups: u32,
}

pub struct Solver {
    pub cfg: SimConfig,
    pub n_verts: u32,
    pub pos: wgpu::Buffer,
    pub prev: wgpu::Buffer,
    pub vel: wgpu::Buffer,
    pub params: wgpu::Buffer,
    pub sphere: Vec4,
    state_bg: wgpu::BindGroup,
    cons_bg: wgpu::BindGroup,
    pipelines: Vec<wgpu::ComputePipeline>,
    phases: Vec<(&'static str, Vec<Dispatch>)>,
    init_pos: Vec<[f32; 4]>,
}

fn storage_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_entry(binding: u32, dynamic: bool, size: u64) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: dynamic,
            min_binding_size: wgpu::BufferSize::new(size),
        },
        count: None,
    }
}

/// Storage buffers can't be empty; pad with one zeroed element.
fn storage_init<T: Pod + Zeroable>(device: &wgpu::Device, label: &str, data: &[T]) -> wgpu::Buffer {
    let zero = [T::zeroed()];
    let contents: &[u8] = if data.is_empty() { bytemuck::cast_slice(&zero) } else { bytemuck::cast_slice(data) };
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(label),
        contents,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
    })
}

impl Solver {
    pub fn new(
        device: &wgpu::Device,
        mesh: &ClothMesh,
        cons: &Constraints,
        density: f32,
        cfg: SimConfig,
        sphere: Vec4,
    ) -> Self {
        let n = mesh.n_verts() as u32;
        let inv_mass = mesh.inv_masses(density);
        let init_pos: Vec<[f32; 4]> = mesh.pos.iter().zip(&inv_mass).map(|(p, &w)| [p.x, p.y, p.z, w]).collect();
        let vs = wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC;
        let pos = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("pos"),
            contents: bytemuck::cast_slice(&init_pos),
            usage: vs | wgpu::BufferUsages::VERTEX,
        });
        let prev = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("prev"),
            contents: bytemuck::cast_slice(&init_pos),
            usage: vs,
        });
        let vel = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("vel"),
            contents: &vec![0u8; n as usize * 16],
            usage: vs,
        });
        let h = cfg.frame_dt / cfg.substeps as f32;
        let p = Params {
            gravity_dt: [cfg.gravity[0], cfg.gravity[1], cfg.gravity[2], h],
            sphere: sphere.to_array(),
            n_verts: n,
            damping: cfg.damping,
            thickness: cfg.thickness,
            friction: cfg.friction,
        };
        let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sim-params"),
            contents: bytemuck::bytes_of(&p),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // One 256-byte slot per colour: stretch colours first, then bend colours.
        let all_ranges: Vec<(u32, u32)> = cons.stretch.ranges.iter().chain(&cons.bend.ranges).copied().collect();
        let mut range_bytes = vec![0u8; (all_ranges.len().max(1) as u64 * RANGE_STRIDE) as usize];
        for (k, &(offset, count)) in all_ranges.iter().enumerate() {
            let r = Range { offset, count, _p: [0; 2] };
            let o = k * RANGE_STRIDE as usize;
            range_bytes[o..o + 16].copy_from_slice(bytemuck::bytes_of(&r));
        }
        let ranges = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("color-ranges"),
            contents: &range_bytes,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let stretch = storage_init(device, "stretch", &cons.stretch.items);
        let bend = storage_init(device, "bend", &cons.bend.items);

        let state_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("sim-state"),
            entries: &[uniform_entry(0, false, 48), storage_entry(1, false), storage_entry(2, false), storage_entry(3, false)],
        });
        let cons_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("sim-constraints"),
            entries: &[uniform_entry(0, true, 16), storage_entry(1, true), storage_entry(2, true)],
        });
        let state_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sim-state"),
            layout: &state_bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: pos.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: prev.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: vel.as_entire_binding() },
            ],
        });
        let cons_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sim-constraints"),
            layout: &cons_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &ranges,
                        offset: 0,
                        size: wgpu::BufferSize::new(16),
                    }),
                },
                wgpu::BindGroupEntry { binding: 1, resource: stretch.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: bend.as_entire_binding() },
            ],
        });

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("sim.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("sim"),
            bind_group_layouts: &[Some(&state_bgl), Some(&cons_bgl)],
            immediate_size: 0,
        });
        let pipelines = ["predict", "solve_stretch", "solve_bend", "collide_sphere", "update_velocity"]
            .iter()
            .map(|entry| {
                device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: Some(&layout),
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    cache: None,
                })
            })
            .collect();

        let vgroups = n.div_ceil(WG);
        let per_vertex = |kernel| vec![Dispatch { kernel, range_offset: 0, groups: vgroups }];
        let ns = cons.stretch.ranges.len();
        let colored = |kernel, ranges: &[(u32, u32)], base: usize| -> Vec<Dispatch> {
            ranges
                .iter()
                .enumerate()
                .map(|(k, &(_, count))| Dispatch {
                    kernel,
                    range_offset: ((base + k) as u64 * RANGE_STRIDE) as u32,
                    groups: count.div_ceil(WG),
                })
                .filter(|d| d.groups > 0)
                .collect()
        };
        let phases = vec![
            ("predict", per_vertex(Kernel::Predict)),
            ("stretch", colored(Kernel::Stretch, &cons.stretch.ranges, 0)),
            ("bend", colored(Kernel::Bend, &cons.bend.ranges, ns)),
            ("collide", per_vertex(Kernel::Collide)),
            ("update", per_vertex(Kernel::Update)),
        ];

        Self { cfg, n_verts: n, pos, prev, vel, params, sphere, state_bg, cons_bg, pipelines, phases, init_pos }
    }

    pub fn dispatches_per_frame(&self) -> u32 {
        self.cfg.substeps * self.phases.iter().map(|(_, d)| d.len() as u32).sum::<u32>()
    }

    /// Passes encoded per frame in profiling mode (one per phase per substep).
    pub fn profiled_passes_per_frame(&self) -> u32 {
        self.cfg.substeps * self.phases.len() as u32
    }

    fn run(&self, pass: &mut wgpu::ComputePass<'_>, ds: &[Dispatch]) {
        for d in ds {
            pass.set_pipeline(&self.pipelines[d.kernel as usize]);
            pass.set_bind_group(1, &self.cons_bg, &[d.range_offset]);
            pass.dispatch_workgroups(d.groups, 1, 1);
        }
    }

    /// Encode one frame (`substeps` substeps). Canonical mode: a single compute pass.
    /// With an enabled timer: one pass per phase per substep so each gets timestamps.
    pub fn encode_frame(&self, encoder: &mut wgpu::CommandEncoder, timer: Option<&mut GpuTimer>) {
        match timer {
            Some(timer) if timer.enabled() => {
                for _ in 0..self.cfg.substeps {
                    for (label, ds) in &self.phases {
                        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                            label: Some(label),
                            timestamp_writes: timer.compute_pass_writes(label),
                        });
                        pass.set_bind_group(0, &self.state_bg, &[]);
                        self.run(&mut pass, ds);
                    }
                }
            }
            _ => {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("sim-frame"), timestamp_writes: None });
                pass.set_bind_group(0, &self.state_bg, &[]);
                for _ in 0..self.cfg.substeps {
                    for (_, ds) in &self.phases {
                        self.run(&mut pass, ds);
                    }
                }
            }
        }
    }

    pub fn reset(&self, queue: &wgpu::Queue) {
        queue.write_buffer(&self.pos, 0, bytemuck::cast_slice(&self.init_pos));
        queue.write_buffer(&self.prev, 0, bytemuck::cast_slice(&self.init_pos));
        queue.write_buffer(&self.vel, 0, &vec![0u8; self.n_verts as usize * 16]);
    }

    pub fn total_free_mass(mesh: &ClothMesh, density: f32) -> f32 {
        mesh.masses(density).iter().zip(&mesh.pinned).filter(|(_, p)| !**p).map(|(m, _)| m).sum()
    }
}

/// Analytic sphere, for M1 only (M2 replaces it with the body SDF).
pub fn sphere(center: Vec3, radius: f32) -> Vec4 {
    center.extend(radius)
}
