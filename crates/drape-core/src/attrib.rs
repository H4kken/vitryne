// SPDX-License-Identifier: AGPL-3.0-or-later
//! Debug only (S3): which solver phase made a spike? `DRAPE_DEBUG_ATTRIB=1 vitryne bench-drag ...`
//! snapshots pos/prev/vel before every drag frame; on a frame with a vertex >= 5 m/s it restores
//! the snapshot and replays that frame one phase at a time, reading back after each phase.
//! The solver is bit-reproducible on one target (M4), so the replay is the same frame.
//!
//! Velocity at the end of a substep is (pos - prev) / h, so each phase's contribution to it is
//! the change it makes to (pos - prev) / h. Predict's share is gravity, damping and air drag;
//! the rest are the position corrections that turned into velocity.

use glam::Vec3;

use crate::{body::Sdf, sim::Solver};

pub struct Attrib {
    snap: [wgpu::Buffer; 3],
}

impl Attrib {
    pub fn new(device: &wgpu::Device, solver: &Solver) -> Self {
        let mk = |l| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(l),
                size: solver.n_verts as u64 * 16,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            })
        };
        Self {
            snap: [mk("snap-pos"), mk("snap-prev"), mk("snap-vel")],
        }
    }

    fn bufs(solver: &Solver) -> [&wgpu::Buffer; 3] {
        [&solver.pos, &solver.prev, &solver.vel]
    }

    pub fn snapshot(&self, enc: &mut wgpu::CommandEncoder, solver: &Solver) {
        for (s, d) in Self::bufs(solver).iter().zip(&self.snap) {
            enc.copy_buffer_to_buffer(s, 0, d, 0, s.size());
        }
    }

    pub fn restore(&self, enc: &mut wgpu::CommandEncoder, solver: &Solver) {
        for (s, d) in self.snap.iter().zip(Self::bufs(solver)) {
            enc.copy_buffer_to_buffer(s, 0, d, 0, s.size());
        }
    }

    async fn read(device: &wgpu::Device, queue: &wgpu::Queue, b: &wgpu::Buffer) -> Vec<Vec3> {
        let rb = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: b.size(),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut e = device.create_command_encoder(&Default::default());
        e.copy_buffer_to_buffer(b, 0, &rb, 0, b.size());
        queue.submit([e.finish()]);
        let v: Vec<[f32; 4]> = crate::gpu_async::read_buffer(device, &rb).await;
        v.iter().map(|p| Vec3::new(p[0], p[1], p[2])).collect()
    }

    /// Replay the frame for the vertices in `watch` and print each phase's share of their final
    /// velocity (projected on the final velocity direction and on the body normal).
    pub async fn replay(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        solver: &Solver,
        sdf: Option<&Sdf>,
        watch: &[usize],
        tag: &str,
    ) {
        let mut e = device.create_command_encoder(&Default::default());
        for (s, d) in self.snap.iter().zip(Self::bufs(solver)) {
            e.copy_buffer_to_buffer(s, 0, d, 0, s.size());
        }
        queue.submit([e.finish()]);
        let h = solver.cfg.frame_dt / solver.cfg.substeps as f32;
        let labels = solver.phase_labels();
        let n = watch.len();
        // contrib[phase][k]: summed velocity change of watched vertex k (m/s).
        let mut contrib = vec![vec![Vec3::ZERO; n]; labels.len()];
        // Largest single-substep |change| per phase (m/s) and the body distance then (mm).
        let mut peak = vec![(0.0f32, 0u32, 0.0f32); labels.len()];
        let rd = |b| Self::read(device, queue, b);
        let (mut p, mut q) = (rd(&solver.pos).await, rd(&solver.prev).await);
        let v0: Vec<Vec3> = watch.iter().map(|&i| (p[i] - q[i]) / h).collect();
        for s in 0..solver.cfg.substeps {
            for ph in 0..labels.len() {
                let mut e = device.create_command_encoder(&Default::default());
                if !solver.encode_phase(&mut e, s, ph) {
                    continue;
                }
                queue.submit([e.finish()]);
                let (p2, q2) = (rd(&solver.pos).await, rd(&solver.prev).await);
                for (k, &i) in watch.iter().enumerate() {
                    let dv = ((p2[i] - q2[i]) - (p[i] - q[i])) / h;
                    contrib[ph][k] += dv;
                    if k == 0 && dv.length() > peak[ph].0 {
                        peak[ph] = (
                            dv.length(),
                            s,
                            sdf.map_or(0.0, |f| f.sample(p2[i]) * 1000.0),
                        );
                    }
                }
                (p, q) = (p2, q2);
            }
        }
        let vel = rd(&solver.vel).await;
        eprintln!(
            "[attrib {tag}] {n} vertices >= 5 m/s; fastest v{} {:.2} m/s, start {:.2} m/s, body {:.1} mm",
            watch[0],
            vel[watch[0]].length(),
            v0[0].length(),
            sdf.map_or(0.0, |f| f.sample(p[watch[0]]) * 1000.0)
        );
        for (ph, l) in labels.iter().enumerate() {
            let (mut along, mut normal) = (0.0, 0.0);
            for (k, &i) in watch.iter().enumerate() {
                let d = vel[i].normalize_or_zero();
                along += contrib[ph][k].dot(d);
                if let Some(f) = sdf {
                    normal += contrib[ph][k].dot(f.gradient(p[i]).normalize_or_zero());
                }
            }
            let c0 = contrib[ph][0];
            if c0.length() > 0.01 || peak[ph].0 > 0.05 {
                eprintln!(
                    "   {l:>14}: fastest {:+.2} along v, {:+.2} along body n | mean over set {:+.2} along v, {:+.2} along n | peak |dv| {:.2} at s{} (body {:.1} mm)",
                    c0.dot(vel[watch[0]].normalize_or_zero()),
                    sdf.map_or(0.0, |f| c0.dot(f.gradient(p[watch[0]]).normalize_or_zero())),
                    along / n as f32,
                    normal / n as f32,
                    peak[ph].0,
                    peak[ph].1,
                    peak[ph].2
                );
            }
        }
    }
}
