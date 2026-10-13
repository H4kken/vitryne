// SPDX-License-Identifier: AGPL-3.0-or-later
//! The public engine API (M3). Everything that runs a drape goes through here: the native
//! viewer and CLI, the benchmarks, the regression suite and the web bindings.
//!
//! ```ignore
//! let engine  = Engine::new(gpu);
//! let body    = engine.load_body(&avatar, &BodyOptions::default())?;
//! let garment = engine.load_garment(&garment_desc, &fabric)?;
//! let mut sim = engine.simulate(&garment, &body, &SimSettings::default());
//! sim.step(60);
//! sim.grab(vertex, target).await;  sim.release();
//! let state   = sim.read_state().await;   // positions, normals, per-triangle strain
//! let metrics = sim.metrics().await;      // rest, speed, penetration, intersections, strain
//! ```
//!
//! What the caller describes (the *desc* types) is plain data: a flat-pattern mesh with its
//! sewing pairs, a fabric, a ramp schedule. What `Engine` loads is that plus the GPU-ready
//! constraints. A `Simulation` owns the solver and its buffers and holds `Arc`s of the device,
//! garment and body, so a viewer can keep one in a struct.

use std::{cell::Cell, rc::Rc, sync::Arc};

use glam::Vec3;
use serde::Serialize;

use crate::{
    bench::{Penetration, penetration_check},
    body::{BodyMesh, BodyQuery, Sdf},
    constraints::{Constraints, Material},
    gpu::Gpu,
    mesh::ClothMesh,
    metrics::{FrameMetrics, GpuMetrics},
    scene::RenderMesh,
    selfcheck::{self, SelfIntersections},
    sim::{Collider, DragPatch, Schedule, SimSettings, Solver},
    strain::{self, StrainStats},
    timer::GpuTimer,
};

/// Fabric physical parameters (per garment; per piece later, M9).
pub type Fabric = Material;

/// Where the SDF comes from. The SDF only has to cover what the cloth can reach, so its box
/// belongs to the garment (`GarmentDesc::sdf`), and a baked one can be cached by the caller.
#[derive(Debug, Clone)]
pub enum SdfSource {
    /// Bake it on the CPU (seconds).
    Bake(SdfParams),
    /// A previously baked one (`Sdf::to_bytes`).
    Bytes(Vec<u8>),
}

pub use crate::body::SdfParams;

/// An avatar: a closed, consistently oriented triangle mesh in metres, y up.
#[derive(Debug, Clone)]
pub struct Avatar {
    pub name: String,
    /// Wavefront OBJ text.
    pub obj: String,
}

#[derive(Debug, Clone)]
pub struct BodyOptions {
    pub sdf: SdfSource,
}

impl Default for BodyOptions {
    /// Bakes the default box (hips to shoulders, 4 mm cells, 12 cm band).
    fn default() -> Self {
        Self {
            sdf: SdfSource::Bake(SdfParams::default()),
        }
    }
}

/// The collision body: what the cloth lands on. An avatar (exact BVH distance for the checks,
/// SDF for the solver) or an analytic sphere (the sheet test scene).
pub struct Body {
    pub name: String,
    pub collider: Collider,
    /// Exact signed distance, for penetration checks; `None` for the sphere.
    pub query: Option<Arc<BodyQuery>>,
    /// What to draw for it.
    pub render: RenderMesh,
}

impl Body {
    /// Parses the avatar and builds its collision data. CPU only (BVH, and the SDF bake when
    /// it isn't given), so it can run before there is a device; the result is shared between
    /// simulations.
    pub fn load(avatar: &Avatar, opts: &BodyOptions) -> Result<Body, String> {
        let mesh =
            BodyMesh::from_obj(&avatar.obj).map_err(|e| format!("avatar {}: {e}", avatar.name))?;
        Self::from_mesh(&avatar.name, mesh, opts)
    }

