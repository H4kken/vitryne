//! Benchmark metrics. The GPU reduces the mesh to 16 bytes, which is the only per-frame
//! readback, and it only happens on the bench's sampled frames (hard rule 5).

use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use wgpu::util::DeviceExt;

use crate::{
    gpu_async,
    sim::{Collider, Solver},
};

pub const SHADER: &str = concat!(include_str!("../shaders/sdf.wgsl"), include_str!("../shaders/metrics.wgsl"));
const WG: u32 = 64;

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct FrameMetrics {
    pub kinetic_energy: f32,
    pub max_speed: f32,
    /// Min signed distance of any vertex to the collider surface (negative = penetration).
    /// For the avatar this is the GPU's SDF sample, not the exact mesh distance.
    pub min_collider_dist: f32,
    pub non_finite: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct MParams {
    sphere: [f32; 4],
    sdf_origin: [f32; 4],
    sdf_dims: [u32; 4],
    n_verts: u32,
    n_partials: u32,
    use_sdf: u32,
    sdf_band: f32,
}

pub struct GpuMetrics {
    reduce_vertices: wgpu::ComputePipeline,
    reduce_partials: wgpu::ComputePipeline,
    vertices_bg: wgpu::BindGroup,
    partials_bg: wgpu::BindGroup,
    result: wgpu::Buffer,
    readback: wgpu::Buffer,
    groups: u32,
}

impl GpuMetrics {
    pub fn new(device: &wgpu::Device, solver: &Solver) -> Self {
        let groups = solver.n_verts.div_ceil(WG);
        let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("metrics-params"),
            contents: bytemuck::bytes_of(&match &solver.collider {
                Collider::Sphere(s) => MParams {
                    sphere: s.to_array(),
                    sdf_origin: [0.0; 4],
                    sdf_dims: [1, 1, 1, 0],
                    n_verts: solver.n_verts,
                    n_partials: groups,
                    use_sdf: 0,
                    sdf_band: 0.0,
                },
                Collider::Sdf(sdf) => MParams {
                    sphere: [0.0; 4],
                    sdf_origin: sdf.origin.extend(sdf.cell).to_array(),
                    sdf_dims: [sdf.dims.x, sdf.dims.y, sdf.dims.z, 0],
                    n_verts: solver.n_verts,
                    n_partials: groups,
                    use_sdf: 1,
                    sdf_band: sdf.band,
                },
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let partials = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("metrics-partials"),
            size: groups as u64 * 16,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });
        let result = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("metrics-result"),
            size: 16,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("metrics-readback"),
            size: 16,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("metrics.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let mk = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let reduce_vertices = mk("reduce_vertices");
        let reduce_partials = mk("reduce_partials");
        // Auto layouts: reduce_vertices uses bindings 0-3 and 5, reduce_partials uses 0, 3, 4.
        let vertices_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("metrics"),
            layout: &reduce_vertices.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: solver.pos.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: solver.vel.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: partials.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 5, resource: solver.sdf_buf.as_entire_binding() },
            ],
        });
        let partials_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("metrics-partials"),
            layout: &reduce_partials.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: partials.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: result.as_entire_binding() },
            ],
        });
        Self { reduce_vertices, reduce_partials, vertices_bg, partials_bg, result, readback, groups }
    }

    /// Encode the reduction and the 16-byte copy into the readback buffer.
    pub fn encode(&self, encoder: &mut wgpu::CommandEncoder) {
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("metrics"), timestamp_writes: None });
            pass.set_pipeline(&self.reduce_vertices);
            pass.set_bind_group(0, &self.vertices_bg, &[]);
            pass.dispatch_workgroups(self.groups, 1, 1);
            pass.set_pipeline(&self.reduce_partials);
            pass.set_bind_group(0, &self.partials_bg, &[]);
            pass.dispatch_workgroups(1, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&self.result, 0, &self.readback, 0, 16);
    }

    /// Read the result of the last submitted `encode`.
    pub async fn read(&self, device: &wgpu::Device) -> FrameMetrics {
        let v: Vec<[f32; 4]> = gpu_async::read_buffer(device, &self.readback).await;
        let r = v[0];
        FrameMetrics { kinetic_energy: r[0], max_speed: r[1], min_collider_dist: r[2], non_finite: r[3] as u32 }
    }
}

/// "At rest" = RMS speed of free vertices below `vrms_threshold` for `window` consecutive frames.
/// The rest frame is the first frame of that streak (the moment motion settled); the streak
/// itself is only confirmation.
#[derive(Debug, Clone)]
pub struct RestDetector {
    pub vrms_threshold: f32,
    pub window: u32,
    free_mass: f32,
    streak_start: Option<u32>,
    /// Frames before this can't start a rest streak (sewing/gravity ramps still running).
    pub earliest_frame: u32,
    pub rest_frame: Option<u32>,
}

impl RestDetector {
    pub fn new(vrms_threshold: f32, window: u32, free_mass: f32) -> Self {
        Self { vrms_threshold, window, free_mass, streak_start: None, earliest_frame: 0, rest_frame: None }
    }

    pub fn vrms(&self, m: &FrameMetrics) -> f32 {
        (2.0 * m.kinetic_energy / self.free_mass.max(1e-12)).sqrt()
    }

    pub fn push(&mut self, frame: u32, m: &FrameMetrics) {
        if self.rest_frame.is_some() {
            return;
        }
        if frame >= self.earliest_frame && m.non_finite == 0 && self.vrms(m) < self.vrms_threshold {
            let start = *self.streak_start.get_or_insert(frame);
            if frame + 1 - start >= self.window {
                self.rest_frame = Some(start);
            }
        } else {
            self.streak_start = None;
        }
    }
}
