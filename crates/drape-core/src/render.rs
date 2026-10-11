//! Minimal renderer: GPU-recomputed cloth normals, lit shading, an orbit camera, and the collider.

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use wgpu::util::DeviceExt;

use crate::{
    mesh::ClothMesh,
    scene::RenderMesh,
    sim::Solver,
};

pub const NORMALS_SHADER: &str = include_str!("../shaders/normals.wgsl");
pub const SHADER: &str = include_str!("../shaders/render.wgsl");
pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

#[derive(Debug, Clone, Copy)]
pub struct OrbitCamera {
    pub target: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub fov_y: f32,
}

impl Default for OrbitCamera {
    fn default() -> Self {
        Self { target: Vec3::new(0.0, 0.6, 0.0), yaw: 0.6, pitch: 0.35, distance: 2.6, fov_y: 40f32.to_radians() }
    }
}

impl OrbitCamera {
    pub fn looking_at(target: Vec3, distance: f32) -> Self {
        Self { target, distance, ..Default::default() }
    }

    pub fn eye(&self) -> Vec3 {
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        self.target + self.distance * Vec3::new(cp * sy, sp, cp * cy)
    }

    pub fn view_proj(&self, aspect: f32) -> Mat4 {
        // WebGPU clip space: Z in [0, 1], Y up (glam's "directx" convention).
        glam::camera::rh::proj::directx::perspective(self.fov_y, aspect, 0.01, 50.0)
            * glam::camera::rh::view::look_at_mat4(self.eye(), self.target, Vec3::Y)
    }

    /// World-space ray through a point in normalized device coordinates (x, y in -1..1, y up).
    pub fn ray(&self, ndc_x: f32, ndc_y: f32, aspect: f32) -> (Vec3, Vec3) {
        let inv = self.view_proj(aspect).inverse();
        let near = inv.project_point3(Vec3::new(ndc_x, ndc_y, 0.0));
        let far = inv.project_point3(Vec3::new(ndc_x, ndc_y, 1.0));
        (near, (far - near).normalize())
    }

    pub fn orbit(&mut self, dx: f32, dy: f32) {
        self.yaw -= dx * 0.008;
        self.pitch = (self.pitch + dy * 0.008).clamp(-1.5, 1.5);
    }

    pub fn zoom(&mut self, steps: f32) {
        self.distance = (self.distance * 0.9f32.powf(steps)).clamp(0.2, 20.0);
    }
}

/// Vertex closest to the ray among those within `radius` of it, preferring the nearest along
/// the ray (so the front layer wins over the back of the shirt).
pub fn pick(positions: &[Vec3], origin: Vec3, dir: Vec3, radius: f32) -> Option<u32> {
    let mut best: Option<(u32, f32)> = None;
    for (i, p) in positions.iter().enumerate() {
        let v = *p - origin;
        let t = v.dot(dir);
        if t <= 0.0 {
            continue;
        }
        if (v - t * dir).length() <= radius && best.is_none_or(|(_, bt)| t < bt) {
            best = Some((i as u32, t));
        }
    }
    best.map(|(i, _)| i)
}

/// Where the drag target goes when the mouse ray moves: the ray's intersection with the plane
/// through `anchor` facing the camera.
pub fn drag_target(camera: &OrbitCamera, origin: Vec3, dir: Vec3, anchor: Vec3) -> Vec3 {
    let n = (camera.eye() - camera.target).normalize();
    let denom = dir.dot(n);
    if denom.abs() < 1e-6 {
        return anchor;
    }
    origin + dir * ((anchor - origin).dot(n) / denom)
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CameraU {
    view_proj: [[f32; 4]; 4],
    eye: [f32; 4],
    light_dir: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct MaterialU {
    front: [f32; 4],
    back: [f32; 4],
}

struct DrawMesh {
    pos: wgpu::Buffer,
    nrm: wgpu::Buffer,
    index: wgpu::Buffer,
    n_indices: u32,
    material: wgpu::BindGroup,
}

pub struct Renderer {
    camera_buf: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    normals_pipeline: wgpu::ComputePipeline,
    normals_bg: wgpu::BindGroup,
    normals_groups: u32,
    cloth: DrawMesh,
    collider: Option<DrawMesh>,
    depth: Option<(wgpu::TextureView, u32, u32)>,
}

fn material(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, front: [f32; 3], back: [f32; 3]) -> wgpu::BindGroup {
    let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("material"),
        contents: bytemuck::bytes_of(&MaterialU { front: [front[0], front[1], front[2], 1.0], back: [back[0], back[1], back[2], 1.0] }),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("material"),
        layout,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() }],
    })
}