    /// As `load`, from a mesh already read (a project's glTF avatar).
    pub fn from_mesh(name: &str, mesh: BodyMesh, opts: &BodyOptions) -> Result<Body, String> {
        Self::from_mesh_with_progress(name, mesh, opts, &mut |_| {})
    }

    /// As `from_mesh`, reporting how much of an SDF bake is done (see
    /// `Sdf::bake_with_progress`).
    pub fn from_mesh_with_progress(
        name: &str,
        mesh: BodyMesh,
        opts: &BodyOptions,
        progress: &mut dyn FnMut(f32),
    ) -> Result<Body, String> {
        let query = Arc::new(BodyQuery::new(mesh));
        let sdf = match &opts.sdf {
            SdfSource::Bake(p) => p.bake_with_progress(&query, progress),
            SdfSource::Bytes(b) => Sdf::from_bytes(b).ok_or("bad SDF bytes")?,
        };
        let bm = &query.mesh;
        Ok(Body {
            name: name.to_string(),
            collider: Collider::Sdf(Arc::new(sdf)),
            render: RenderMesh {
                pos: bm.pos.clone(),
                nrm: bm.vertex_normals(),
                idx: bm.tris.iter().flatten().copied().collect(),
            },
            query: Some(query),
        })
    }

    /// A sphere collider (the sheet test scene).
    pub fn sphere(center: Vec3, radius: f32) -> Body {
        Body {
            name: "sphere".into(),
            collider: crate::sim::sphere(center, radius),
            query: None,
            render: crate::scene::uv_sphere(center, radius, 48, 96),
        }
    }

    /// The baked SDF, if the collider is an avatar.
    pub fn sdf(&self) -> Option<&Arc<Sdf>> {
        match &self.collider {
            Collider::Sdf(s) => Some(s),
            Collider::Sphere(_) => None,
        }
    }
}

/// A garment as data: the pattern pieces already meshed and placed around the body, the sewing
/// pairs, and where its parts are. (M5 produces this from the project format.)
#[derive(Debug, Clone)]
pub struct GarmentDesc {
    pub name: String,
    /// Free-form parameters of how it was built, copied into benchmark reports.
    pub description: serde_json::Value,
    /// Rest shape = the flat pattern (`rest`), start shape = placed around the body (`pos`).
    pub mesh: ClothMesh,
    /// Vertex pairs that must meet.
    pub sew_pairs: Vec<(u32, u32)>,
    /// Named seams (sewing pairs by seam), and named vertex ranges (pieces), for diagnostics.
    pub seams: Vec<(String, Vec<(u32, u32)>)>,
    pub groups: Vec<(String, std::ops::Range<u32>)>,
    /// Sewing and gravity ramp; `None` = whatever `SimSettings::schedule` says.
    pub schedule: Option<Schedule>,
    /// The region the cloth can reach, for the body's SDF.
    pub sdf: SdfParams,
    /// A good camera: target and distance.
    pub camera: (Vec3, f32),
}

/// A garment ready to simulate: the description plus its fabric and solver constraints.
pub struct Garment {
    pub desc: GarmentDesc,
    pub fabric: Fabric,
    pub constraints: Constraints,
}

impl Garment {
    /// Builds the solver constraints (graph-coloured stretch and bend, sewing).
    pub fn load(desc: &GarmentDesc, fabric: &Fabric) -> Result<Garment, String> {
        let n = desc.mesh.n_verts();
        if let Some(&(a, b)) = desc
            .sew_pairs
            .iter()
            .find(|&&(a, b)| a as usize >= n || b as usize >= n)
        {
            return Err(format!(
                "{}: sewing pair ({a}, {b}) is out of range",
                desc.name
            ));
        }
        let mut constraints = Constraints::build(&desc.mesh, fabric);
        constraints.set_sewing(&desc.sew_pairs, n);
        Ok(Garment {
            desc: desc.clone(),
            fabric: *fabric,
            constraints,
        })
    }

