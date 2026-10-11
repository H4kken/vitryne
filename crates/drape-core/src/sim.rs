//! GPU XPBD solver. Everything per frame stays on the GPU (hard rule 5).

use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use glam::{Vec3, Vec4};
use serde::Serialize;
use wgpu::util::DeviceExt;

use crate::{body::Sdf, constraints::Constraints, mesh::ClothMesh, timer::GpuTimer};

pub const SHADER: &str = concat!(include_str!("../shaders/sdf.wgsl"), include_str!("../shaders/sim.wgsl"));

/// What the cloth collides with.
#[derive(Clone)]
pub enum Collider {
    /// Analytic sphere (M1).
    Sphere(Vec4),
    /// Baked signed distance field of the avatar (M2+).
    Sdf(Arc<Sdf>),
}

/// Time-dependent parameters, evaluated on the CPU and written to the uniform each frame.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Schedule {
    /// Sewing compliance goes log-linearly from start to end over `sew_ramp_s`.
    pub sew_compliance_start: f32,
    pub sew_compliance_end: f32,
    pub sew_ramp_s: f32,
    /// Max sewing correction per vertex per substep while the seams close (t < sew_ramp_s), m.
    /// Lifted afterwards: a closed seam under load needs larger corrections, and clamping
    /// them lets the seam creep open.
    pub sew_max_step: f32,
    /// Gravity is off until `gravity_delay_s`, then ramps to full over `gravity_ramp_s`, so
    /// panels don't fall off before the seams have closed.
    pub gravity_delay_s: f32,
    pub gravity_ramp_s: f32,
}

impl Schedule {
    /// No sewing, full gravity from t = 0 (M1 sheet).
    pub const NONE: Self = Self {
        sew_compliance_start: 0.0,
        sew_compliance_end: 0.0,
        sew_ramp_s: 0.0,
        sew_max_step: 0.0,
        gravity_delay_s: 0.0,
        gravity_ramp_s: 0.0,
    };

    pub fn gravity_scale(&self, t: f32) -> f32 {
        if t < self.gravity_delay_s {
            0.0
        } else if self.gravity_ramp_s <= 0.0 {
            1.0
        } else {
            ((t - self.gravity_delay_s) / self.gravity_ramp_s).min(1.0)
        }
    }

    pub fn sew_compliance(&self, t: f32) -> f32 {
        if self.sew_ramp_s <= 0.0 || t >= self.sew_ramp_s {
            return self.sew_compliance_end;
        }
        let u = t / self.sew_ramp_s;
        (self.sew_compliance_start.ln() * (1.0 - u) + self.sew_compliance_end.ln() * u).exp()
    }

    pub fn sew_step_limit(&self, t: f32) -> f32 {
        if t < self.sew_ramp_s { self.sew_max_step } else { 1.0e9 }
    }

    /// Nothing can count as "at rest" before every ramp has finished.
    pub fn end_s(&self) -> f32 {
        self.sew_ramp_s.max(self.gravity_delay_s + self.gravity_ramp_s)
    }
}
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
    pub schedule: Schedule,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            substeps: 20,
            frame_dt: 1.0 / 60.0,
            gravity: [0.0, -9.81, 0.0],
            damping: 1.0,
            thickness: 0.002,
            friction: 0.3,
            schedule: Schedule::NONE,
        }
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct Params {
    gravity_dt: [f32; 4],
    sphere: [f32; 4],
    sdf_origin: [f32; 4],
    sdf_dims: [u32; 4],
    n_verts: u32,
    damping: f32,
    thickness: f32,
    friction: f32,
    sew_compliance: f32,
    sew_max_step: f32,
    sdf_band: f32,
    _p0: f32,
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
    Sew = 2,
    Bend = 3,
    CollideSphere = 4,
    CollideSdf = 5,
    Update = 6,
}

