// SPDX-License-Identifier: AGPL-3.0-or-later
//! Headless benchmark. Async so the same code runs natively (pollster) and in wasm.

use glam::Vec3;
use serde::Serialize;
use web_time::Instant;

use crate::{
    engine::{Body, Simulation},
    metrics::{FrameMetrics, RestDetector},
    selfcheck::{self, SelfIntersections},
    sim::SimSettings,
    timer::{self, GpuTimer, PassTime},
};

#[derive(Debug, Clone, Serialize)]
pub struct BenchConfig {
    /// Simulated frames in the serial (measured) run.
    pub frames: u32,
    /// Extra back-to-back frames for the pipelined throughput number.
    pub pipelined_frames: u32,
    /// Include the final positions (f32 xyz, little endian, base64) for cross-target shape
    /// comparison (tools/bench/compare.py).
    pub record_positions: bool,
}

impl Default for BenchConfig {
    fn default() -> Self {
        Self {
            frames: 600,
            pipelined_frames: 300,
            record_positions: false,
        }
    }
}

pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                out.push(T[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub mean: f64,
    pub median: f64,
    pub p95: f64,
    pub max: f64,
}

impl Stats {
    pub fn of(v: &[f64]) -> Self {
        let mut s = v.to_vec();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let q = |f: f64| s[((s.len() - 1) as f64 * f).round() as usize];
        Self {
            mean: s.iter().sum::<f64>() / s.len() as f64,
            median: q(0.5),
            p95: q(0.95),
            max: *s.last().unwrap(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MeshInfo {
    pub vertices: usize,
    pub triangles: usize,
    pub mean_edge_mm: f32,
    pub stretch_constraints: usize,
    pub stretch_colors: usize,
    pub bend_constraints: usize,
    pub bend_colors: usize,
    pub sew_constraints: usize,
    pub sew_colors: usize,
    pub dispatches_per_frame: u32,
    /// Largest single storage binding vs the 128 MiB WebGPU default `maxStorageBufferBindingSize`.
    pub largest_storage_binding_bytes: u64,
    pub total_sim_buffer_bytes: u64,
}

/// Exact (CPU, BVH) signed distance of every cloth vertex to the body mesh, at the end of the
/// serial run. Vertex-only: body features poking through a triangle's interior aren't seen.
#[derive(Debug, Clone, Serialize)]
pub struct Penetration {
    /// max(0, -min signed distance), mm. Plan criterion: < 2 mm.
    pub max_penetration_mm: f32,
    pub vertices_inside: usize,
    /// Vertices closer than the collision thickness (in contact, or slightly inside the shell).
    pub vertices_within_thickness: usize,
    pub worst_vertex: Option<(u32, [f32; 3])>,
    /// SDF-vs-exact disagreement at the same vertices: max |sdf - exact|, mm (within the band).
    pub sdf_error_max_mm: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchResult {
    pub target: &'static str,
    pub scene: String,
    pub gpu_timestamps: bool,
    pub adapter: crate::gpu::AdapterReport,
    pub config: BenchConfig,
    pub scene_params: serde_json::Value,
    pub sim: SimSettings,
    pub mesh: MeshInfo,
    /// Wall time per frame, submit -> GPU done, one frame at a time (no overlap). Conservative.
    pub frame_ms_serial: Stats,
    /// Wall time per frame with frames queued back to back (what an interactive loop gets).
    pub frame_ms_pipelined: f64,
    pub rest_frame: Option<u32>,
    pub rest_sim_s: Option<f64>,
    /// Sum of serial frame times up to the rest frame.
    pub rest_wall_s_serial: Option<f64>,
    /// rest_frame × pipelined frame time.
    pub rest_wall_s_pipelined: Option<f64>,
    pub max_speed: f32,
    pub max_speed_frame: u32,
    /// Max speed from frame 60 (1 s sim) on, i.e. excluding the initial free-fall whip.
    pub max_speed_after_1s: f32,
    /// Max speed once every ramp has finished (sewing closed, full gravity).
    pub max_speed_after_ramps: f32,
    pub max_speed_after_rest: Option<f32>,
    pub non_finite_frames: u32,
    /// Raw plan criterion: any vertex ever at >= 5 m/s.
    pub max_speed_over_5ms: bool,
    /// Non-finite values, or >= 5 m/s after the first second.
    pub exploded: bool,
    pub final_metrics: FrameMetrics,
    /// GPU (SDF-sampled or analytic) min distance at the end, mm.
    pub min_collider_dist_mm_final: f32,
    pub penetration: Option<Penetration>,
    /// Max distance between sewn vertex pairs at the end, mm (seam gap).
    pub max_seam_gap_mm: Option<f32>,
    /// Edge strain at the end of the serial run, (length - rest) / rest: mean, p99, max.
    pub stretch_strain: (f32, f32, f32),
    /// The 5 most stretched edges: (strain, midpoint, group).
    pub most_stretched: Vec<(f32, [f32; 3], String)>,
    /// The full edge-strain distribution at the end of the serial run, by region and panel.
    pub strain: crate::strain::StrainReport,
    /// Per named seam: (name, max gap mm, mean gap mm, position of the max along the seam
    /// as 0..1 from its first edge's start) at the end.
    pub seam_gaps_mm: Vec<(String, f32, f32, f32)>,
    /// Profiling mode only: GPU ms per frame by phase, averaged over sampled frames.
    pub gpu_phase_ms: Vec<PassTime>,
    /// After the serial run: the 10 fastest vertices as (index, speed m/s, group), to locate
    /// jitter hotspots.
    pub final_fastest_vertices: Vec<(u32, f32, String)>,
    /// Every 10th frame: (frame, vrms m/s, max speed m/s, min collider dist m), for plotting.
    pub trace: Vec<(u32, f32, f32, f32)>,
    /// Final positions at the end of the serial run (see `BenchConfig::record_positions`).
    pub final_positions_b64: Option<String>,
    /// Self-collision setup, when enabled.
    pub self_collision: Option<SelfCollisionInfo>,
    /// Cloth self-intersections (CPU check, computed with self-collision on or off) at the
    /// initial placement, at the end of the serial run, and after the pipelined frames;
    /// `persistent_pairs` of the last = pairs present at both of the last two checks.
    pub self_intersections_initial: SelfIntersections,
    pub self_intersections_final: SelfIntersections,
    pub self_intersections_after_pipelined: SelfIntersections,
}

#[derive(Debug, Clone, Serialize)]
pub struct SelfCollisionInfo {
    pub radius_mm: f32,
    pub excluded_pairs: usize,
    pub table_size: u32,
    pub buffer_bytes: u64,
    pub query_radius_mm: f32,
    pub rebuild_every: u32,
    /// Counting-sort and neighbour-list check on the last rebuild (readback).
    pub check: crate::selfcol::SelfCheck,
    /// S4 untangling, if on.
    pub untangle: Option<crate::untangle::UntangleInfo>,
}

/// Exact signed distance of every vertex to the body (CPU, BVH). Benchmark-only.
pub fn penetration_check(body: &Body, thickness: f32, pos: &[Vec3]) -> Option<Penetration> {
    body.query.as_ref().map(|body_query| {
        let band = 0.05;
        let mut min_d = f32::MAX;
        let mut worst = None;
        let (mut inside, mut within) = (0, 0);
        let mut sdf_err: Option<f32> = None;
        for (i, p) in pos.iter().enumerate() {
            let Some(d) = body_query.signed_distance(*p, band) else {
                continue;
            };
            if d < min_d {
                min_d = d;
                worst = Some((i as u32, p.to_array()));
            }
            inside += (d < 0.0) as usize;
            within += (d < thickness) as usize;
            if let crate::sim::Collider::Sdf(sdf) = &body.collider {
                let e = (sdf.sample(*p) - d).abs();
                if d.abs() < sdf.band * 0.9 {
                    sdf_err = Some(sdf_err.unwrap_or(0.0).max(e));
                }
            }
        }
        Penetration {
            max_penetration_mm: (-min_d).max(0.0) * 1000.0,
            vertices_inside: inside,
            vertices_within_thickness: within,
            worst_vertex: worst,
            sdf_error_max_mm: sdf_err.map(|e| e * 1000.0),
        }
    })
}

async fn read_vec4(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    src: &wgpu::Buffer,
    n: u32,
) -> Vec<[f32; 4]> {
    let rb = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("bench-readback"),
        size: n as u64 * 16,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_buffer_to_buffer(src, 0, &rb, 0, n as u64 * 16);
    queue.submit([enc.finish()]);
    crate::gpu_async::read_buffer(device, &rb).await
}

/// Runs the benchmark on a fresh simulation (frame 0): `cfg.frames` serial frames, then
/// `cfg.pipelined_frames` back to back.
pub async fn run(simulation: &Simulation, cfg: BenchConfig) -> BenchResult {
    let gpu = simulation.gpu_handle();
    let (device, queue) = (&gpu.device, &gpu.queue);
    let garment = simulation.garment().clone();
    let body = simulation.body().clone();
    let sim = *simulation.settings();
    let mut timer = GpuTimer::new(
        device,
        queue,
        simulation.solver().profiled_passes_per_frame(),
    );
    let mut rest = RestDetector::new(sim.rest_vrms, sim.rest_window, simulation.free_mass());
    let ramps_end_frame = (sim.schedule.end_s() / sim.frame_dt).ceil() as u32;
    rest.earliest_frame = ramps_end_frame;

    let c = &garment.constraints;
    let mesh = MeshInfo {
        vertices: garment.mesh().n_verts(),
        triangles: garment.mesh().tris.len(),
        mean_edge_mm: garment.mesh().mean_edge_length() * 1000.0,
        stretch_constraints: c.stretch.items.len(),
        stretch_colors: c.stretch.n_colors(),
        bend_constraints: c.bend.items.len(),
        bend_colors: c.bend.n_colors(),
        sew_constraints: c.sew.items.len(),
        sew_colors: c.sew.n_colors(),
        dispatches_per_frame: simulation.solver().dispatches_per_frame(),
        largest_storage_binding_bytes: [
            garment.mesh().n_verts() as u64 * 16,
            (c.stretch.items.len() + c.sew.items.len()) as u64 * 16,
            c.bend.items.len() as u64 * 48,
            simulation.solver().sdf_buf.size(),
            simulation
                .solver()
                .self_collision
                .as_ref()
                .map_or(0, |sc| sc.buffer_bytes),
        ]
        .into_iter()
        .max()
        .unwrap(),
        total_sim_buffer_bytes: garment.mesh().n_verts() as u64 * 48
            + (c.stretch.items.len() + c.sew.items.len()) as u64 * 16
            + c.bend.items.len() as u64 * 48
            + simulation.solver().sdf_buf.size()
            + simulation
                .solver()
                .self_collision
                .as_ref()
                .map_or(0, |sc| sc.buffer_bytes),
    };
    log::info!("bench mesh: {mesh:?}");

    // Warm-up: pipeline creation and first-use costs must not land in frame 0.
    simulation.warm_up().await;

    let mut frame_ms = Vec::with_capacity(cfg.frames as usize);
    let mut max_speed = 0.0f32;
    let mut max_speed_frame = 0u32;
    let mut max_speed_after_1s = 0.0f32;
    let mut max_speed_after_ramps = 0.0f32;
    let mut max_after_rest: Option<f32> = None;
    let mut non_finite_frames = 0;
    let mut last = FrameMetrics::default();
    let mut phase_sum: Vec<PassTime> = Vec::new();
    let mut phase_samples = 0u32;
    let mut trace = Vec::new();

    for f in 0..cfg.frames {
        // Sim only, timed on its own.
        let t0 = Instant::now();
        let mut enc = device.create_command_encoder(&Default::default());
        timer.begin_frame();
        simulation.encode_step(&mut enc, Some(&mut timer));
        timer.resolve(&mut enc);
        queue.submit([enc.finish()]);
        simulation.wait().await;
        frame_ms.push(t0.elapsed().as_secs_f64() * 1000.0);

        // Every 5th frame: odd and even frames alike, since some phases (S4's full untangling
        // check) run every other frame. Merged by label, as not every frame has every phase.
        if timer.enabled() && f % 5 == 0 {
            phase_sum.extend(timer.read(device).await);
            phase_sum = timer::sum_by_label(&phase_sum);
            phase_samples += 1;
        }

        // Sampled metrics (every frame in the bench), outside the timed region.
        let m = simulation.sample().await;
        if m.non_finite > 0 {
            non_finite_frames += 1;
        }
        if f >= 60 {
            max_speed_after_1s = max_speed_after_1s.max(m.max_speed);
        }
        if f >= ramps_end_frame {
            max_speed_after_ramps = max_speed_after_ramps.max(m.max_speed);
        }
        if m.max_speed > max_speed {
            max_speed = m.max_speed;
            max_speed_frame = f;
        }
        rest.push(f, &m);
        if let Some(r) = rest.rest_frame
            && f >= r
        {
            max_after_rest = Some(max_after_rest.unwrap_or(0.0).max(m.max_speed));
        }
        if f % 10 == 0 {
            trace.push((f, rest.vrms(&m), m.max_speed, m.min_collider_dist));
        }
        last = m;
    }

    // Benchmark-only readbacks of whole buffers, once.
    let vel = read_vec4(
        device,
        queue,
        &simulation.solver().vel,
        simulation.n_verts(),
    )
    .await;
    let group_of = |v: u32| {
        garment
            .desc
            .groups
            .iter()
            .find(|(_, r)| r.contains(&v))
            .map(|(n, _)| n.clone())
            .unwrap_or_default()
    };
    let final_fastest_vertices: Vec<(u32, f32, String)> = {
        let mut s: Vec<(u32, f32)> = vel
            .iter()
            .enumerate()
            .map(|(i, v)| (i as u32, Vec3::new(v[0], v[1], v[2]).length()))
            .collect();
        s.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        s.truncate(10);
        s.into_iter().map(|(i, v)| (i, v, group_of(i))).collect()
    };
    // Debug: DRAPE_DEBUG_ATTRIB=1 replays one more frame phase by phase for the fastest
    // vertices (which pass keeps them moving at rest), then restores the state.
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("DRAPE_DEBUG_ATTRIB").is_ok() {
        let a = crate::attrib::Attrib::new(device, simulation.solver());
        let mut enc = device.create_command_encoder(&Default::default());
        a.snapshot(&mut enc, simulation.solver());
        queue.submit([enc.finish()]);
        simulation.solver().prepare_frame(queue, cfg.frames);
        let watch: Vec<usize> = final_fastest_vertices
            .iter()
            .map(|v: &(u32, f32, String)| v.0 as usize)
            .collect();
        let sdf = match &body.collider {
            crate::sim::Collider::Sdf(s) => Some(s.as_ref()),
            _ => None,
        };
        a.replay(device, queue, simulation.solver(), sdf, &watch, "rest")
            .await;
        let mut enc = device.create_command_encoder(&Default::default());
        a.restore(&mut enc, simulation.solver());
        queue.submit([enc.finish()]);
    }
    let pos: Vec<Vec3> = read_vec4(
        device,
        queue,
        &simulation.solver().pos,
        simulation.n_verts(),
    )
    .await
    .iter()
    .map(|p| Vec3::new(p[0], p[1], p[2]))
    .collect();
    let stretch_strain = {
        let mut e: Vec<f32> = c
            .stretch
            .items
            .iter()
            .filter(|s| s.rest > 0.0)
            .map(|s| (pos[s.i as usize] - pos[s.j as usize]).length() / s.rest - 1.0)
            .collect();
        e.sort_by(f32::total_cmp);
        let n = e.len().max(1);
        (
            e.iter().sum::<f32>() / n as f32,
            e.get(n * 99 / 100).copied().unwrap_or(0.0),
            e.last().copied().unwrap_or(0.0),
        )
    };
    let most_stretched = {
        let mut e: Vec<(f32, [f32; 3], String)> = c
            .stretch
            .items
            .iter()
            .filter(|s| s.rest > 0.0)
            .map(|s| {
                (
                    (pos[s.i as usize] - pos[s.j as usize]).length() / s.rest - 1.0,
                    ((pos[s.i as usize] + pos[s.j as usize]) * 0.5).to_array(),
                    group_of(s.i),
                )
            })
            .collect();
        e.sort_by(|a, b| b.0.total_cmp(&a.0));
        e.truncate(5);
        e
    };
    let max_seam_gap_mm = (!c.sew.items.is_empty()).then(|| {
        c.sew
            .items
            .iter()
            .map(|s| (pos[s.i as usize] - pos[s.j as usize]).length())
            .fold(0.0f32, f32::max)
            * 1000.0
    });
    let seam_gaps_mm = garment
        .desc
        .seams
        .iter()
        .map(|(name, pairs)| {
            let g: Vec<f32> = pairs
                .iter()
                .map(|&(i, j)| (pos[i as usize] - pos[j as usize]).length() * 1000.0)
                .collect();
            let (kmax, max) = g
                .iter()
                .enumerate()
                .fold((0, 0.0f32), |a, (k, &v)| if v > a.1 { (k, v) } else { a });
            (
                name.clone(),
                max,
                g.iter().sum::<f32>() / g.len().max(1) as f32,
                kmax as f32 / (g.len().max(2) - 1) as f32,
            )
        })
        .collect();
    let penetration = penetration_check(&body, sim.thickness, &pos);

    // Pipelined throughput: queue frames back to back, wait once. Continues from the rested
    // state with the end-of-schedule parameters.
    let t0 = Instant::now();
    simulation.step(cfg.pipelined_frames);
    simulation.wait().await;
    let frame_ms_pipelined =
        t0.elapsed().as_secs_f64() * 1000.0 / cfg.pipelined_frames.max(1) as f64;

    let pos_after: Vec<Vec3> = read_vec4(
        device,
        queue,
        &simulation.solver().pos,
        simulation.n_verts(),
    )
    .await
    .iter()
    .map(|p| Vec3::new(p[0], p[1], p[2]))
    .collect();
    let weld = selfcheck::weld_map(garment.mesh().n_verts(), c);
    let self_intersections_initial =
        selfcheck::check(garment.mesh(), &weld, &garment.mesh().pos, None);
    let self_intersections_final = selfcheck::check(garment.mesh(), &weld, &pos, None);
    let self_intersections_after_pipelined = selfcheck::check(
        garment.mesh(),
        &weld,
        &pos_after,
        Some(&self_intersections_final),
    );
    let self_collision = match &simulation.solver().self_collision {
        Some(sc) => Some(SelfCollisionInfo {
            radius_mm: sc.radius * 1000.0,
            excluded_pairs: sc.excluded_pairs,
            table_size: sc.table_size,
            buffer_bytes: sc.buffer_bytes,
            query_radius_mm: sc.query_radius * 1000.0,
            rebuild_every: sim.self_rebuild_every,
            check: sc.verify(device, queue).await,
            untangle: match &simulation.solver().untangle {
                Some(u) => {
                    let (gpu_pairs_last, tangled_vertices_last) =
                        u.last_detection(device, queue).await;
                    Some(crate::untangle::UntangleInfo {
                        every: sim.untangle_every,
                        check_every: sim.untangle_check_every,
                        step_mm: u.step * 1000.0,
                        cell_mm: u.cell * 1000.0,
                        table_size: u.table_size,
                        buffer_bytes: u.buffer_bytes,
                        gpu_pairs_last,
                        tangled_vertices_last,
                    })
                }
                None => None,
            },
        }),
        None => None,
    };

    for p in &mut phase_sum {
        p.ms /= phase_samples.max(1) as f64;
    }
    let rest_frame = rest.rest_frame;
    let dt = sim.frame_dt as f64;
    BenchResult {
        target: if cfg!(target_arch = "wasm32") {
            "web"
        } else {
            "native"
        },
        scene: garment.desc.name.clone(),
        gpu_timestamps: timer.enabled(),
        adapter: gpu.report.clone(),
        scene_params: garment.desc.description.clone(),
        sim,
        mesh,
        frame_ms_serial: Stats::of(&frame_ms),
        frame_ms_pipelined,
        rest_frame,
        rest_sim_s: rest_frame.map(|r| r as f64 * dt),
        rest_wall_s_serial: rest_frame.map(|r| frame_ms[..r as usize].iter().sum::<f64>() / 1000.0),
        rest_wall_s_pipelined: rest_frame.map(|r| r as f64 * frame_ms_pipelined / 1000.0),
        max_speed,
        max_speed_frame,
        max_speed_after_1s,
        max_speed_after_ramps,
        max_speed_after_rest: max_after_rest,
        non_finite_frames,
        max_speed_over_5ms: max_speed >= 5.0,
        exploded: non_finite_frames > 0 || max_speed_after_1s >= 5.0,
        final_metrics: last,
        min_collider_dist_mm_final: last.min_collider_dist * 1000.0,
        penetration,
        max_seam_gap_mm,
        stretch_strain,
        most_stretched,
        strain: crate::strain::report(&garment, &body, sim.thickness, &pos),
        seam_gaps_mm,
        gpu_phase_ms: phase_sum,
        final_fastest_vertices,
        trace,
        final_positions_b64: cfg.record_positions.then(|| {
            let flat: Vec<f32> = pos.iter().flat_map(|p| p.to_array()).collect();
            base64(bytemuck::cast_slice(&flat))
        }),
        config: cfg,
        self_collision,
        self_intersections_initial,
        self_intersections_final,
        self_intersections_after_pipelined,
    }
}