    pub fn mesh(&self) -> &ClothMesh {
        &self.desc.mesh
    }

    pub fn name(&self) -> &str {
        &self.desc.name
    }

    /// Index of the piece (vertex group) a vertex belongs to.
    pub fn group_of(&self, v: u32) -> Option<&str> {
        self.desc
            .groups
            .iter()
            .find(|(_, r)| r.contains(&v))
            .map(|(n, _)| n.as_str())
    }
}

/// Entry point: owns the device.
#[derive(Clone)]
pub struct Engine {
    gpu: Rc<Gpu>,
}

impl Engine {
    pub fn new(gpu: Gpu) -> Self {
        Self { gpu: Rc::new(gpu) }
    }

    pub fn gpu(&self) -> &Gpu {
        &self.gpu
    }

    /// The device handle, to hold while the engine's simulations are borrowed mutably.
    pub fn gpu_handle(&self) -> Rc<Gpu> {
        self.gpu.clone()
    }

    /// See `Body::load`.
    pub fn load_body(&self, avatar: &Avatar, opts: &BodyOptions) -> Result<Body, String> {
        Body::load(avatar, opts)
    }

    /// See `Body::sphere`.
    pub fn sphere_body(&self, center: Vec3, radius: f32) -> Body {
        Body::sphere(center, radius)
    }

    /// See `Garment::load`.
    pub fn load_garment(&self, desc: &GarmentDesc, fabric: &Fabric) -> Result<Garment, String> {
        Garment::load(desc, fabric)
    }

    /// Builds the solver for `garment` on `body`. The garment's own schedule, if it has one,
    /// replaces `settings.schedule`.
    pub fn simulate(
        &self,
        garment: &Arc<Garment>,
        body: &Arc<Body>,
        settings: &SimSettings,
    ) -> Simulation {
        let mut settings = *settings;
        if let Some(s) = garment.desc.schedule {
            settings.schedule = s;
        }
        let solver = Solver::new(
            &self.gpu.device,
            garment.mesh(),
            &garment.constraints,
            garment.fabric.density,
            settings,
            body.collider.clone(),
        );
        if let Collider::Sdf(sdf) = &body.collider {
            let inside = garment
                .mesh()
                .pos
                .iter()
                .filter(|p| sdf.sample(**p) < settings.thickness)
                .count();
            log::info!(
                "{}: {} verts, {} tris, {} sew pairs, {inside} verts start inside the body's thickness",
                garment.name(),
                garment.mesh().n_verts(),
                garment.mesh().tris.len(),
                garment.desc.sew_pairs.len()
            );
        }
        let metrics = GpuMetrics::new(&self.gpu.device, &solver);
        let weld = selfcheck::weld_map(garment.mesh().n_verts(), &garment.constraints);
        Simulation {
            gpu: self.gpu.clone(),
            adj: garment.mesh().neighbors(),
            weld,
            garment: garment.clone(),
            body: body.clone(),
            solver,
            metrics,
            frame: Cell::new(0),
            settings,
        }
    }
}

/// A running simulation. Its methods take `&self` (the solver's frame-to-frame state lives in
/// GPU buffers and cells), so a viewer can share it between callbacks.
pub struct Simulation {
    gpu: Rc<Gpu>,
    garment: Arc<Garment>,
    body: Arc<Body>,
    solver: Solver,
    metrics: GpuMetrics,
    adj: Vec<Vec<u32>>,
    weld: Vec<u32>,
    frame: Cell<u32>,
    settings: SimSettings,
}

/// Cloth state read back from the GPU.
#[derive(Debug, Clone)]
pub struct State {
    pub frame: u32,
    pub positions: Vec<Vec3>,
    /// Area-weighted vertex normals.
    pub normals: Vec<Vec3>,
    /// Per triangle: the larger principal stretch of the in-plane deformation, minus 1.
    pub triangle_strain: Vec<f32>,
}

