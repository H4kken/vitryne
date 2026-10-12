// SPDX-License-Identifier: AGPL-3.0-or-later
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
    selfcheck::{self, SelfIntersections},
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
        Self {
            settle_s: 4.0,
            drag_s: 60.0,
            seed: 1,
            max_offset: 0.25,
            min_pull_s: 0.3,
        }
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
    pub group: String,
    pub patch_vertices: usize,
    /// Self-intersecting triangle pairs when the episode starts (after the previous one's
    /// pause), CPU check on the readback used for picking.
    pub self_intersections_at_start: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DragResult {
    pub target: &'static str,
    pub scene: String,
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
    /// Longest run of consecutive frames with a vertex >= 5 m/s (S3 criterion: at most 3).
    pub max_consecutive_frames_over_5ms: u32,
    /// Max seam gap at rest, before the first drag, mm (S3 criterion: after <= before + 5).
    pub max_seam_gap_mm_before: Option<f32>,
    /// The S3 drag-test criterion (docs/history/SPIKE2_PLAN.md): no NaN, nothing >= 20 m/s, no run of more
    /// than 3 frames >= 5 m/s, and after the test < 2 mm penetration and no seam torn open.
    pub stable: bool,
    /// GPU-sampled min collider distance over the whole drag phase, mm (negative = inside).
    pub min_collider_dist_mm: f32,
    /// Exact penetration after the last drag and a 3 s settle.
    pub penetration_after: Option<Penetration>,
    pub max_seam_gap_mm_after: Option<f32>,
    /// Episodes that started with any self-intersection, and the worst count.
    pub episodes_starting_intersected: usize,
    pub max_self_intersections_at_episode_start: usize,
    /// Self-intersections 2 s and 3 s after the last drag; `persistent_pairs` of the second =
    /// pairs present at both.
    pub self_intersections_after_2s: SelfIntersections,
    pub self_intersections_after: SelfIntersections,
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
    let solver = Solver::new(
        device,
        &built.mesh,
        &built.constraints,
        built.material.density,
        sim,
        built.collider.clone(),
    );
    let metrics = GpuMetrics::new(device, &solver);
    let free: Vec<u32> = (0..built.mesh.n_verts() as u32)
        .filter(|&i| !built.mesh.pinned[i as usize])
        .collect();
    let adj = built.mesh.neighbors();
    let weld = selfcheck::weld_map(built.mesh.n_verts(), &built.constraints);
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
    let seam_gap = |pos: &[Vec3]| {
        let c = &built.constraints;
        (!c.sew.items.is_empty()).then(|| {
            c.sew
                .items
                .iter()
                .map(|s| (pos[s.i as usize] - pos[s.j as usize]).length())
                .fold(0.0f32, f32::max)
                * 1000.0
        })
    };
    let max_seam_gap_mm_before = seam_gap(&solver.read_positions(device, queue).await);

    let drag_frames = (cfg.drag_s * fps) as u32;
    let end = frame + drag_frames;
    let (mut max_speed, mut max_speed_frame, mut non_finite_frames) = (0.0f32, 0u32, 0u32);
    let mut min_dist = f32::MAX;
    let mut frame_ms = Vec::new();
    let mut episodes = Vec::new();
    #[cfg(not(target_arch = "wasm32"))]
    let attrib = std::env::var("DRAPE_DEBUG_ATTRIB")
        .is_ok()
        .then(|| crate::attrib::Attrib::new(device, &solver));
    let (mut run_over_5ms, mut max_consecutive_frames_over_5ms) = (0u32, 0u32);
    let (mut frames_over_5ms, mut max_vertices_over_5ms, mut max_vertices_over_2ms_at_spike) =
        (0u32, 0usize, 0usize);
    while frame < end {
        // One episode: pull, hold, release, pause.
        let pos = solver.read_positions(device, queue).await;
        let vertex = free[(rng.next() % free.len() as u64) as usize];
        let dir = loop {
            let d = Vec3::new(
                rng.f() * 2.0 - 1.0,
                rng.f() * 2.0 - 1.0,
                rng.f() * 2.0 - 1.0,
            );
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
        let group = built
            .groups
            .iter()
            .find(|(_, r)| r.contains(&vertex))
            .map(|(n, _)| n.as_str())
            .unwrap_or("");
        let mut ep = DragEpisode {
            start_frame: frame,
            vertex,
            offset: offset.to_array(),
            pull_frames,
            hold_frames,
            max_speed: 0.0,
            min_collider_dist_mm: f32::MAX,
            group: group.to_string(),
            patch_vertices: patch.vertices.len(),
            self_intersections_at_start: 0,
        };
        let si = selfcheck::check(&built.mesh, &weld, &pos, None);
        ep.self_intersections_at_start = si.pairs;
        #[cfg(not(target_arch = "wasm32"))]
        if si.pairs > 0 && std::env::var("DRAPE_DEBUG_SELF").is_ok() {
            let g = |t: u32| {
                let v = built.mesh.tris[t as usize][0];
                built
                    .groups
                    .iter()
                    .find(|(_, r)| r.contains(&v))
                    .map(|(n, _)| n.as_str())
                    .unwrap_or("")
            };
            let mut by: std::collections::BTreeMap<(&str, &str), usize> = Default::default();
            for &(a, b) in &si.pair_set {
                let (ga, gb) = (g(a), g(b));
                *by.entry((ga.min(gb), ga.max(gb))).or_default() += 1;
            }
            let prev = episodes
                .last()
                .map(|e: &DragEpisode| (e.vertex, e.group.clone(), e.offset));
            // Pinched against the body? Body distance of the intersecting triangles' vertices.
            if let crate::sim::Collider::Sdf(sdf) = &built.collider {
                let mut d: Vec<f32> = si
                    .pair_set
                    .iter()
                    .flat_map(|&(a, b)| [a, b])
                    .flat_map(|t| built.mesh.tris[t as usize])
                    .map(|v| sdf.sample(pos[v as usize]) * 1000.0)
                    .collect();
                d.sort_by(|a, b| a.partial_cmp(b).unwrap());
                eprintln!(
                    "  body distance of involved vertices, mm: min {:.1} median {:.1} max {:.1}",
                    d[0],
                    d[d.len() / 2],
                    d[d.len() - 1]
                );
            }
            eprintln!(
                "episode {} starts with {} pairs {:?}; previous drag {:?}; sample {:?}",
                episodes.len(),
                si.pairs,
                by,
                prev,
                &si.sample[..si.sample.len().min(3)]
            );
        }
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
            #[cfg(not(target_arch = "wasm32"))]
            if let Some(a) = &attrib {
                a.snapshot(&mut enc, &solver);
            }
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
            run_over_5ms = if m.max_speed >= 5.0 {
                run_over_5ms + 1
            } else {
                0
            };
            max_consecutive_frames_over_5ms = max_consecutive_frames_over_5ms.max(run_over_5ms);
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
                let sp = |t: f32| {
                    v.iter()
                        .filter(|v| Vec3::new(v[0], v[1], v[2]).length() >= t)
                        .count()
                };
                #[cfg(not(target_arch = "wasm32"))]
                if std::env::var("DRAPE_DEBUG_SPIKE").is_ok() {
                    let p = solver.read_positions(device, queue).await;
                    let (fi, fv) = v
                        .iter()
                        .enumerate()
                        .map(|(i, v)| (i, Vec3::new(v[0], v[1], v[2]).length()))
                        .fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
                    let g = built
                        .groups
                        .iter()
                        .find(|(_, r)| r.contains(&(fi as u32)))
                        .map(|(n, _)| n.as_str())
                        .unwrap_or("");
                    let body = match &built.collider {
                        crate::sim::Collider::Sdf(sdf) => sdf.sample(p[fi]) * 1000.0,
                        _ => 0.0,
                    };
                    let close = p
                        .iter()
                        .enumerate()
                        .filter(|(j, q)| {
                            *j != fi
                                && (**q - p[fi]).length() < 0.007
                                && !adj[fi].contains(&(*j as u32))
                        })
                        .count();
                    let in_patch = patch.vertices.iter().any(|(pv, _)| *pv as usize == fi);
                    if let Some(sc) = &solver.self_collision {
                        let ex = crate::selfcol::exclusion_lists(
                            &built.mesh,
                            &built.constraints,
                            sc.radius * sim.self_exclude_radii,
                        );
                        let (a, b) = (ex[fi] as usize, ex[fi + 1] as usize);
                        let near: Vec<(usize, f32, bool)> = p
                            .iter()
                            .enumerate()
                            .filter(|(j, q)| *j != fi && (**q - p[fi]).length() < sc.query_radius)
                            .map(|(j, q)| {
                                (
                                    j,
                                    (*q - p[fi]).length() * 1000.0,
                                    ex[a..b].contains(&(j as u32)),
                                )
                            })
                            .collect();
                        eprintln!("   within query radius (j, mm, excluded): {near:?}");
                    }
                    eprintln!(
                        "spike ep {} k={k}: v{fi} {g} {fv:.1} m/s, body {body:.1} mm, {close} non-adjacent verts within 7 mm, in_patch {in_patch}, n>5 {}",
                        episodes.len(),
                        sp(5.0)
                    );
                }
                #[cfg(not(target_arch = "wasm32"))]
                if let Some(a) = &attrib {
                    let mut w: Vec<(usize, f32)> = v
                        .iter()
                        .enumerate()
                        .map(|(i, v)| (i, Vec3::new(v[0], v[1], v[2]).length()))
                        .filter(|x| x.1 >= 5.0)
                        .collect();
                    w.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                    let watch: Vec<usize> = w.iter().map(|x| x.0).collect();
                    let sdf = match &built.collider {
                        crate::sim::Collider::Sdf(s) => Some(s.as_ref()),
                        _ => None,
                    };
                    let g = built
                        .groups
                        .iter()
                        .find(|(_, r)| r.contains(&(watch[0] as u32)))
                        .map(|(n, _)| n.as_str())
                        .unwrap_or("");
                    let in_patch = patch
                        .vertices
                        .iter()
                        .any(|(pv, _)| *pv as usize == watch[0]);
                    let tag = format!(
                        "ep {} k={k} frame {frame} {g} in_patch={in_patch} drag={}",
                        episodes.len(),
                        k < pull_frames + hold_frames
                    );
                    a.replay(device, queue, &solver, sdf, &watch, &tag).await;
                }
                let n5 = sp(5.0);
                if n5 > max_vertices_over_5ms {
                    max_vertices_over_5ms = n5;
                    max_vertices_over_2ms_at_spike = sp(2.0);
                }
            }
            // Debug: DRAPE_DEBUG_EPISODE=N dumps the fastest vertex every frame of episode N.
            #[cfg(not(target_arch = "wasm32"))]
            if std::env::var("DRAPE_DEBUG_EPISODE")
                .ok()
                .and_then(|v| v.parse::<usize>().ok())
                == Some(episodes.len())
                && m.max_speed > 1.5
            {
                let p = solver.read_positions(device, queue).await;
                let prevp: Vec<[f32; 4]> = {
                    let rb = device.create_buffer(&wgpu::BufferDescriptor {
                        label: None,
                        size: solver.n_verts as u64 * 16,
                        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                        mapped_at_creation: false,
                    });
                    let mut e = device.create_command_encoder(&Default::default());
                    e.copy_buffer_to_buffer(&solver.vel, 0, &rb, 0, solver.n_verts as u64 * 16);
                    queue.submit([e.finish()]);
                    crate::gpu_async::read_buffer(device, &rb).await
                };
                let (fi, fv) = prevp
                    .iter()
                    .enumerate()
                    .map(|(i, v)| (i, Vec3::new(v[0], v[1], v[2]).length()))
                    .fold((0, 0.0), |a, b| if b.1 > a.1 { b } else { a });
                let over: Vec<usize> = prevp
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| Vec3::new(v[0], v[1], v[2]).length() > 5.0)
                    .map(|(i, _)| i)
                    .collect();
                let over2 = prevp
                    .iter()
                    .filter(|v| Vec3::new(v[0], v[1], v[2]).length() > 2.0)
                    .count();
                eprintln!(
                    "  >5 m/s: {} verts {:?}; >2 m/s: {} verts",
                    over.len(),
                    &over[..over.len().min(8)],
                    over2
                );
                let g = built
                    .groups
                    .iter()
                    .find(|(_, r)| r.contains(&(fi as u32)))
                    .map(|(n, _)| n.as_str())
                    .unwrap_or("");
                let in_patch = patch.vertices.iter().any(|(v, _)| *v as usize == fi);
                let seam = built
                    .seams
                    .iter()
                    .find(|(_, ps)| {
                        ps.iter()
                            .any(|&(a, b)| a as usize == fi || b as usize == fi)
                    })
                    .map(|(n, _)| n.as_str());
                eprintln!(
                    "ep {} k={k} frame {frame}: fastest v{fi} ({g}, in_patch={in_patch}, seam={seam:?}) {fv:.2} m/s at {:?}, dist to patch {:.3} m, edge? {}",
                    episodes.len(),
                    p[fi],
                    (p[fi] - Vec3::from(patch.center)).length(),
                    built.mesh.neighbors()[fi].len() < 6
                );
            }
            frame += 1;
        }
        episodes.push(ep);
    }
    solver.end_drag();

    // Settle 3 s, then the exact checks.
    for _ in 0..(2.0 * fps) as u32 {
        step(frame);
        frame += 1;
    }
    let self_intersections_after_2s = selfcheck::check(
        &built.mesh,
        &weld,
        &solver.read_positions(device, queue).await,
        None,
    );
    for _ in 0..(1.0 * fps) as u32 {
        step(frame);
        frame += 1;
    }
    let pos = solver.read_positions(device, queue).await;
    let self_intersections_after =
        selfcheck::check(&built.mesh, &weld, &pos, Some(&self_intersections_after_2s));
    let max_seam_gap_mm_after = seam_gap(&pos);
    let penetration_after = penetration_check(built, &pos);
    let stable = non_finite_frames == 0
        && max_speed < 20.0
        && max_consecutive_frames_over_5ms <= 3
        && penetration_after
            .as_ref()
            .is_none_or(|p| p.max_penetration_mm < 2.0)
        && match (max_seam_gap_mm_before, max_seam_gap_mm_after) {
            (Some(b), Some(a)) => a <= b + 5.0,
            _ => true,
        };

    DragResult {
        target: if cfg!(target_arch = "wasm32") {
            "web"
        } else {
            "native"
        },
        scene: built.name.clone(),
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
        penetration_after,
        max_consecutive_frames_over_5ms,
        max_seam_gap_mm_before,
        stable,
        max_seam_gap_mm_after,
        frame_ms_serial: Stats::of(&frame_ms),
        episodes_starting_intersected: episodes
            .iter()
            .filter(|e| e.self_intersections_at_start > 0)
            .count(),
        max_self_intersections_at_episode_start: episodes
            .iter()
            .map(|e| e.self_intersections_at_start)
            .max()
            .unwrap_or(0),
        self_intersections_after_2s,
        self_intersections_after,
        episodes,
        config: cfg,
    }
}
