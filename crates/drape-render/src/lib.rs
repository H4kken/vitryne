// SPDX-License-Identifier: AGPL-3.0-or-later
//! Viewport rendering, kept out of the solver (drape-core has no rendering): GPU-recomputed cloth
//! normals, lit shading, an orbit camera, the collider, and picking for cloth drags.

pub mod triangle;

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use wgpu::util::DeviceExt;

use drape_core::{mesh::ClothMesh, scene::RenderMesh, sim::Solver};

pub const NORMALS_SHADER: &str = include_str!("../shaders/normals.wgsl");
pub const SHADER: &str = include_str!("../shaders/render.wgsl");
pub const SEAMS_SHADER: &str = include_str!("../shaders/seams.wgsl");
pub const RIM_SHADER: &str = include_str!("../shaders/rim.wgsl");
pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// Multisample antialiasing: the scene is drawn with 4 samples per pixel, then resolved into the
/// caller's view. 4 is the count WebGPU guarantees for render formats without any feature.
pub const MSAA_SAMPLES: u32 = 4;
/// Half the thickness the cloth is drawn with, m: 2 mm in all, a little more than most fabrics
/// so a hem reads at a normal zoom, and within the solver's 2 mm collision thickness so the inner
/// layer stays off the body.
pub const CLOTH_HALF_THICKNESS: f32 = 0.001;
/// Sewn vertices closer than this are drawn as one, m (a closed seam is 1-2 mm open in the solver).
const WELD_NEAR: f32 = 0.005;
/// Sewn vertices further apart than this are drawn where they are (a seam still closing), m.
const WELD_FAR: f32 = 0.015;
/// The background.
pub const CLEAR_COLOR: wgpu::Color = wgpu::Color {
    r: 0.09,
    g: 0.09,
    b: 0.11,
    a: 1.0,
};

/// Colours of the scene (the values the shader gets: the targets are not sRGB).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Style {
    pub background: [f32; 3],
    pub cloth: [f32; 3],
    pub cloth_back: [f32; 3],
    pub body: [f32; 3],
}

impl Default for Style {
    /// The native viewer's: dark background, red cloth, grey body.
    fn default() -> Self {
        Self {
            background: [
                CLEAR_COLOR.r as f32,
                CLEAR_COLOR.g as f32,
                CLEAR_COLOR.b as f32,
            ],
            cloth: [0.85, 0.3, 0.25],
            cloth_back: [0.55, 0.55, 0.6],
            body: [0.75, 0.75, 0.72],
        }
    }
}

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
        Self {
            target: Vec3::new(0.0, 0.6, 0.0),
            yaw: 0.6,
            pitch: 0.35,
            distance: 2.6,
            fov_y: 40f32.to_radians(),
        }
    }
}