/// Everything `Simulation::metrics` measures (one readback, and CPU checks on it).
#[derive(Debug, Clone, Serialize)]
pub struct Metrics {
    pub frame: u32,
    /// GPU reduction: kinetic energy, max speed, min SDF distance, non-finite count.
    pub sample: FrameMetrics,
    /// RMS speed of the free vertices, m/s.
    pub vrms: f32,
    /// `vrms` below `SimSettings::rest_vrms` and the ramps over. A rest *frame* needs the
    /// window of `rest_window` frames: sample every frame with `RestDetector`.
    pub at_rest: bool,
    /// Exact (BVH) penetration of the vertices into the body; `None` for the sphere.
    pub penetration: Option<Penetration>,
    pub self_intersections: SelfIntersections,
    /// Edge strain of the stretch constraints.
    pub strain: StrainStats,
    /// Largest distance between sewn vertices, mm; `None` if nothing is sewn.
    pub max_seam_gap_mm: Option<f32>,
}

impl Simulation {
    pub fn gpu(&self) -> &Gpu {
        &self.gpu
    }

    /// The device handle, to use while the simulation is borrowed mutably.
    pub fn gpu_handle(&self) -> Rc<Gpu> {
        self.gpu.clone()
    }

    pub fn garment(&self) -> &Arc<Garment> {
        &self.garment
    }

    pub fn body(&self) -> &Arc<Body> {
        &self.body
    }

    pub fn settings(&self) -> &SimSettings {
        &self.settings
    }

    /// The solver, for the renderer's vertex buffer and for diagnostics (phase profiling,
    /// attribution). Not part of the stable API.
    pub fn solver(&self) -> &Solver {
        &self.solver
    }

    pub fn n_verts(&self) -> u32 {
        self.solver.n_verts
    }

    /// Frames simulated so far.
    pub fn frame(&self) -> u32 {
        self.frame.get()
    }

    /// Simulated seconds.
    pub fn time(&self) -> f32 {
        self.frame.get() as f32 * self.settings.frame_dt
    }

    /// Vertex adjacency over mesh edges.
    pub fn adjacency(&self) -> &[Vec<u32>] {
        &self.adj
    }

    /// Advances `n` frames, one submit each (parameters are written per frame, and queue
    /// writes apply at submit). Doesn't wait for the GPU.
    pub fn step(&self, n: u32) {
        for _ in 0..n {
            let mut enc = self.gpu.device.create_command_encoder(&Default::default());
            self.encode_step(&mut enc, None);
            self.gpu.queue.submit([enc.finish()]);
        }
    }

    /// Encodes one frame into `enc` (so a viewer can draw in the same submit) and counts it.
    /// With a timer in profiling mode every phase is its own timed pass.
    pub fn encode_step(&self, enc: &mut wgpu::CommandEncoder, timer: Option<&mut GpuTimer>) {
        let frame = self.frame.get();
        self.solver.prepare_frame(&self.gpu.queue, frame);
        self.solver.encode_frame(enc, timer);
        self.frame.set(frame + 1);
    }

    /// Waits until everything submitted has finished.
    pub async fn wait(&self) {
        crate::gpu_async::work_done(&self.gpu.device, &self.gpu.queue).await;
    }

    /// Back to the placed state, at rest, frame 0; releases a grab.
    pub fn reset(&self) {
        self.solver.reset(&self.gpu.queue);
        self.solver.end_drag();
        self.frame.set(0);
    }

    /// One frame (frame 0's parameters), waited for, then a reset: pipelines and buffers are
    /// first-use costs that mustn't land in a measurement.
    pub async fn warm_up(&self) {
        let mut enc = self.gpu.device.create_command_encoder(&Default::default());
        self.encode_step(&mut enc, None);
        self.gpu.queue.submit([enc.finish()]);
        self.wait().await;
        self.reset();
    }

    // --- grab ---------------------------------------------------------------------------

