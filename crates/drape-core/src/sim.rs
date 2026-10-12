// SPDX-License-Identifier: AGPL-3.0-or-later
//! GPU XPBD solver. Everything per frame stays on the GPU (hard rule 5).

use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use glam::{Vec3, Vec4};
use serde::{Deserialize, Serialize};
use wgpu::util::DeviceExt;

use crate::{
    body::Sdf, constraints::Constraints, longrange::LongRangeGpu, mesh::ClothMesh,
    selfcol::SelfCollision, timer::GpuTimer, untangle::Untangle,
};

pub const SHADER: &str = concat!(
    include_str!("../shaders/sdf.wgsl"),
    include_str!("../shaders/sim.wgsl")
);

/// What the cloth collides with.
#[derive(Clone)]
pub enum Collider {
    /// Analytic sphere (M1).
    Sphere(Vec4),
    /// Baked signed distance field of the avatar (M2+).
    Sdf(Arc<Sdf>),
}

/// Time-dependent parameters, evaluated on the CPU and written to the uniform each frame.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
        if t < self.sew_ramp_s {
            self.sew_max_step
        } else {
            1.0e9
        }
    }

    /// Nothing can count as "at rest" before every ramp has finished.
    pub fn end_s(&self) -> f32 {
        self.sew_ramp_s
            .max(self.gravity_delay_s + self.gravity_ramp_s)
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
    /// XPBD constraint damping on stretch (beta, s): stiffness-proportional (Rayleigh) damping,
    /// damping coefficient = beta x stiffness, so gamma = beta / h in Macklin et al. 2016 eq. 26.
    /// Internal friction of the fabric: damps stretching motion (snaps, whips) without slowing
    /// rigid motion like global damping does. (Before M2 the shader used gamma = beta / (k h^3),
    /// which made soft fabrics viscous and stretchy, more so with more substeps.)
    pub stretch_damping: f32,
    /// Quadratic air drag k = 0.5 rho_air C_d / areal density (1/m): 0.5 * 1.2 * 1.0 / 0.15 = 4
    /// for cotton jersey. Isotropic (no normals in the sim pass), so it overestimates drag on
    /// motion within the cloth plane.
    pub air_drag: f32,
    /// Max collision push-out per vertex per substep, m. Default: uncapped (capping it let
    /// cloth sink into the body under load, see docs/history/PROGRESS.md M3).
    pub contact_max_step: f32,
    /// S3 contact velocity filter: max speed gain of a vertex in body contact, m/s² (0 = off,
    /// the spike-1 / S2 behaviour). Default 30 m/s² = 0.025 m/s per substep at 20 substeps:
    /// contact can stop a vertex at once but not launch it (crease fights, docs/history/PROGRESS.md S3).
    pub contact_max_accel: f32,
    /// S3: velocity-level Coulomb friction in body contact, with the contact's normal impulse
    /// (0 = off; the position-level friction above always applies).
    pub contact_vfriction: f32,
    /// Cloth-cloth vertex repulsion (M4), every substep.
    pub self_collision: bool,
    /// Repulsion distance as a multiple of the mean rest edge length. Point-point contact only
    /// stops a layer if no gap between its vertices is wider than ~2x the radius, so the
    /// radius has to follow the mesh resolution rather than the fabric thickness.
    pub self_radius_edges: f32,
    /// Pairs closer than this many radii along the rest mesh (or across a seam) never repel.
    pub self_exclude_radii: f32,
    pub self_friction: f32,
    /// Rebuild the hash and neighbour lists every this many substeps (1 = every substep, as
    /// the plan has it). Lists cover radius + margin, so a vertex pair can close up to the
    /// margin between rebuilds and still be caught.
    pub self_rebuild_every: u32,
    /// Neighbour-list margin, in radii.
    pub self_margin_radii: f32,
    /// Separation speed a repulsion push may create, m/s (beyond it the push is inelastic).
    pub self_max_push_speed: f32,
    /// S4 untangling (intersection contour minimization), with self-collision on: while any
    /// crossing is known, re-detect around it and move the layers back through each other
    /// every this many substeps (0 = untangling off, the S3 behaviour).
    pub untangle_every: u32,
    /// Full detection over the whole mesh every this many substeps, which finds new crossings
    /// (default 40 = every 2 frames at 20 substeps; 20 cost 1.4-1.9 ms per frame at 10k). The `untangle_every` passes only test triangles that touch
    /// a vertex flagged by the last detection, so their cost follows the size of the tangle.
    pub untangle_check_every: u32,
    /// Untangling displacement per application for a unit contour-gradient ratio, in mean rest
    /// edge lengths.
    pub untangle_step_edges: f32,
    /// Clamp on the gradient ratio |(g.e)/(n.e)| (large for edges almost parallel to the
    /// other triangle).
    pub untangle_max_ratio: f32,
    /// Self-collision repulsion skips pairs of vertices both flagged as tangled.
    pub untangle_skip_repulsion: bool,
    /// M2 long-range stretch limits (longrange.rs): spans in mean rest edge lengths, 0 = unused.
    /// All zero = off.
    pub long_range_spans: [f32; 4],
    /// The same across seams (total span, half on each side), 0 = unused.
    pub long_range_cross_spans: [f32; 4],
    /// Where in the substep: 0 = after stretch (before sewing), 1 = after the body contact,
    /// 2 = before stretch.
    pub long_range_slot: u32,
    /// Jacobi iterations per application.
    pub long_range_iterations: u32,
    /// Run them every this many substeps (1 = every substep).
    pub long_range_every: u32,
    /// M2 strain limiting after the body contact (Provot 1995): max edge strain, 0 = off.
    pub strain_limit: f32,
    /// Jacobi relaxation factor for the averaged corrections.
    pub long_range_omega: f32,
    /// XPBD damping on the long-range constraints, beta in s (gamma = beta / h).
    pub long_range_damping: f32,
    /// Strain allowed at long range before the constraint acts (0 = inextensible).
    pub long_range_slack: f32,
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
            stretch_damping: 1e-5,
            contact_max_step: 1.0,
            contact_max_accel: 30.0,
            contact_vfriction: 0.0,
            air_drag: 4.0,
            self_collision: false,
            self_radius_edges: 0.75,
            self_exclude_radii: 2.0,
            self_friction: 0.2,
            self_rebuild_every: 1,
            self_margin_radii: 0.5,
            self_max_push_speed: 1.0,
            untangle_every: 4,
            untangle_check_every: 40,
            untangle_step_edges: 0.1,
            untangle_max_ratio: 1.0,
            untangle_skip_repulsion: true,
            long_range_spans: [0.0; 4],
            long_range_cross_spans: [0.0; 4],
            long_range_every: 1,
            long_range_iterations: 1,
            long_range_slot: 0,
            strain_limit: 0.0,
            long_range_omega: 1.0,
            long_range_slack: 0.0,
            long_range_damping: 0.0,
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
    stretch_damping: f32,
    drag_target: [f32; 4],
    drag_count: u32,
    contact_max_step: f32,
    air_drag: f32,
    contact_dv_max: f32,
    contact_vfriction: f32,
    strain_limit: f32,
    _p: [u32; 2],
}