impl OrbitCamera {
    pub fn looking_at(target: Vec3, distance: f32) -> Self {
        Self {
            target,
            distance,
            ..Default::default()
        }
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
struct SeamParamsU {
    viewport: [f32; 2],
    half_width_px: f32,
    _pad: f32,
}

/// The colours seams are drawn in, by seam order (the editor's flat view uses the same).
pub const SEAM_COLOURS: [[f32; 3]; 6] = [
    [0.227, 0.388, 0.941],
    [0.839, 0.271, 0.498],
    [0.122, 0.616, 0.420],
    [0.851, 0.510, 0.169],
    [0.482, 0.361, 0.839],
    [0.165, 0.616, 0.710],
];

/// The segments to draw for named seams (`GarmentDesc::seams`): between consecutive paired
/// vertices on each side, one colour per seam.
pub fn seam_segments(seams: &[(String, Vec<(u32, u32)>)]) -> Vec<([u32; 2], [f32; 3])> {
    seam_segments_of(seams, None)
}

/// [`seam_segments`] of seam `only` alone (in its own colour), or of all of them.
pub fn seam_segments_of(
    seams: &[(String, Vec<(u32, u32)>)],
    only: Option<usize>,
) -> Vec<([u32; 2], [f32; 3])> {
    let mut out = Vec::new();
    for (k, (_, pairs)) in seams.iter().enumerate() {
        if only.is_some_and(|o| o != k) {
            continue;
        }
        let c = SEAM_COLOURS[k % SEAM_COLOURS.len()];
        for w in pairs.windows(2) {
            for (p, q) in [(w[0].0, w[1].0), (w[0].1, w[1].1)] {
                if p != q {
                    out.push(([p, q], c));
                }
            }
        }
    }
    out
}

/// One drawn piece of a seam: two cloth vertices and a colour.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SeamSegmentU {
    seg: [u32; 2],
    _pad: [u32; 2],
    color: [f32; 4],
}

/// The seams drawn on the cloth, as segments between its vertices.
struct SeamLines {
    instances: wgpu::Buffer,
    count: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct MaterialU {
    front: [f32; 4],
    back: [f32; 4],
    /// x: half the thickness drawn (0: a plain surface).
    shell: [f32; 4],
}

struct DrawMesh {
    pos: wgpu::Buffer,
    nrm: wgpu::Buffer,
    /// Per vertex: a colour (rgb, sRGB like `Style`) and how much it replaces the material's (a).
    tint: wgpu::Buffer,
    index: wgpu::Buffer,
    n_indices: u32,
    material: wgpu::BindGroup,
    material_buf: wgpu::Buffer,
    /// Half the thickness drawn, as in `material_buf`.
    half_thickness: f32,
}

/// The cloth: drawn from the solver's positions with closed seams welded, its normals recomputed
/// each frame.
struct Cloth {
    /// `pos` is the welded copy of the solver's positions.
    draw: DrawMesh,
    weld_bg: wgpu::BindGroup,
    normals_bg: wgpu::BindGroup,
    normals_groups: u32,
    seam_bg: wgpu::BindGroup,
    /// The free edges' quads (rim.wgsl).
    rim_bg: wgpu::BindGroup,
    rim_count: u32,
}

/// A frame drawn by `Renderer::snapshot`, on its way back from the GPU.
pub struct Snapshot {
    buffer: wgpu::Buffer,
    /// Bytes per row in `buffer` (padded for the copy).
    row: u32,
    w: u32,
    h: u32,
    bgra: bool,
}

impl Snapshot {
    /// The image: RGBA8, rows top to bottom.
    pub async fn read(self, device: &wgpu::Device) -> Vec<u8> {
        let slice = self.buffer.slice(..);
        drape_core::gpu_async::map_read(device, &slice)
            .await
            .expect("map_read");
        let mut out = Vec::with_capacity((self.w * self.h * 4) as usize);
        {
            let data = slice.get_mapped_range().expect("mapped range");
            for y in 0..self.h as usize {
                let line = &data[y * self.row as usize..][..self.w as usize * 4];
                for &[p0, p1, p2, _] in line.as_chunks::<4>().0 {
                    let [r, g, b] = if self.bgra {
                        [p2, p1, p0]
                    } else {
                        [p0, p1, p2]
                    };
                    out.extend_from_slice(&[r, g, b, 255]);
                }
            }
        }
        self.buffer.unmap();
        out
    }
}

struct Targets {
    color: wgpu::TextureView,
    depth: wgpu::TextureView,
    w: u32,
    h: u32,
}

pub struct Renderer {
    camera_buf: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    rim_pipeline: wgpu::RenderPipeline,
    weld_pipeline: wgpu::ComputePipeline,
    normals_pipeline: wgpu::ComputePipeline,
    /// None: the collider alone (`body_only`).
    cloth: Option<Cloth>,
    collider: Option<DrawMesh>,
    /// The multisampled colour and depth targets, at the last drawn size: the view's, then
    /// snapshots' (so a thumbnail doesn't make the view's again).
    targets: [Option<Targets>; 2],
    format: wgpu::TextureFormat,
    background: wgpu::Color,
    seam_pipeline: wgpu::RenderPipeline,
    seam_params: wgpu::Buffer,
    seams: Option<SeamLines>,
    show_seams: bool,
}

/// The cloth a renderer draws: its mesh, sewing pairs and the solver's positions.
type ClothSource<'a> = (&'a ClothMesh, &'a [(u32, u32)], &'a wgpu::Buffer);

fn material(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    front: [f32; 3],
    back: [f32; 3],
    half_thickness: f32,
) -> (wgpu::BindGroup, wgpu::Buffer) {
    let buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("material"),
        contents: bytemuck::bytes_of(&material_u(front, back, half_thickness)),
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
    });
    let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("material"),
        layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: buf.as_entire_binding(),
        }],
    });
    (bg, buf)
}

