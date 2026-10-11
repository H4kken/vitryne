//! Stability test from the plan: "60 s of simulation, random drags: no NaN, no explosion
//! (max vertex speed < 5 m/s)". The cloth first drapes to rest, then a scripted sequence of
//! random drags runs. The script is a fixed-seed RNG, so native and every browser replay the
//! same drags (vertex, direction, distance, timing).

use glam::Vec3;
use serde::Serialize;
use web_time::Instant;

use crate::{
    bench::{Penetration, Stats, penetration_check},
    gpu::Gpu,
    metrics::GpuMetrics,
    scene::Built,
    sim::{DRAG_RADIUS, DragPatch, SimConfig, Solver},
};

#[derive(Debug, Clone, Serialize)]
pub struct DragBenchConfig {
    /// Undisturbed drape before the drags start, s.
    pub settle_s: f32,
    /// Duration of the random-drag phase, s.
    pub drag_s: f32,
    pub seed: u64,
    /// Each drag pulls its vertex this far, at most (m)...
    pub max_offset: f32,
    /// ...over this long, at least (s). 0.25 m in 0.3 s ≈ 0.8 m/s of hand motion.
    pub min_pull_s: f32,
}

impl Default for DragBenchConfig {
    fn default() -> Self {
        Self { settle_s: 4.0, drag_s: 60.0, seed: 1, max_offset: 0.25, min_pull_s: 0.3 }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DragEpisode {
    pub start_frame: u32,
    pub vertex: u32,
    pub offset: [f32; 3],
    pub pull_frames: u32,
    pub hold_frames: u32,
    /// Max speed of any vertex during this episode (pull + hold + pause), m/s.
    pub max_speed: f32,
    /// GPU-sampled min collider distance during this episode, mm.
    pub min_collider_dist_mm: f32,
    /// Group (panel) of the dragged vertex.
    pub group: &'static str,
    pub patch_vertices: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DragResult {
    pub target: &'static str,
    pub scene: &'static str,
    pub adapter: crate::gpu::AdapterReport,
    pub config: DragBenchConfig,
    pub sim: SimConfig,
    pub vertices: usize,
    pub frames: u32,
    pub episodes: Vec<DragEpisode>,
    /// Max speed of any vertex during the drag phase.
    pub max_speed: f32,
    pub max_speed_frame: u32,
    pub non_finite_frames: u32,
    /// Plan criterion: NaN/inf, or any vertex at >= 5 m/s during the drag phase.
    pub exploded: bool,
    /// How bad an over-5 m/s event is: frames with any vertex >= 5 m/s, and on those frames the
    /// largest number of vertices >= 5 m/s and >= 2 m/s (benchmark readback on those frames only).
    pub frames_over_5ms: u32,
    pub max_vertices_over_5ms: usize,
    pub max_vertices_over_2ms_at_spike: usize,
    /// GPU-sampled min collider distance over the whole drag phase, mm (negative = inside).
    pub min_collider_dist_mm: f32,
    /// Exact penetration after the last drag and a 3 s settle.
    pub penetration_after: Option<Penetration>,
    pub max_seam_gap_mm_after: Option<f32>,
    /// Sim-only serial frame time during the drag phase, ms.
    pub frame_ms_serial: Stats,
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn f(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
}

pub async fn run(gpu: &Gpu, built: &Built, cfg: DragBenchConfig) -> DragResult {
    let (device, queue) = (&gpu.device, &gpu.queue);
    let sim = built.sim;
    let solver = Solver::new(device, &built.mesh, &built.constraints, built.material.density, sim, built.collider.clone());
    let metrics = GpuMetrics::new(device, &solver);
    let free: Vec<u32> = (0..built.mesh.n_verts() as u32).filter(|&i| !built.mesh.pinned[i as usize]).collect();
    let adj = built.mesh.neighbors();
    let mut rng = Rng(cfg.seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let fps = 1.0 / sim.frame_dt;

    let mut frame = 0u32;
    let step = |frame: u32| {
        solver.prepare_frame(queue, frame);
        let mut enc = device.create_command_encoder(&Default::default());
        solver.encode_frame(&mut enc, None);
        metrics.encode(&mut enc);
        queue.submit([enc.finish()]);
    };

    // Settle: drape to rest, undisturbed. Metrics read only at the end.
    let settle_frames = (cfg.settle_s * fps) as u32;
    for _ in 0..settle_frames {
        step(frame);
        frame += 1;
    }
    crate::gpu_async::work_done(device, queue).await;

    let drag_frames = (cfg.drag_s * fps) as u32;
    let end = frame + drag_frames;
    let (mut max_speed, mut max_speed_frame, mut non_finite_frames) = (0.0f32, 0u32, 0u32);
    let mut min_dist = f32::MAX;
    let mut frame_ms = Vec::new();
    let mut episodes = Vec::new();
    let (mut frames_over_5ms, mut max_vertices_over_5ms, mut max_vertices_over_2ms_at_spike) = (0u32, 0usize, 0usize);
    while frame < end {
        // One episode: pull, hold, release, pause.
        let pos = solver.read_positions(device, queue).await;
        let vertex = free[(rng.next() % free.len() as u64) as usize];
        let dir = loop {
            let d = Vec3::new(rng.f() * 2.0 - 1.0, rng.f() * 2.0 - 1.0, rng.f() * 2.0 - 1.0);
            let l = d.length();
            if l > 0.1 && l <= 1.0 {
                break d / l;
            }
        };
        let offset = dir * (0.05 + rng.f() * (cfg.max_offset - 0.05));
        let pull_frames = ((cfg.min_pull_s + rng.f() * 0.5) * fps) as u32;
        let hold_frames = ((0.2 + rng.f() * 0.6) * fps) as u32;
        let pause_frames = (0.4 * fps) as u32;
        let p0 = pos[vertex as usize];
        let patch = DragPatch::grab(&adj, &pos, vertex, DRAG_RADIUS);
        solver.begin_drag(queue, &patch);
        let group = built.groups.iter().find(|(_, r)| r.contains(&vertex)).map(|(n, _)| *n).unwrap_or("");
        let mut ep = DragEpisode {
            start_frame: frame,
            vertex,
            offset: offset.to_array(),
            pull_frames,
            hold_frames,
            max_speed: 0.0,
            min_collider_dist_mm: f32::MAX,
            group,
            patch_vertices: patch.vertices.len(),
        };
        for k in 0..pull_frames + hold_frames + pause_frames {
            if frame >= end {
                break;
            }
            if k < pull_frames + hold_frames {
                let u = ((k + 1) as f32 / pull_frames as f32).min(1.0);
                solver.set_drag_target(p0 + offset * u);
            } else {
                solver.end_drag();
            }
            let t0 = Instant::now();
            solver.prepare_frame(queue, frame);
            let mut enc = device.create_command_encoder(&Default::default());
            solver.encode_frame(&mut enc, None);
            queue.submit([enc.finish()]);
            crate::gpu_async::work_done(device, queue).await;
            frame_ms.push(t0.elapsed().as_secs_f64() * 1000.0);
            let mut enc = device.create_command_encoder(&Default::default());
            metrics.encode(&mut enc);
            queue.submit([enc.finish()]);
            let m = metrics.read(device).await;
            non_finite_frames += (m.non_finite > 0) as u32;
            if m.max_speed > max_speed {
                max_speed = m.max_speed;
                max_speed_frame = frame;
            }
            ep.max_speed = ep.max_speed.max(m.max_speed);
            min_dist = min_dist.min(m.min_collider_dist);
            ep.min_collider_dist_mm = ep.min_collider_dist_mm.min(m.min_collider_dist * 1000.0);
            if m.max_speed >= 5.0 {
                frames_over_5ms += 1;
                let rb = device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("vel-readback"),
                    size: solver.n_verts as u64 * 16,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                let mut e = device.create_command_encoder(&Default::default());
                e.copy_buffer_to_buffer(&solver.vel, 0, &rb, 0, solver.n_verts as u64 * 16);
                queue.submit([e.finish()]);
                let v: Vec<[f32; 4]> = crate::gpu_async::read_buffer(device, &rb).await;
                let sp = |t: f32| v.iter().filter(|v| Vec3::new(v[0], v[1], v[2]).length() >= t).count();
                let n5 = sp(5.0);
                if n5 > max_vertices_over_5ms {
                    max_vertices_over_5ms = n5;
                    max_vertices_over_2ms_at_spike = sp(2.0);
                }
            }
            // Debug: DRAPE_DEBUG_EPISODE=N dumps the fastest vertex every frame of episode N.
            #[cfg(not(target_arch = "wasm32"))]
            if std::env::var("DRAPE_DEBUG_EPISODE").ok().and_then(|v| v.parse::<usize>().ok()) == Some(episodes.len()) && m.max_speed > 1.5 {
                let p = solver.read_positions(device, queue).await;
                let prevp: Vec<[f32; 4]> = {
                    let rb = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: solver.n_verts as u64 * 16, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
                    let mut e = device.create_command_encoder(&Default::default());
                    e.copy_buffer_to_buffer(&solver.vel, 0, &rb, 0, solver.n_verts as u64 * 16);
                    queue.submit([e.finish()]);
                    crate::gpu_async::read_buffer(device, &rb).await
                };
                let (fi, fv) = prevp.iter().enumerate().map(|(i, v)| (i, Vec3::new(v[0], v[1], v[2]).length())).fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
                let over: Vec<usize> = prevp.iter().enumerate().filter(|(_, v)| Vec3::new(v[0], v[1], v[2]).length() > 5.0).map(|(i, _)| i).collect();
                let over2 = prevp.iter().filter(|v| Vec3::new(v[0], v[1], v[2]).length() > 2.0).count();
                eprintln!("  >5 m/s: {} verts {:?}; >2 m/s: {} verts", over.len(), &over[..over.len().min(8)], over2);
                let g = built.groups.iter().find(|(_, r)| r.contains(&(fi as u32))).map(|(n, _)| *n).unwrap_or("");
                let in_patch = patch.vertices.iter().any(|(v, _)| *v as usize == fi);
                let seam = built.seams.iter().find(|(_, ps)| ps.iter().any(|&(a, b)| a as usize == fi || b as usize == fi)).map(|(n, _)| *n);
                eprintln!("ep {} k={k} frame {frame}: fastest v{fi} ({g}, in_patch={in_patch}, seam={seam:?}) {fv:.2} m/s at {:?}, dist to patch {:.3} m, edge? {}",
                    episodes.len(), p[fi], (p[fi] - Vec3::from(patch.center)).length(), built.mesh.neighbors()[fi].len() < 6);
            }
            frame += 1;
        }
        episodes.push(ep);
    }
    solver.end_drag();

    // Settle 3 s, then the exact checks.
    for _ in 0..(3.0 * fps) as u32 {
        step(frame);
        frame += 1;
    }
    let pos = solver.read_positions(device, queue).await;
    let c = &built.constraints;
    let max_seam_gap_mm_after =
        (!c.sew.items.is_empty()).then(|| c.sew.items.iter().map(|s| (pos[s.i as usize] - pos[s.j as usize]).length()).fold(0.0f32, f32::max) * 1000.0);

    DragResult {
        target: if cfg!(target_arch = "wasm32") { "web" } else { "native" },
        scene: built.name,
        adapter: gpu.report.clone(),
        sim,
        vertices: built.mesh.n_verts(),
        frames: frame,
        max_speed,
        max_speed_frame,
        non_finite_frames,
        exploded: non_finite_frames > 0 || max_speed >= 5.0,
        frames_over_5ms,
        max_vertices_over_5ms,
        max_vertices_over_2ms_at_spike,
        min_collider_dist_mm: min_dist * 1000.0,
        penetration_after: penetration_check(built, &pos),
        max_seam_gap_mm_after,
        frame_ms_serial: Stats::of(&frame_ms),
        episodes,
        config: cfg,
    }
}