/// Total stiffness of the drag spring (N/m), shared by the patch vertices (per-vertex compliance
/// = n / k). A fixed total force scale, independent of mesh resolution: 1 cm of lag pulls with
/// 1 N, about the shirt's weight. (A per-vertex compliance looked soft but is effectively rigid
/// for 5-10 mg vertices, and rammed cloth through the body at 100+ N.)
pub const DRAG_STIFFNESS: f32 = 100.0;
/// Grab radius and size of the dragged patch.
pub const DRAG_RADIUS: f32 = 0.015;
pub const DRAG_MAX_VERTICES: usize = 32;
/// Soft release length, frames.
pub const RELEASE_FRAMES: u32 = 6;

/// A grabbed patch: vertices and their offsets from the patch centre at grab time.
#[derive(Debug, Clone, Serialize)]
pub struct DragPatch {
    pub center: [f32; 3],
    pub vertices: Vec<(u32, [f32; 3])>,
}

impl DragPatch {
    /// The picked vertex plus vertices reachable from it over mesh edges and within `radius`
    /// of it (graph-connected, so the other layer of the shirt isn't grabbed).
    pub fn grab(adj: &[Vec<u32>], pos: &[Vec3], picked: u32, radius: f32) -> Self {
        let c = pos[picked as usize];
        let mut seen = std::collections::HashSet::from([picked]);
        let mut queue = std::collections::VecDeque::from([picked]);
        let mut verts = Vec::new();
        while let Some(v) = queue.pop_front() {
            verts.push((v, (pos[v as usize] - c).to_array()));
            if verts.len() >= DRAG_MAX_VERTICES {
                break;
            }
            for &n in &adj[v as usize] {
                if (pos[n as usize] - c).length() <= radius && seen.insert(n) {
                    queue.push_back(n);
                }
            }
        }
        Self {
            center: c.to_array(),
            vertices: verts,
        }
    }
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
    LimitStretch = 7,
}