fn material_u(front: [f32; 3], back: [f32; 3], half_thickness: f32) -> MaterialU {
    MaterialU {
        front: [front[0], front[1], front[2], 1.0],
        back: [back[0], back[1], back[2], 1.0],
        shell: [half_thickness, 0.0, 0.0, 0.0],
    }
}

/// For each vertex, the other vertices sewn to it, directly or through others (a corner where
/// three pieces meet), as CSR: offsets (`n + 1`) and the list.
fn weld_lists(n: usize, sew: &[(u32, u32)]) -> (Vec<u32>, Vec<u32>) {
    let mut parent: Vec<u32> = (0..n as u32).collect();
    fn root(parent: &mut [u32], mut i: u32) -> u32 {
        while parent[i as usize] != i {
            parent[i as usize] = parent[parent[i as usize] as usize];
            i = parent[i as usize];
        }
        i
    }
    for &(a, b) in sew {
        let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
        parent[ra.max(rb) as usize] = ra.min(rb);
    }
    let mut groups: std::collections::BTreeMap<u32, Vec<u32>> = Default::default();
    for &(a, b) in sew {
        for v in [a, b] {
            groups.entry(root(&mut parent, v)).or_default().push(v);
        }
    }
    let mut partners = vec![Vec::new(); n];
    for mut g in groups.into_values() {
        g.sort_unstable();
        g.dedup();
        for &v in &g {
            partners[v as usize].extend(g.iter().copied().filter(|&u| u != v));
        }
    }
    let mut off = Vec::with_capacity(n + 1);
    off.push(0);
    let mut list = Vec::new();
    for p in partners {
        list.extend(p);
        off.push(list.len() as u32);
    }
    (off, list)
}

/// The mesh's free edges (one triangle): its two vertices and the triangle's third, padded to 4.
fn free_edges(mesh: &ClothMesh) -> Vec<[u32; 4]> {
    mesh.edges()
        .into_iter()
        .filter(|e| e.opposite.len() == 1)
        .map(|e| [e.v[0], e.v[1], e.opposite[0], 0])
        .collect()
}