    /// Grabs the patch around `vertex` and pulls it towards `target`. Reads the positions
    /// back once (to find the patch). `set_target` moves it, `release` lets go.
    pub async fn grab(&self, vertex: u32, target: Vec3) {
        let pos = self.read_positions().await;
        let patch = DragPatch::grab(&self.adj, &pos, vertex, self.settings.drag_radius);
        self.grab_patch(&patch, target);
    }

    /// The same with a patch the caller already built (it had the positions).
    pub fn grab_patch(&self, patch: &DragPatch, target: Vec3) {
        self.solver.begin_drag(&self.gpu.queue, patch);
        self.solver.set_drag_target(target);
    }

    /// Where the hand is; clamped so it can't go into the body.
    pub fn set_target(&self, target: Vec3) {
        self.solver.set_drag_target(target);
    }

    pub fn release(&self) {
        self.solver.end_drag();
    }

    /// True while a grab is held (not while it's fading out).
    pub fn grabbing(&self) -> bool {
        self.solver.dragging()
    }

    // --- readback -----------------------------------------------------------------------

    pub async fn read_positions(&self) -> Vec<Vec3> {
        self.solver
            .read_positions(&self.gpu.device, &self.gpu.queue)
            .await
    }

    pub async fn read_state(&self) -> State {
        let positions = self.read_positions().await;
        State {
            frame: self.frame.get(),
            normals: self.garment.mesh().vertex_normals(&positions),
            triangle_strain: triangle_strain(self.garment.mesh(), &positions),
            positions,
        }
    }

    /// The GPU reduction only (a 16-byte readback), the cheap per-frame sample.
    pub async fn sample(&self) -> FrameMetrics {
        let mut enc = self.gpu.device.create_command_encoder(&Default::default());
        self.metrics.encode(&mut enc);
        self.gpu.queue.submit([enc.finish()]);
        self.metrics.read(&self.gpu.device).await
    }

    /// Adds the reduction to a frame being encoded; `read_sample` reads it after the submit.
    pub fn encode_sample(&self, enc: &mut wgpu::CommandEncoder) {
        self.metrics.encode(enc);
    }

    pub async fn read_sample(&self) -> FrameMetrics {
        self.metrics.read(&self.gpu.device).await
    }

    /// RMS speed of the free vertices from a sample.
    pub fn vrms(&self, m: &FrameMetrics) -> f32 {
        (2.0 * m.kinetic_energy / self.free_mass().max(1e-12)).sqrt()
    }

    pub fn free_mass(&self) -> f32 {
        let m = self.garment.mesh();
        m.masses(self.garment.fabric.density)
            .iter()
            .zip(&m.pinned)
            .filter(|(_, p)| !**p)
            .map(|(m, _)| m)
            .sum()
    }

    /// The full set: one GPU sample and one position readback, then the CPU checks (exact
    /// penetration, self-intersections, strain, seam gaps). Slow (hundreds of ms); not per frame.
    pub async fn metrics(&self) -> Metrics {
        let sample = self.sample().await;
        let pos = self.read_positions().await;
        self.metrics_at(sample, &pos, None)
    }

    /// `metrics()` on positions already read back, with the previous check for persistence.
    pub fn metrics_at(
        &self,
        sample: FrameMetrics,
        pos: &[Vec3],
        previous: Option<&SelfIntersections>,
    ) -> Metrics {
        let vrms = self.vrms(&sample);
        let c = &self.garment.constraints;
        Metrics {
            frame: self.frame.get(),
            vrms,
            at_rest: sample.non_finite == 0
                && vrms < self.settings.rest_vrms
                && self.time() >= self.settings.schedule.end_s(),
            sample,
            penetration: penetration_check(&self.body, self.settings.thickness, pos),
            self_intersections: selfcheck::check(self.garment.mesh(), &self.weld, pos, previous),
            strain: StrainStats::of(strain::edge_strains(&self.garment, pos)),
            max_seam_gap_mm: (!c.sew.items.is_empty()).then(|| {
                c.sew
                    .items
                    .iter()
                    .map(|s| (pos[s.i as usize] - pos[s.j as usize]).length())
                    .fold(0.0f32, f32::max)
                    * 1000.0
            }),
        }
    }