const ENTRY_POINTS: [&str; 7] = ["predict", "solve_stretch", "solve_sew", "solve_bend", "collide_sphere", "collide_sdf", "update_velocity"];

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
    pub collider: Collider,
    /// SDF values (or a 1-element dummy for the sphere), shared with the metrics pass.
    pub sdf_buf: wgpu::Buffer,
    base_params: Params,
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
        collider: Collider,
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
        let mut p = Params {
            gravity_dt: [cfg.gravity[0], cfg.gravity[1], cfg.gravity[2], h],
            sphere: [0.0, -1000.0, 0.0, 0.0],
            sdf_origin: [0.0; 4],
            sdf_dims: [1, 1, 1, 0],
            n_verts: n,
            damping: cfg.damping,
            thickness: cfg.thickness,
            friction: cfg.friction,
            sew_compliance: cfg.schedule.sew_compliance_end,
            sew_max_step: cfg.schedule.sew_max_step,
            sdf_band: 0.0,
            _p0: 0.0,
        };
        let sdf_data: Vec<f32> = match &collider {
            Collider::Sphere(s) => {
                p.sphere = s.to_array();
                vec![0.0]
            }
            Collider::Sdf(sdf) => {
                p.sdf_origin = sdf.origin.extend(sdf.cell).to_array();
                p.sdf_dims = [sdf.dims.x, sdf.dims.y, sdf.dims.z, 0];
                p.sdf_band = sdf.band;
                log::info!(
                    "SDF {}x{}x{} @ {:.1} mm = {:.1} MB (maxStorageBufferBindingSize 128 MiB)",
                    sdf.dims.x,
                    sdf.dims.y,
                    sdf.dims.z,
                    sdf.cell * 1000.0,
                    sdf.bytes() as f64 / 1e6
                );
                sdf.values.clone()
            }
        };
        let sdf_buf = storage_init(device, "sdf", &sdf_data);
        let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("sim-params"),
            contents: bytemuck::bytes_of(&p),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Sewing constraints live in the stretch buffer, after the stretch constraints.
        let n_stretch = cons.stretch.items.len() as u32;
        let sew_ranges: Vec<(u32, u32)> = cons.sew.ranges.iter().map(|&(o, c)| (o + n_stretch, c)).collect();
        let lin: Vec<_> = cons.stretch.items.iter().chain(&cons.sew.items).copied().collect();

        // One 256-byte slot per colour: stretch, then sew, then bend.
        let all_ranges: Vec<(u32, u32)> =
            cons.stretch.ranges.iter().chain(&sew_ranges).chain(&cons.bend.ranges).copied().collect();
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
        let stretch = storage_init(device, "stretch+sew", &lin);
        let bend = storage_init(device, "bend", &cons.bend.items);

        let state_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("sim-state"),
            entries: &[
                uniform_entry(0, false, std::mem::size_of::<Params>() as u64),
                storage_entry(1, false),
                storage_entry(2, false),
                storage_entry(3, false),
                storage_entry(4, true),
            ],
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
                wgpu::BindGroupEntry { binding: 4, resource: sdf_buf.as_entire_binding() },
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
        let pipelines = ENTRY_POINTS
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
        let nsew = sew_ranges.len();
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
            ("sew", colored(Kernel::Sew, &sew_ranges, ns)),
            ("bend", colored(Kernel::Bend, &cons.bend.ranges, ns + nsew)),
            (
                "collide",
                per_vertex(match collider {
                    Collider::Sphere(_) => Kernel::CollideSphere,
                    Collider::Sdf(_) => Kernel::CollideSdf,
                }),
            ),
            ("update", per_vertex(Kernel::Update)),
        ];
        let phases = phases.into_iter().filter(|(_, d)| !d.is_empty()).collect();

        Self { cfg, n_verts: n, pos, prev, vel, params, collider, sdf_buf, base_params: p, state_bg, cons_bg, pipelines, phases, init_pos }
    }

    /// Write this frame's ramped parameters (gravity, sewing compliance). Call before
    /// `encode_frame`; a 96-byte upload, not a readback.
    pub fn prepare_frame(&self, queue: &wgpu::Queue, frame: u32) {
        let t = frame as f32 * self.cfg.frame_dt;
        let sch = &self.cfg.schedule;
        let mut p = self.base_params;
        let g = sch.gravity_scale(t);
        p.gravity_dt[0] *= g;
        p.gravity_dt[1] *= g;
        p.gravity_dt[2] *= g;
        p.sew_compliance = sch.sew_compliance(t);
        p.sew_max_step = sch.sew_step_limit(t);
        queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&p));
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

/// Analytic sphere collider (M1 scene).
pub fn sphere(center: Vec3, radius: f32) -> Collider {
    Collider::Sphere(center.extend(radius))
}