const ENTRY_POINTS: [&str; 8] = [
    "predict",
    "solve_stretch",
    "solve_sew",
    "solve_bend",
    "collide_sphere",
    "collide_sdf",
    "update_velocity",
    "limit_stretch",
];

#[derive(Clone, Copy)]
enum Pipe {
    Sim(Kernel),
    /// Index into the self-collision kernels (own pipeline layout and bind group).
    SelfCol(usize),
    /// Index into the untangling kernels (own pipeline layout), and whether it's the gated
    /// variant (only around known crossings) or the full detection.
    Untangle(usize, bool),
    /// Index into the long-range kernels (own pipeline layout, M2).
    LongRange(usize),
}

struct Dispatch {
    pipe: Pipe,
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
    /// Patch size and current target (None = not dragging).
    drag: std::cell::Cell<Option<(u32, Vec3)>>,
    drag_compliance: std::cell::Cell<f32>,
    /// Frames left in the soft release after `end_drag` (the grab fades out instead of
    /// letting go of stretched cloth all at once).
    releasing: std::cell::Cell<u32>,
    drag_buf: wgpu::Buffer,
    state_bg: wgpu::BindGroup,
    cons_bg: wgpu::BindGroup,
    pipelines: Vec<wgpu::ComputePipeline>,
    /// (label, dispatches, (every, offset)): runs in substeps s with s % every == offset, s
    /// counted from frame 0 (so a phase can run less often than once per frame).
    phases: Vec<(&'static str, Vec<Dispatch>, (u32, u32))>,
    /// Frame of the last `prepare_frame`, for the phase schedule.
    frame: std::cell::Cell<u32>,
    init_pos: Vec<[f32; 4]>,
    pub self_collision: Option<SelfCollision>,
    pub untangle: Option<Untangle>,
    pub long_range: Option<LongRangeGpu>,
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
    let contents: &[u8] = if data.is_empty() {
        bytemuck::cast_slice(&zero)
    } else {
        bytemuck::cast_slice(data)
    };
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
        let init_pos: Vec<[f32; 4]> = mesh
            .pos
            .iter()
            .zip(&inv_mass)
            .map(|(p, &w)| [p.x, p.y, p.z, w])
            .collect();
        let vs = wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_DST
            | wgpu::BufferUsages::COPY_SRC;
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
            stretch_damping: cfg.stretch_damping,
            drag_target: [0.0, 0.0, 0.0, 0.0],
            drag_count: 0,
            contact_max_step: cfg.contact_max_step,
            air_drag: cfg.air_drag,
            contact_dv_max: cfg.contact_max_accel * h,
            contact_vfriction: cfg.contact_vfriction,
            strain_limit: cfg.strain_limit,
            _p: [0; 2],
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
        let sew_ranges: Vec<(u32, u32)> = cons
            .sew
            .ranges
            .iter()
            .map(|&(o, c)| (o + n_stretch, c))
            .collect();
        let lin: Vec<_> = cons
            .stretch
            .items
            .iter()
            .chain(&cons.sew.items)
            .copied()
            .collect();

        // One 256-byte slot per colour: stretch, then sew, then bend.
        let all_ranges: Vec<(u32, u32)> = cons
            .stretch
            .ranges
            .iter()
            .chain(&sew_ranges)
            .chain(&cons.bend.ranges)
            .copied()
            .collect();
        let mut range_bytes = vec![0u8; (all_ranges.len().max(1) as u64 * RANGE_STRIDE) as usize];
        for (k, &(offset, count)) in all_ranges.iter().enumerate() {
            let r = Range {
                offset,
                count,
                _p: [0; 2],
            };
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
        let drag_buf = storage_init(device, "drag-patch", &[[0f32; 4]; DRAG_MAX_VERTICES]);

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
            entries: &[
                uniform_entry(0, true, 16),
                storage_entry(1, true),
                storage_entry(2, true),
                storage_entry(3, true),
            ],
        });
        let state_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sim-state"),
            layout: &state_bgl,
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
                    resource: vel.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: sdf_buf.as_entire_binding(),
                },
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
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: stretch.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: bend.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: drag_buf.as_entire_binding(),
                },
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
        let per_vertex = |kernel| {
            vec![Dispatch {
                pipe: Pipe::Sim(kernel),
                range_offset: 0,
                groups: vgroups,
            }]
        };
        let ns = cons.stretch.ranges.len();
        let nsew = sew_ranges.len();
        let colored = |kernel, ranges: &[(u32, u32)], base: usize| -> Vec<Dispatch> {
            ranges
                .iter()
                .enumerate()
                .map(|(k, &(_, count))| Dispatch {
                    pipe: Pipe::Sim(kernel),
                    range_offset: ((base + k) as u64 * RANGE_STRIDE) as u32,
                    groups: count.div_ceil(WG),
                })
                .filter(|d| d.groups > 0)
                .collect()
        };
        let untangle = (cfg.self_collision && cfg.untangle_every > 0).then(|| {
            Untangle::new(
                device,
                mesh,
                cons,
                &pos,
                &prev,
                cfg.untangle_step_edges * mesh.mean_edge_length(),
                cfg.untangle_max_ratio,
            )
        });
        // The full detection must run at least as often as the gated one, or crossings it would
        // find are never looked for.
        assert!(
            untangle.is_none() || cfg.untangle_check_every > 0,
            "untangle_check_every must be > 0"
        );
        let self_collision = cfg.self_collision.then(|| {
            let r = cfg.self_radius_edges * mesh.mean_edge_length();
            let rq = r * (1.0 + cfg.self_margin_radii);
            let flags = untangle
                .as_ref()
                .filter(|_| cfg.untangle_skip_repulsion)
                .map(|u| &u.acc);
            SelfCollision::new(
                device,
                mesh,
                cons,
                &pos,
                &prev,
                r,
                rq,
                r * cfg.self_exclude_radii,
                cfg.self_friction,
                cfg.self_max_push_speed * h,
                flags,
            )
        });
        let used = |s: &[f32; 4]| s.iter().copied().filter(|&s| s > 0.0).collect::<Vec<f32>>();
        let (spans, cross) = (
            used(&cfg.long_range_spans),
            used(&cfg.long_range_cross_spans),
        );
        let long_range = (!spans.is_empty() || !cross.is_empty()).then(|| {
            let sew: Vec<(u32, u32)> = cons.sew.items.iter().map(|s| (s.i, s.j)).collect();
            let (lr, info) = crate::longrange::build(mesh, &sew, &spans, &cross);
            log::info!(
                "long range: spans {spans:?} edges, {:?} pairs; across seams {cross:?}, {:?} pairs; {} skipped (outside the panel), {:.0} ms",
                info.pairs,
                info.cross_pairs,
                info.skipped_outside,
                info.build_ms
            );
            LongRangeGpu::new(
                device,
                &lr,
                info,
                &pos,
                &prev,
                cfg.long_range_omega,
                cfg.long_range_slack,
                cfg.long_range_damping / h,
            )
        });
        let lr_kernel = |k: usize| {
            let d = long_range
                .as_ref()
                .map(|l| {
                    (0..cfg.long_range_iterations.max(1))
                        .flat_map(|_| {
                            [0, 1].map(|kk| Dispatch {
                                pipe: Pipe::LongRange(kk),
                                range_offset: 0,
                                groups: l.groups,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .filter(|_| k == 0)
                .unwrap_or_default();
            (
                crate::longrange::PHASES[k],
                d,
                (cfg.long_range_every.max(1), 0),
            )
        };
        // One phase per kernel, so profiling mode times each: (label, dispatches, (every, offset)).
        let rebuild = cfg.self_rebuild_every.max(1);
        let self_kernel = |k: usize| {
            let d = self_collision
                .as_ref()
                .map(|sc| {
                    vec![Dispatch {
                        pipe: Pipe::SelfCol(k),
                        range_offset: 0,
                        groups: sc.groups[k],
                    }]
                })
                .unwrap_or_default();
            (
                crate::selfcol::PHASES[k],
                d,
                (
                    if k < crate::selfcol::REBUILD_KERNELS {
                        rebuild
                    } else {
                        1
                    },
                    0,
                ),
            )
        };
        // Full detection at offset 0; the gated passes halfway between, so with the defaults they
        // never land on a full one (substeps 2, 6, 10, ... of each 40).
        let check = cfg.untangle_check_every.max(1);
        let gated_every = cfg.untangle_every.max(1);
        let untangle_kernel = |k: usize, gated: bool| {
            let d = untangle
                .as_ref()
                .filter(|_| !gated || gated_every < check)
                .map(|u| {
                    vec![Dispatch {
                        pipe: Pipe::Untangle(k, gated),
                        range_offset: 0,
                        groups: u.groups[k],
                    }]
                })
                .unwrap_or_default();
            if gated {
                (
                    crate::untangle::PHASES_GATED[k],
                    d,
                    (gated_every, gated_every / 2),
                )
            } else {
                (crate::untangle::PHASES[k], d, (check, 0))
            }
        };
        let phases = vec![
            ("predict", per_vertex(Kernel::Predict), (1, 0)),
            if cfg.long_range_slot == 2 {
                lr_kernel(0)
            } else {
                ("lr_gather", vec![], (1, 0))
            },
            if cfg.long_range_slot == 2 {
                lr_kernel(1)
            } else {
                ("lr_apply", vec![], (1, 0))
            },
            (
                "stretch",
                colored(Kernel::Stretch, &cons.stretch.ranges, 0),
                (1, 0),
            ),
            if cfg.long_range_slot == 0 {
                lr_kernel(0)
            } else {
                ("lr_gather", vec![], (1, 0))
            },
            if cfg.long_range_slot == 0 {
                lr_kernel(1)
            } else {
                ("lr_apply", vec![], (1, 0))
            },
            ("sew", colored(Kernel::Sew, &sew_ranges, ns), (1, 0)),
            (
                "bend",
                colored(Kernel::Bend, &cons.bend.ranges, ns + nsew),
                (1, 0),
            ),
            // Hash rebuild before the body contact, repulsion after it. With the repulsion
            // first, the body pushed layers back into each other and the two fought every
            // substep (drag test: 44 frames over 5 m/s across 6 seeds vs 27 this way, and no
            // body penetration either way; docs/history/PROGRESS.md M4).
            self_kernel(0),
            self_kernel(1),
            self_kernel(2),
            self_kernel(3),
            self_kernel(4),
            (
                "collide",
                per_vertex(match collider {
                    Collider::Sphere(_) => Kernel::CollideSphere,
                    Collider::Sdf(_) => Kernel::CollideSdf,
                }),
                (1, 0),
            ),
            if cfg.long_range_slot == 1 {
                lr_kernel(0)
            } else {
                ("lr_gather", vec![], (1, 0))
            },
            if cfg.long_range_slot == 1 {
                lr_kernel(1)
            } else {
                ("lr_apply", vec![], (1, 0))
            },
            (
                "strain_limit",
                if cfg.strain_limit > 0.0 {
                    colored(Kernel::LimitStretch, &cons.stretch.ranges, 0)
                } else {
                    Vec::new()
                },
                (1, 0),
            ),
            self_kernel(5),
            self_kernel(6),
            // Untangling last, on the positions every other pass has corrected (S4).
            untangle_kernel(0, false),
            untangle_kernel(1, false),
            untangle_kernel(2, false),
            untangle_kernel(3, false),
            untangle_kernel(4, false),
            untangle_kernel(5, false),
            untangle_kernel(0, true),
            untangle_kernel(1, true),
            untangle_kernel(2, true),
            untangle_kernel(3, true),
            untangle_kernel(4, true),
            untangle_kernel(5, true),
            ("update", per_vertex(Kernel::Update), (1, 0)),
        ];
        let phases = phases
            .into_iter()
            .filter(|(_, d, _)| !d.is_empty())
            .collect();

        Self {
            cfg,
            n_verts: n,
            pos,
            prev,
            vel,
            params,
            collider,
            sdf_buf,
            base_params: p,
            drag: std::cell::Cell::new(None),
            releasing: std::cell::Cell::new(0),
            drag_compliance: std::cell::Cell::new(0.0),
            drag_buf,
            state_bg,
            cons_bg,
            pipelines,
            phases,
            frame: std::cell::Cell::new(0),
            init_pos,
            self_collision,
            untangle,
            long_range,
        }
    }

    /// Start dragging a grabbed patch (one small upload).
    pub fn begin_drag(&self, queue: &wgpu::Queue, patch: &DragPatch) {
        let data: Vec<[f32; 4]> = patch
            .vertices
            .iter()
            .map(|(v, o)| [o[0], o[1], o[2], f32::from_bits(*v)])
            .collect();
        queue.write_buffer(&self.drag_buf, 0, bytemuck::cast_slice(&data));
        self.drag
            .set(Some((data.len() as u32, Vec3::from(patch.center))));
        self.drag_compliance.set(data.len() as f32 / DRAG_STIFFNESS);
        self.releasing.set(0);
    }

    /// Move the patch centre's target; takes effect at the next `prepare_frame`. The target
    /// behaves like a hand that can't enter the body: it moves from its last position toward
    /// the request and stops at the surface (+5 mm). Snapping inside targets to the *nearest*
    /// surface instead made them jump to the far side of the body as a drag path crossed it,
    /// whipping large regions of cloth around.
    pub fn set_drag_target(&self, target: Vec3) {
        let Some((n, from)) = self.drag.get() else {
            return;
        };
        // With self-collision, leave room for one more layer between the hand and the body.
        let margin =
            self.cfg.thickness + 0.005 + self.self_collision.as_ref().map_or(0.0, |sc| sc.radius);
        let outside = |p: Vec3| match &self.collider {
            Collider::Sdf(sdf) => sdf.sample(p) >= margin,
            Collider::Sphere(s) => (p - s.truncate()).length() >= s.w + margin,
        };
        let t = if outside(target) {
            target
        } else {
            let steps = ((target - from).length() / 0.002).ceil().max(1.0) as u32;
            let mut last = from;
            for k in 1..=steps {
                let p = from.lerp(target, k as f32 / steps as f32);
                if !outside(p) {
                    break;
                }
                last = p;
            }
            last
        };
        self.drag.set(Some((n, t)));
    }

    /// Let go: the attachment fades out over `RELEASE_FRAMES` (compliance ×10 per frame).
    pub fn end_drag(&self) {
        if self.drag.get().is_some() && self.releasing.get() == 0 {
            self.releasing.set(RELEASE_FRAMES);
        }
    }

    pub fn dragging(&self) -> bool {
        self.drag.get().is_some() && self.releasing.get() == 0
    }

    /// Write this frame's parameters (ramped gravity and sewing compliance, drag). Call before
    /// `encode_frame`; a 128-byte upload, not a readback.
    pub fn prepare_frame(&self, queue: &wgpu::Queue, frame: u32) {
        self.frame.set(frame);
        let t = frame as f32 * self.cfg.frame_dt;
        let sch = &self.cfg.schedule;
        let mut p = self.base_params;
        let g = sch.gravity_scale(t);
        p.gravity_dt[0] *= g;
        p.gravity_dt[1] *= g;
        p.gravity_dt[2] *= g;
        p.sew_compliance = sch.sew_compliance(t);
        p.sew_max_step = sch.sew_step_limit(t);
        if let Some(l) = &self.long_range {
            l.set_cross(queue, t >= sch.sew_ramp_s);
        }
        if let Some((n, t)) = self.drag.get() {
            p.drag_count = n;
            p.drag_target[..3].copy_from_slice(&t.to_array());
            p.drag_target[3] = self.drag_compliance.get();
            let r = self.releasing.get();
            if r > 0 {
                p.drag_target[3] *= 10f32.powi((RELEASE_FRAMES - r + 1) as i32);
                if r == 1 {
                    self.drag.set(None);
                }
                self.releasing.set(r - 1);
            }
        }
        queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&p));
    }

    /// Phases that run in substep `s` of `frame`.
    fn due_in(
        &self,
        frame: u32,
        s: u32,
    ) -> impl Iterator<Item = &(&'static str, Vec<Dispatch>, (u32, u32))> {
        let g = frame.wrapping_mul(self.cfg.substeps).wrapping_add(s);
        self.phases.iter().filter(move |p| g % p.2.0 == p.2.1)
    }

    /// Phases that run in substep `s` of the frame set by the last `prepare_frame`.
    fn due(&self, s: u32) -> impl Iterator<Item = &(&'static str, Vec<Dispatch>, (u32, u32))> {
        self.due_in(self.frame.get(), s)
    }

    /// In frame 0, which has every phase that runs less than once per frame (all start at
    /// substep 0), so it's the largest frame.
    pub fn dispatches_per_frame(&self) -> u32 {
        (0..self.cfg.substeps)
            .map(|s| self.due_in(0, s).map(|p| p.1.len() as u32).sum::<u32>())
            .sum()
    }

    /// Passes encoded per frame in profiling mode (one per phase per substep), in the largest
    /// frame (frame 0).
    pub fn profiled_passes_per_frame(&self) -> u32 {
        (0..self.cfg.substeps)
            .map(|s| self.due_in(0, s).count() as u32)
            .sum()
    }

    /// `bound`: which group 0 is currently set (0 = none, 1 = solver state, 2 = self-collision,
    /// 3 / 4 = untangling full / gated, 5 = long range; the last four have their own layouts), so it is only
    /// rebound when switching.
    fn run(&self, pass: &mut wgpu::ComputePass<'_>, ds: &[Dispatch], bound: &mut u8) {
        for d in ds {
            match d.pipe {
                Pipe::Sim(k) => {
                    pass.set_pipeline(&self.pipelines[k as usize]);
                    if *bound != 1 {
                        pass.set_bind_group(0, &self.state_bg, &[]);
                        *bound = 1;
                    }
                    pass.set_bind_group(1, &self.cons_bg, &[d.range_offset]);
                }
                Pipe::SelfCol(k) => {
                    let sc = self.self_collision.as_ref().unwrap();
                    pass.set_pipeline(&sc.pipelines[k]);
                    if *bound != 2 {
                        pass.set_bind_group(0, &sc.bind_group, &[]);
                        *bound = 2;
                    }
                }
                Pipe::LongRange(k) => {
                    let l = self.long_range.as_ref().unwrap();
                    pass.set_pipeline(&l.pipelines[k]);
                    if *bound != 5 {
                        pass.set_bind_group(0, &l.bind_group, &[]);
                        *bound = 5;
                    }
                }
                Pipe::Untangle(k, gated) => {
                    let u = self.untangle.as_ref().unwrap();
                    pass.set_pipeline(&u.pipelines[k]);
                    let b = 3 + gated as u8;
                    if *bound != b {
                        pass.set_bind_group(0, &u.bind_groups[gated as usize], &[]);
                        *bound = b;
                    }
                }
            }
            pass.dispatch_workgroups(d.groups, 1, 1);
        }
    }

    /// Encode one frame (`substeps` substeps). Canonical mode: a single compute pass.
    /// With an enabled timer: one pass per phase per substep so each gets timestamps.
    pub fn encode_frame(&self, encoder: &mut wgpu::CommandEncoder, timer: Option<&mut GpuTimer>) {
        match timer {
            Some(timer) if timer.enabled() => {
                for s in 0..self.cfg.substeps {
                    for (label, ds, _) in self.due(s) {
                        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                            label: Some(label),
                            timestamp_writes: timer.compute_pass_writes(label),
                        });
                        self.run(&mut pass, ds, &mut 0);
                    }
                }
            }
            _ => {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("sim-frame"),
                    timestamp_writes: None,
                });
                for s in 0..self.cfg.substeps {
                    for (_, ds, _) in self.due(s) {
                        self.run(&mut pass, ds, &mut 0);
                    }
                }
            }
        }
    }

    /// Debug replay (S3 spike attribution): phase labels, and one phase of one substep in its
    /// own pass. Returns false if that phase doesn't run in that substep.
    pub fn phase_labels(&self) -> Vec<&'static str> {
        self.phases.iter().map(|p| p.0).collect()
    }

    pub fn encode_phase(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        substep: u32,
        phase: usize,
    ) -> bool {
        let (_, ds, (every, offset)) = &self.phases[phase];
        if (self.frame.get() * self.cfg.substeps + substep) % every != *offset {
            return false;
        }
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("replay"),
            timestamp_writes: None,
        });
        self.run(&mut pass, ds, &mut 0);
        true
    }

    /// Benchmark/picking readback of all positions (not used per frame by the solver).
    pub async fn read_positions(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Vec<Vec3> {
        let rb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pos-readback"),
            size: self.n_verts as u64 * 16,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(&self.pos, 0, &rb, 0, self.n_verts as u64 * 16);
        queue.submit([enc.finish()]);
        let v: Vec<[f32; 4]> = crate::gpu_async::read_buffer(device, &rb).await;
        v.iter().map(|p| Vec3::new(p[0], p[1], p[2])).collect()
    }

    pub fn reset(&self, queue: &wgpu::Queue) {
        queue.write_buffer(&self.pos, 0, bytemuck::cast_slice(&self.init_pos));
        queue.write_buffer(&self.prev, 0, bytemuck::cast_slice(&self.init_pos));
        queue.write_buffer(&self.vel, 0, &vec![0u8; self.n_verts as usize * 16]);
    }

    pub fn total_free_mass(mesh: &ClothMesh, density: f32) -> f32 {
        mesh.masses(density)
            .iter()
            .zip(&mesh.pinned)
            .filter(|(_, p)| !**p)
            .map(|(m, _)| m)
            .sum()
    }
}

/// Analytic sphere collider (M1 scene).
pub fn sphere(center: Vec3, radius: f32) -> Collider {
    Collider::Sphere(center.extend(radius))
}