    /// The weld map (sewn vertices share a representative), for `selfcheck::check`.
    pub fn weld(&self) -> &[u32] {
        &self.weld
    }
}

/// Per triangle: sqrt of the larger eigenvalue of F^T F minus 1, F the deformation gradient
/// from the rest triangle (in its own plane) to the current one.
pub fn triangle_strain(mesh: &ClothMesh, pos: &[Vec3]) -> Vec<f32> {
    mesh.tris
        .iter()
        .map(|t| {
            let [r0, r1, r2] = t.map(|v| mesh.rest[v as usize]);
            let [p0, p1, p2] = t.map(|v| pos[v as usize]);
            let (e1, e2) = (r1 - r0, r2 - r0);
            let l1 = e1.length();
            if l1 < 1e-9 {
                return 0.0;
            }
            let u = e1 / l1;
            let n = e1.cross(e2);
            if n.length() < 1e-12 {
                return 0.0;
            }
            let v = n.cross(u).normalize();
            // Rest edges in the triangle's plane: (l1, 0) and (a, b).
            let (a, b) = (e2.dot(u), e2.dot(v));
            // F maps the rest edges to the current ones: columns f1 = d1 / l1,
            // f2 = (d2 - f1 a) / b.
            let (d1, d2) = (p1 - p0, p2 - p0);
            let f1 = d1 / l1;
            let f2 = (d2 - f1 * a) / b;
            let (cxx, cyy, cxy) = (f1.dot(f1), f2.dot(f2), f1.dot(f2));
            let mean = 0.5 * (cxx + cyy);
            let dev = (0.25 * (cxx - cyy) * (cxx - cyy) + cxy * cxy).sqrt();
            (mean + dev).max(0.0).sqrt() - 1.0
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid_desc() -> GarmentDesc {
        crate::scene::SheetScene {
            grid: 12,
            ..Default::default()
        }
        .garment()
    }

    #[test]
    fn triangle_strain_measures_the_larger_principal_stretch() {
        let m = ClothMesh::grid(8, 1.0, 0.0);
        let rest = m.pos.clone();
        assert!(triangle_strain(&m, &rest).iter().all(|s| s.abs() < 1e-5));
        // Stretch x by 10%, and rotate the whole thing: strain is 0.1 everywhere.
        let stretched: Vec<Vec3> = rest
            .iter()
            .map(|p| glam::Quat::from_rotation_y(0.7) * Vec3::new(p.x * 1.1, p.y, p.z))
            .collect();
        for s in triangle_strain(&m, &stretched) {
            assert!((s - 0.1).abs() < 1e-4, "{s}");
        }
        // Compress: the larger principal stretch is then the unchanged direction (0).
        let squeezed: Vec<Vec3> = rest
            .iter()
            .map(|p| Vec3::new(p.x * 0.9, p.y, p.z))
            .collect();
        assert!(
            triangle_strain(&m, &squeezed)
                .iter()
                .all(|s| s.abs() < 1e-4)
        );
    }

    #[test]
    fn garment_load_validates_sewing_and_builds_constraints() {
        let mut d = grid_desc();
        let g = Garment::load(&d, &Fabric::cotton()).unwrap();
        assert!(g.constraints.stretch.items.len() > 100);
        assert_eq!(g.name(), "sheet");
        d.sew_pairs.push((0, 1_000_000));
        assert!(Garment::load(&d, &Fabric::cotton()).is_err());
    }

    #[test]
    fn sphere_body_has_no_exact_query() {
        let b = Body::sphere(Vec3::ZERO, 0.3);
        assert!(b.query.is_none() && b.sdf().is_none());
        assert!(!b.render.idx.is_empty());
    }
}