impl Renderer {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, mesh: &ClothMesh, solver: &Solver, collider: &RenderMesh) -> Self {
        let n = mesh.n_verts() as u32;
        // Normals compute.
        let tris: Vec<u32> = mesh.tris.iter().flatten().copied().collect();
        let (adj_off, adj) = mesh.vertex_triangles();
        let init = |label: &str, data: &[u8], usage| device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents: data, usage });
        let st = wgpu::BufferUsages::STORAGE;
        let nparams = init("normals-params", bytemuck::cast_slice(&[n, 0, 0, 0]), wgpu::BufferUsages::UNIFORM);
        let tris_buf = init("tris", bytemuck::cast_slice(&tris), st | wgpu::BufferUsages::INDEX);
        let adj_off_buf = init("adj-off", bytemuck::cast_slice(&adj_off), st);
        let adj_buf = init("adj", bytemuck::cast_slice(&adj), st);
        let nrm = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("normals"),
            size: n as u64 * 16,
            usage: st | wgpu::BufferUsages::VERTEX,
            mapped_at_creation: false,
        });
        let nmod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("normals.wgsl"),
            source: wgpu::ShaderSource::Wgsl(NORMALS_SHADER.into()),
        });
        let normals_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("normals"),
            layout: None,
            module: &nmod,
            entry_point: Some("compute_normals"),
            compilation_options: Default::default(),
            cache: None,
        });
        let normals_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("normals"),
            layout: &normals_pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: nparams.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: solver.pos.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: tris_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: adj_off_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: adj_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 5, resource: nrm.as_entire_binding() },
            ],
        });

        // Draw pipeline.
        let uniform_bgl = |label| {
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(label),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                }],
            })
        };
        let cam_bgl = uniform_bgl("camera");
        let mat_bgl = uniform_bgl("material");
        let camera_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera"),
            size: std::mem::size_of::<CameraU>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("camera"),
            layout: &cam_bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: camera_buf.as_entire_binding() }],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("render.wgsl"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("render"),
            bind_group_layouts: &[Some(&cam_bgl), Some(&mat_bgl)],
            immediate_size: 0,
        });
        let vb = |loc| wgpu::VertexBufferLayout {
            array_stride: 16,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: match loc {
                0 => &[wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 0 }],
                _ => &[wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 0, shader_location: 1 }],
            },
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("render"),
            layout: Some(&layout),
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs_main"), buffers: &[Some(vb(0)), Some(vb(1))], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });

        let cloth = DrawMesh {
            pos: solver.pos.clone(),
            nrm,
            index: tris_buf,
            n_indices: tris.len() as u32,
            material: material(device, &mat_bgl, [0.85, 0.3, 0.25], [0.55, 0.55, 0.6]),
        };
        let sp: Vec<[f32; 4]> = collider.pos.iter().map(|p| p.extend(1.0).to_array()).collect();
        let sn: Vec<[f32; 4]> = collider.nrm.iter().map(|n| n.extend(0.0).to_array()).collect();
        let si = &collider.idx;
        let collider = Some(DrawMesh {
            pos: init("collider-pos", bytemuck::cast_slice(&sp), wgpu::BufferUsages::VERTEX),
            nrm: init("collider-nrm", bytemuck::cast_slice(&sn), wgpu::BufferUsages::VERTEX),
            index: init("collider-idx", bytemuck::cast_slice(si), wgpu::BufferUsages::INDEX),
            n_indices: si.len() as u32,
            material: material(device, &mat_bgl, [0.75, 0.75, 0.72], [0.75, 0.75, 0.72]),
        });

        Self { camera_buf, camera_bg, pipeline, normals_pipeline, normals_bg, normals_groups: n.div_ceil(64), cloth, collider, depth: None }
    }

    fn depth_view(&mut self, device: &wgpu::Device, w: u32, h: u32) -> wgpu::TextureView {
        if !matches!(&self.depth, Some((_, dw, dh)) if *dw == w && *dh == h) {
            let tex = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("depth"),
                size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: DEPTH_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            self.depth = Some((tex.create_view(&Default::default()), w, h));
        }
        self.depth.as_ref().unwrap().0.clone()
    }

    /// Recompute normals and draw cloth + collider into `view` (size `w`×`h`).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        w: u32,
        h: u32,
        camera: &OrbitCamera,
    ) {
        let cam = CameraU {
            view_proj: camera.view_proj(w as f32 / h.max(1) as f32).to_cols_array_2d(),
            eye: camera.eye().extend(1.0).to_array(),
            light_dir: Vec3::new(0.4, 1.0, 0.6).normalize().extend(0.0).to_array(),
        };
        queue.write_buffer(&self.camera_buf, 0, bytemuck::bytes_of(&cam));
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("normals"), timestamp_writes: None });
            pass.set_pipeline(&self.normals_pipeline);
            pass.set_bind_group(0, &self.normals_bg, &[]);
            pass.dispatch_workgroups(self.normals_groups, 1, 1);
        }
        let depth = self.depth_view(device, w, h);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.09, g: 0.09, b: 0.11, a: 1.0 }), store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_bg, &[]);
        for m in std::iter::once(&self.cloth).chain(self.collider.as_ref()) {
            pass.set_bind_group(1, &m.material, &[]);
            pass.set_vertex_buffer(0, m.pos.slice(..));
            pass.set_vertex_buffer(1, m.nrm.slice(..));
            pass.set_index_buffer(m.index.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..m.n_indices, 0, 0..1);
        }
    }
}
