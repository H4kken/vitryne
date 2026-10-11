//! Headless benchmark. Async so the same code runs natively (pollster) and in wasm (M3).

use serde::Serialize;
use web_time::Instant;

use crate::{
    gpu::Gpu,
    metrics::{FrameMetrics, GpuMetrics, RestDetector},
    scene::SheetScene,
    sim::{SimConfig, Solver},
    timer::{self, GpuTimer, PassTime},
};

#[derive(Debug, Clone, Serialize)]
pub struct BenchConfig {
    pub scene: SheetScene,
    pub sim: SimConfig,
    /// Simulated frames in the serial (measured) run.
    pub frames: u32,
    /// Extra back-to-back frames for the pipelined throughput number.
    pub pipelined_frames: u32,
    pub rest_vrms: f32,
    pub rest_window: u32,
}

impl Default for BenchConfig {
    fn default() -> Self {
        Self { scene: SheetScene::default(), sim: SheetScene::config(), frames: 600, pipelined_frames: 300, rest_vrms: 0.005, rest_window: 30 }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub mean: f64,
    pub median: f64,
    pub p95: f64,
    pub max: f64,
}

impl Stats {
    fn of(v: &[f64]) -> Self {
        let mut s = v.to_vec();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let q = |f: f64| s[((s.len() - 1) as f64 * f).round() as usize];
        Self { mean: s.iter().sum::<f64>() / s.len() as f64, median: q(0.5), p95: q(0.95), max: *s.last().unwrap() }
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
    pub dispatches_per_frame: u32,
    /// Largest single storage binding vs the 128 MiB WebGPU default `maxStorageBufferBindingSize`.
    pub largest_storage_binding_bytes: u64,
    pub total_sim_buffer_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchResult {
    pub target: &'static str,
    pub gpu_timestamps: bool,
    pub adapter: crate::gpu::AdapterReport,
    pub config: BenchConfig,
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
    pub max_speed_after_rest: Option<f32>,
    pub non_finite_frames: u32,
    /// Raw plan criterion: any vertex ever at >= 5 m/s (includes the free-fall whip).
    pub max_speed_over_5ms: bool,
    /// Non-finite values, or >= 5 m/s after the first second.
    pub exploded: bool,
    pub final_metrics: FrameMetrics,
    pub min_sphere_dist_mm_final: f32,
    /// Profiling mode only: GPU ms per frame by phase, averaged over sampled frames.
    pub gpu_phase_ms: Vec<PassTime>,
    /// After the serial run: the 10 fastest vertices as (index, speed m/s), to locate jitter hotspots.
    pub final_fastest_vertices: Vec<(u32, f32)>,
    /// Every 10th frame: (frame, vrms m/s, max speed m/s), for plotting.
    pub trace: Vec<(u32, f32, f32)>,
}

pub async fn run(gpu: &Gpu, cfg: BenchConfig) -> BenchResult {
    let (device, queue) = (&gpu.device, &gpu.queue);
    let built = cfg.scene.build();
    let solver = Solver::new(device, &built.mesh, &built.constraints, built.material.density, cfg.sim, built.sphere);
    let metrics = GpuMetrics::new(device, &solver);
    let mut timer = GpuTimer::new(device, queue, solver.profiled_passes_per_frame());
    let mut rest = RestDetector::new(cfg.rest_vrms, cfg.rest_window, Solver::total_free_mass(&built.mesh, built.material.density));

    let mesh = MeshInfo {
        vertices: built.mesh.n_verts(),
        triangles: built.mesh.tris.len(),
        mean_edge_mm: built.mesh.mean_edge_length() * 1000.0,
        stretch_constraints: built.constraints.stretch.items.len(),
        stretch_colors: built.constraints.stretch.n_colors(),
        bend_constraints: built.constraints.bend.items.len(),
        bend_colors: built.constraints.bend.n_colors(),
        dispatches_per_frame: solver.dispatches_per_frame(),
        largest_storage_binding_bytes: [
            built.mesh.n_verts() as u64 * 16,
            built.constraints.stretch.items.len() as u64 * 16,
            built.constraints.bend.items.len() as u64 * 48,
        ]
        .into_iter()
        .max()
        .unwrap(),
        total_sim_buffer_bytes: built.mesh.n_verts() as u64 * 48
            + built.constraints.stretch.items.len() as u64 * 16
            + built.constraints.bend.items.len() as u64 * 48,
    };
    log::info!("bench mesh: {mesh:?}");

    // Warm-up: pipeline creation and first-use costs must not land in frame 0.
    {
        let mut enc = device.create_command_encoder(&Default::default());
        solver.encode_frame(&mut enc, None);
        queue.submit([enc.finish()]);
        crate::gpu_async::work_done(device, queue).await;
        solver.reset(queue);
    }

    let mut frame_ms = Vec::with_capacity(cfg.frames as usize);
    let mut max_speed = 0.0f32;
    let mut max_speed_frame = 0u32;
    let mut max_speed_after_1s = 0.0f32;
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
        solver.encode_frame(&mut enc, Some(&mut timer));
        timer.resolve(&mut enc);
        queue.submit([enc.finish()]);
        crate::gpu_async::work_done(device, queue).await;
        frame_ms.push(t0.elapsed().as_secs_f64() * 1000.0);

        if timer.enabled() && f % 10 == 0 {
            let t = timer::sum_by_label(&timer.read(device).await);
            if phase_sum.is_empty() {
                phase_sum = t;
            } else {
                for (a, b) in phase_sum.iter_mut().zip(&t) {
                    a.ms += b.ms;
                }
            }
            phase_samples += 1;
        }

        // Sampled metrics (every frame in the bench), outside the timed region.
        let mut enc = device.create_command_encoder(&Default::default());
        metrics.encode(&mut enc);
        queue.submit([enc.finish()]);
        let m = metrics.read(device).await;
        if m.non_finite > 0 {
            non_finite_frames += 1;
        }
        if f >= 60 {
            max_speed_after_1s = max_speed_after_1s.max(m.max_speed);
        }
        if m.max_speed > max_speed {
            max_speed = m.max_speed;
            max_speed_frame = f;
        }
        rest.push(f, &m);
        if let Some(r) = rest.rest_frame {
            if f >= r {
                max_after_rest = Some(max_after_rest.unwrap_or(0.0).max(m.max_speed));
            }
        }
        if f % 10 == 0 {
            trace.push((f, rest.vrms(&m), m.max_speed));
        }
        last = m;
    }

    // Benchmark-only readback of the whole velocity buffer, once.
    let final_fastest_vertices = {
        let rb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("vel-readback"),
            size: solver.n_verts as u64 * 16,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(&solver.vel, 0, &rb, 0, solver.n_verts as u64 * 16);
        queue.submit([enc.finish()]);
        let v: Vec<[f32; 4]> = crate::gpu_async::read_buffer(device, &rb).await;
        let mut s: Vec<(u32, f32)> = v.iter().enumerate().map(|(i, v)| (i as u32, (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt())).collect();
        s.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        s.truncate(10);
        s
    };

    // Pipelined throughput: queue frames back to back, wait once.
    let t0 = Instant::now();
    for _ in 0..cfg.pipelined_frames {
        let mut enc = device.create_command_encoder(&Default::default());
        solver.encode_frame(&mut enc, None);
        queue.submit([enc.finish()]);
    }
    crate::gpu_async::work_done(device, queue).await;
    let frame_ms_pipelined = t0.elapsed().as_secs_f64() * 1000.0 / cfg.pipelined_frames.max(1) as f64;

    for p in &mut phase_sum {
        p.ms /= phase_samples.max(1) as f64;
    }
    let rest_frame = rest.rest_frame;
    let dt = cfg.sim.frame_dt as f64;
    BenchResult {
        target: if cfg!(target_arch = "wasm32") { "web" } else { "native" },
        gpu_timestamps: timer.enabled(),
        adapter: gpu.report.clone(),
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
        max_speed_after_rest: max_after_rest,
        non_finite_frames,
        max_speed_over_5ms: max_speed >= 5.0,
        exploded: non_finite_frames > 0 || max_speed_after_1s >= 5.0,
        final_metrics: last,
        min_sphere_dist_mm_final: last.min_sphere_dist * 1000.0,
        gpu_phase_ms: phase_sum,
        final_fastest_vertices,
        trace,
        config: cfg,
    }
}