impl Renderer {
    /// `sew`: the sewing pairs (`GarmentDesc::sew_pairs`), drawn welded once their seams close.
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        mesh: &ClothMesh,
        sew: &[(u32, u32)],
        solver: &Solver,
        collider: &RenderMesh,
    ) -> Self {
        Self::build(device, format, Some((mesh, sew, &solver.pos)), collider)
    }

    /// The collider alone, for a garment with no pieces yet.
    pub fn body_only(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        collider: &RenderMesh,
    ) -> Self {
        Self::build(device, format, None, collider)
    }

    /// `cloth`: its mesh, sewing pairs and the solver's positions.
    fn build(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        cloth: Option<ClothSource>,
        collider: &RenderMesh,
    ) -> Self {
        let init = |label: &str, data: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: data,
                usage,
            })
        };
        let st = wgpu::BufferUsages::STORAGE;
        let nmod = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("normals.wgsl"),
            source: wgpu::ShaderSource::Wgsl(NORMALS_SHADER.into()),
        });
        let compute = |label, entry| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(label),
                layout: None,
                module: &nmod,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let weld_pipeline = compute("weld", "weld_positions");
        let normals_pipeline = compute("normals", "compute_normals");
        // Weld and normals compute.
        let cloth = cloth.map(|(mesh, sew, solver_pos)| {
            let n = mesh.n_verts() as u32;
            let tris: Vec<u32> = mesh.tris.iter().flatten().copied().collect();
            let (adj_off, adj) = mesh.vertex_triangles();
            let (weld_off, mut weld) = weld_lists(mesh.n_verts(), sew);
            let mut rim = free_edges(mesh);
            let rim_count = rim.len() as u32;
            // Bindings can't be empty.
            if weld.is_empty() {
                weld.push(0);
            }
            if rim.is_empty() {
                rim.push([0; 4]);
            }
            let nparams = init(
                "normals-params",
                bytemuck::cast_slice(&[n, WELD_NEAR.to_bits(), WELD_FAR.to_bits(), 0]),
                wgpu::BufferUsages::UNIFORM,
            );
            let tris_buf = init(
                "tris",
                bytemuck::cast_slice(&tris),
                st | wgpu::BufferUsages::INDEX,
            );
            let adj_off_buf = init("adj-off", bytemuck::cast_slice(&adj_off), st);
            let adj_buf = init("adj", bytemuck::cast_slice(&adj), st);
            let weld_off_buf = init("weld-off", bytemuck::cast_slice(&weld_off), st);
            let weld_buf = init("weld", bytemuck::cast_slice(&weld), st);
            let rim_buf = init("rim-edges", bytemuck::cast_slice(&rim), st);
            let per_vertex = |label| {
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(label),
                    size: n as u64 * 16,
                    usage: st | wgpu::BufferUsages::VERTEX,
                    mapped_at_creation: false,
                })
            };
            let nrm = per_vertex("normals");
            let pos = per_vertex("draw-pos");
            let bind =
                |label, pipeline: &wgpu::ComputePipeline, buffers: &[(u32, &wgpu::Buffer)]| {
                    let entries: Vec<_> = buffers
                        .iter()
                        .map(|&(binding, b)| wgpu::BindGroupEntry {
                            binding,
                            resource: b.as_entire_binding(),
                        })
                        .collect();
                    device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some(label),
                        layout: &pipeline.get_bind_group_layout(0),
                        entries: &entries,
                    })
                };
            let weld_bg = bind(
                "weld",
                &weld_pipeline,
                &[
                    (0, &nparams),
                    (1, solver_pos),
                    (6, &weld_off_buf),
                    (7, &weld_buf),
                    (8, &pos),
                ],
            );
            let normals_bg = bind(
                "normals",
                &normals_pipeline,
                &[
                    (0, &nparams),
                    (1, solver_pos),
                    (2, &tris_buf),
                    (3, &adj_off_buf),
                    (4, &adj_buf),
                    (5, &nrm),
                    (6, &weld_off_buf),
                    (7, &weld_buf),
                    (8, &pos),
                ],
            );
            (
                pos,
                nrm,
                tris_buf,
                tris.len() as u32,
                n,
                weld_bg,
                normals_bg,
                rim_buf,
                rim_count,
            )
        });

        // Draw pipeline.
        let uniform_bgl = |label| {
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(label),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
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
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buf.as_entire_binding(),
            }],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("render.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("render"),
            bind_group_layouts: &[Some(&cam_bgl), Some(&mat_bgl)],
            immediate_size: 0,
        });
        const ATTRS: [[wgpu::VertexAttribute; 1]; 3] = [
            wgpu::vertex_attr_array![0 => Float32x4],
            wgpu::vertex_attr_array![1 => Float32x4],
            wgpu::vertex_attr_array![2 => Float32x4],
        ];
        let vb = |loc: usize| wgpu::VertexBufferLayout {
            array_stride: 16,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &ATTRS[loc],
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("render"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_main"),
                buffers: &[Some(vb(0)), Some(vb(1)), Some(vb(2))],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLES,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });

        let style = Style::default();
        let cloth_mat = material(
            device,
            &mat_bgl,
            style.cloth,
            style.cloth_back,
            CLOTH_HALF_THICKNESS,
        );
        let body_mat = material(device, &mat_bgl, style.body, style.body, 0.0);
        let no_tint = |label, n: usize| {
            init(
                label,
                bytemuck::cast_slice(&vec![[0f32; 4]; n]),
                wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST | st,
            )
        };
        let sp: Vec<[f32; 4]> = collider
            .pos
            .iter()
            .map(|p| p.extend(1.0).to_array())
            .collect();
        let sn: Vec<[f32; 4]> = collider
            .nrm
            .iter()
            .map(|n| n.extend(0.0).to_array())
            .collect();
        let si = &collider.idx;
        let collider = Some(DrawMesh {
            pos: init(
                "collider-pos",
                bytemuck::cast_slice(&sp),
                wgpu::BufferUsages::VERTEX,
            ),
            nrm: init(
                "collider-nrm",
                bytemuck::cast_slice(&sn),
                wgpu::BufferUsages::VERTEX,
            ),
            tint: no_tint("collider-tint", sn.len()),
            index: init(
                "collider-idx",
                bytemuck::cast_slice(si),
                wgpu::BufferUsages::INDEX,
            ),
            n_indices: si.len() as u32,
            material: body_mat.0,
            material_buf: body_mat.1,
            half_thickness: 0.0,
        });

        // Seam lines: quads from segments of cloth vertices, read from the solver's positions.
        let seam_params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("seam-params"),
            size: std::mem::size_of::<SeamParamsU>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let seam_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("seams"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let storage_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let rim_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("rim"),
            entries: &[
                storage_entry(0),
                storage_entry(1),
                storage_entry(2),
                storage_entry(3),
            ],
        });
        let cloth = cloth.map(|c| {
            let (pos, nrm, index, n_indices, n, weld_bg, normals_bg, rim_buf, rim_count) = c;
            let tint = no_tint("cloth-tint", n as usize);
            let rim_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("rim"),
                layout: &rim_bgl,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: pos.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: nrm.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: tint.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: rim_buf.as_entire_binding(),
                    },
                ],
            });
            let seam_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("seams"),
                layout: &seam_bgl,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: pos.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: seam_params.as_entire_binding(),
                    },
                ],
            });
            Cloth {
                draw: DrawMesh {
                    pos,
                    nrm,
                    tint,
                    index,
                    n_indices,
                    material: cloth_mat.0,
                    material_buf: cloth_mat.1,
                    half_thickness: CLOTH_HALF_THICKNESS,
                },
                weld_bg,
                normals_bg,
                normals_groups: n.div_ceil(64),
                seam_bg,
                rim_bg,
                rim_count,
            }
        });
        let rim_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("rim.wgsl"),
            source: wgpu::ShaderSource::Wgsl(RIM_SHADER.into()),
        });
        let rim_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("rim"),
            bind_group_layouts: &[Some(&cam_bgl), Some(&mat_bgl), Some(&rim_bgl)],
            immediate_size: 0,
        });
        let rim_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("rim"),
            layout: Some(&rim_layout),
            vertex: wgpu::VertexState {
                module: &rim_module,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &rim_module,
                entry_point: Some("fs_main"),
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLES,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });
        let seam_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("seams.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SEAMS_SHADER.into()),
        });
        let seam_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("seams"),
            bind_group_layouts: &[Some(&cam_bgl), Some(&seam_bgl)],
            immediate_size: 0,
        });
        let seam_attrs = [
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Uint32x2,
                offset: 0,
                shader_location: 0,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 16,
                shader_location: 1,
            },
        ];
        let seam_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("seams"),
            layout: Some(&seam_layout),
            vertex: wgpu::VertexState {
                module: &seam_module,
                entry_point: Some("vs_main"),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<SeamSegmentU>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &seam_attrs,
                })],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &seam_module,
                entry_point: Some("fs_main"),
                targets: &[Some(format.into())],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLES,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });

        Self {
            camera_buf,
            camera_bg,
            pipeline,
            rim_pipeline,
            seam_pipeline,
            seam_params,
            seams: None,
            show_seams: false,
            weld_pipeline,
            normals_pipeline,
            cloth,
            collider,
            targets: [None, None],
            format,
            background: CLEAR_COLOR,
        }
    }

    /// The multisampled colour and depth views for a `w` × `h` view (made again on a resize).
    fn targets(
        &mut self,
        device: &wgpu::Device,
        w: u32,
        h: u32,
        slot: usize,
    ) -> (wgpu::TextureView, wgpu::TextureView) {
        if !matches!(&self.targets[slot], Some(t) if t.w == w && t.h == h) {
            let make = |label, format| {
                device
                    .create_texture(&wgpu::TextureDescriptor {
                        label: Some(label),
                        size: wgpu::Extent3d {
                            width: w,
                            height: h,
                            depth_or_array_layers: 1,
                        },
                        mip_level_count: 1,
                        sample_count: MSAA_SAMPLES,
                        dimension: wgpu::TextureDimension::D2,
                        format,
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        view_formats: &[],
                    })
                    .create_view(&Default::default())
            };
            self.targets[slot] = Some(Targets {
                color: make("msaa-color", self.format),
                depth: make("depth", DEPTH_FORMAT),
                w,
                h,
            });
        }
        let t = self.targets[slot].as_ref().unwrap();
        (t.color.clone(), t.depth.clone())
    }

    /// The seams to draw on the cloth: segments between two cloth vertices, each with a colour
    /// (rgb 0..1). Empty clears them.
    pub fn set_seams(&mut self, device: &wgpu::Device, segments: &[([u32; 2], [f32; 3])]) {
        self.seams = (!segments.is_empty()).then(|| {
            let data: Vec<SeamSegmentU> = segments
                .iter()
                .map(|&(seg, c)| SeamSegmentU {
                    seg,
                    _pad: [0; 2],
                    color: [c[0], c[1], c[2], 1.0],
                })
                .collect();
            SeamLines {
                instances: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("seam-segments"),
                    contents: bytemuck::cast_slice(&data),
                    usage: wgpu::BufferUsages::VERTEX,
                }),
                count: data.len() as u32,
            }
        });
    }

    /// Whether the seams are drawn (they are kept either way).
    pub fn show_seams(&mut self, on: bool) {
        self.show_seams = on;
    }

    /// Recompute normals and draw cloth + collider into `view` (size `w`×`h`).
    /// Recolours the scene (applies at the next submit).
    pub fn set_style(&mut self, queue: &wgpu::Queue, s: &Style) {
        let [r, g, b] = s.background.map(f64::from);
        self.background = wgpu::Color { r, g, b, a: 1.0 };
        if let Some(c) = &self.cloth {
            queue.write_buffer(
                &c.draw.material_buf,
                0,
                bytemuck::bytes_of(&material_u(s.cloth, s.cloth_back, c.draw.half_thickness)),
            );
        }
        if let Some(c) = &self.collider {
            queue.write_buffer(
                &c.material_buf,
                0,
                bytemuck::bytes_of(&material_u(s.body, s.body, c.half_thickness)),
            );
        }
    }

    /// Colours the cloth by panel: `colors[k]` (sRGB 0..1, as `Style`) for the vertices
    /// `panels[k]`, or the style's cloth colour where it is none (applies at the next submit).
    pub fn set_panel_colors(
        &self,
        queue: &wgpu::Queue,
        panels: &[std::ops::Range<u32>],
        colors: &[Option<[f32; 3]>],
    ) {
        let Some(cloth) = &self.cloth else {
            return;
        };
        let n = (cloth.draw.tint.size() / 16) as usize;
        let mut tint = vec![[0f32; 4]; n];
        for (r, c) in panels.iter().zip(colors) {
            if let Some([red, g, b]) = c {
                let r = r.start as usize..(r.end as usize).min(n);
                tint[r].fill([*red, *g, *b, 1.0]);
            }
        }
        queue.write_buffer(&cloth.draw.tint, 0, bytemuck::cast_slice(&tint));
    }

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
        self.draw_to(device, queue, encoder, view, w, h, camera, 0);
    }

    /// Draws one frame, without the seams, into a new `w` × `h` image and submits its copy for
    /// reading (`Snapshot::read`, which doesn't need the renderer). For project thumbnails; the
    /// view's own targets aren't touched.
    pub fn snapshot(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        w: u32,
        h: u32,
        camera: &OrbitCamera,
    ) -> Snapshot {
        let size = wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        };
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("snapshot"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("snapshot-readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = device.create_command_encoder(&Default::default());
        let seams = std::mem::replace(&mut self.show_seams, false);
        self.draw_to(
            device,
            queue,
            &mut enc,
            &tex.create_view(&Default::default()),
            w,
            h,
            camera,
            1,
        );
        self.show_seams = seams;
        enc.copy_texture_to_buffer(
            tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(h),
                },
            },
            size,
        );
        queue.submit([enc.finish()]);
        Snapshot {
            buffer,
            row,
            w,
            h,
            bgra: matches!(
                self.format,
                wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_to(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        w: u32,
        h: u32,
        camera: &OrbitCamera,
        slot: usize,
    ) {
        let cam = CameraU {
            view_proj: camera
                .view_proj(w as f32 / h.max(1) as f32)
                .to_cols_array_2d(),
            eye: camera.eye().extend(1.0).to_array(),
            light_dir: Vec3::new(0.4, 1.0, 0.6).normalize().extend(0.0).to_array(),
        };
        queue.write_buffer(&self.camera_buf, 0, bytemuck::bytes_of(&cam));
        if let Some(c) = &self.cloth {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("normals"),
                timestamp_writes: None,
            });
            // Welded positions first: the normals are taken from them.
            pass.set_pipeline(&self.weld_pipeline);
            pass.set_bind_group(0, &c.weld_bg, &[]);
            pass.dispatch_workgroups(c.normals_groups, 1, 1);
            pass.set_pipeline(&self.normals_pipeline);
            pass.set_bind_group(0, &c.normals_bg, &[]);
            pass.dispatch_workgroups(c.normals_groups, 1, 1);
        }
        let (color, depth) = self.targets(device, w, h, slot);
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene"),
            // Drawn multisampled, resolved into `view`; the samples aren't kept.
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &color,
                depth_slice: None,
                resolve_target: Some(view),
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(self.background),
                    store: wgpu::StoreOp::Discard,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_bg, &[]);
        let cloth = self.cloth.as_ref().map(|c| &c.draw);
        for m in cloth.into_iter().chain(self.collider.as_ref()) {
            pass.set_bind_group(1, &m.material, &[]);
            pass.set_vertex_buffer(0, m.pos.slice(..));
            pass.set_vertex_buffer(1, m.nrm.slice(..));
            pass.set_vertex_buffer(2, m.tint.slice(..));
            pass.set_index_buffer(m.index.slice(..), wgpu::IndexFormat::Uint32);
            // A shell: its outer and inner layers.
            let layers = if m.half_thickness > 0.0 { 2 } else { 1 };
            pass.draw_indexed(0..m.n_indices, 0, 0..layers);
        }
        if let Some(c) = self.cloth.as_ref().filter(|c| c.rim_count > 0) {
            pass.set_pipeline(&self.rim_pipeline);
            pass.set_bind_group(0, &self.camera_bg, &[]);
            pass.set_bind_group(1, &c.draw.material, &[]);
            pass.set_bind_group(2, &c.rim_bg, &[]);
            pass.draw(0..6, 0..c.rim_count);
        }
        if let (true, Some(lines), Some(c)) = (self.show_seams, &self.seams, &self.cloth) {
            // About 3 px wide; the viewport in the uniform sizes it.
            queue.write_buffer(
                &self.seam_params,
                0,
                bytemuck::bytes_of(&SeamParamsU {
                    viewport: [w as f32, h as f32],
                    half_width_px: 2.0,
                    _pad: 0.0,
                }),
            );
            pass.set_pipeline(&self.seam_pipeline);
            pass.set_bind_group(0, &self.camera_bg, &[]);
            pass.set_bind_group(1, &c.seam_bg, &[]);
            pass.set_vertex_buffer(0, lines.instances.slice(..));
            pass.draw(0..6, 0..lines.count);
        }
    }
}
