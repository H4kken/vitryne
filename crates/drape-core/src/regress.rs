// SPDX-License-Identifier: AGPL-3.0-or-later
//! Golden regression results (M3): what a drape must keep doing. A case is a garment drape for a
//! fixed number of frames on a fresh simulation; `observe` measures it, `Golden` is what was
//! recorded, `Golden::check` lists every way the observation differs beyond its tolerance.
//!
//! The runner and the golden files live outside this crate (`drape regress`, tests/regression/):
//! this module is the measurement and the comparison, on any target.

use glam::Vec3;
use serde::{Deserialize, Serialize};

use crate::{engine::Simulation, metrics::RestDetector};

/// Frames the simulation runs before the shape is taken, and extra frames after it, so that
/// "persistent" self-intersections (present at both checks) can be told from passing ones.
pub const FRAMES: u32 = 600;
pub const EXTRA_FRAMES: u32 = 300;

/// What `observe` measures.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Observed {
    pub vertices: u32,
    pub frames: u32,
    /// First frame of the first window below the rest speed, `None` = never.
    pub rest_frame: Option<u32>,
    pub max_speed: f32,
    pub non_finite_frames: u32,
    pub max_penetration_mm: f32,
    /// Self-intersecting triangle pairs at `frames`, and those also present `EXTRA_FRAMES` later.
    pub self_intersections: usize,
    pub persistent_pairs: usize,
    /// Edge strain at `frames`, fractions.
    pub strain_p50: f32,
    pub strain_p90: f32,
    pub strain_p99: f32,
    pub strain_max: f32,
    pub max_seam_gap_mm: Option<f32>,
}

/// Runs `FRAMES` + `EXTRA_FRAMES` frames of a fresh simulation, sampling every frame.
/// Returns the observation and the positions at `FRAMES`.
pub async fn observe(sim: &Simulation) -> (Observed, Vec<Vec3>) {
    let settings = *sim.settings();
    let mut rest = RestDetector::new(settings.rest_vrms, settings.rest_window, sim.free_mass());
    rest.earliest_frame = (settings.schedule.end_s() / settings.frame_dt).ceil() as u32;
    let (mut max_speed, mut non_finite_frames) = (0.0f32, 0u32);
    let mut last = Default::default();
    for _ in 0..FRAMES {
        let f = sim.frame();
        let mut enc = sim.gpu().device.create_command_encoder(&Default::default());
        sim.encode_step(&mut enc, None);
        sim.encode_sample(&mut enc);
        sim.gpu().queue.submit([enc.finish()]);
        let m = sim.read_sample().await;
        non_finite_frames += (m.non_finite > 0) as u32;
        max_speed = max_speed.max(m.max_speed);
        rest.push(f, &m);
        last = m;
    }
    let pos = sim.read_positions().await;
    let at = sim.metrics_at(last, &pos, None);
    sim.step(EXTRA_FRAMES);
    sim.wait().await;
    let pos_after = sim.read_positions().await;
    let sample_after = sim.sample().await;
    let after = sim.metrics_at(sample_after, &pos_after, Some(&at.self_intersections));
    let observed = Observed {
        vertices: sim.n_verts(),
        frames: FRAMES,
        rest_frame: rest.rest_frame,
        max_speed,
        non_finite_frames,
        max_penetration_mm: at
            .penetration
            .as_ref()
            .map_or(0.0, |p| p.max_penetration_mm),
        self_intersections: at.self_intersections.pairs,
        persistent_pairs: after.self_intersections.persistent_pairs.unwrap_or(0),
        strain_p50: at.strain.p50,
        strain_p90: at.strain.p90,
        strain_p99: at.strain.p99,
        strain_max: at.strain.max,
        max_seam_gap_mm: at.max_seam_gap_mm,
    };
    (observed, pos)
}

/// A recorded result and how far a later run may differ from it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Golden {
    /// Why this case is here, and anything a reader should know about its tolerances.
    pub note: String,
    pub observed: Observed,
    /// The settings the golden was recorded with (the full `SimSettings`), for the record.
    pub settings: serde_json::Value,
    /// Max distance of any vertex from the recorded shape at `FRAMES`, mm.
    pub shape_tolerance_mm: f32,
    /// Allowed difference of the rest frame, frames (a rest that appears or vanishes always fails).
    pub rest_frame_tolerance: u32,
    /// Strain percentiles may differ by this much (fraction; 0.005 = half a percentage point).
    pub strain_tolerance: f32,
    pub seam_gap_tolerance_mm: f32,
    /// Persistent self-intersections may be up to `golden * (1 + this) + 2`; 0 = exact.
    pub intersection_slack: f32,
}

impl Golden {
    pub fn new(note: &str, observed: Observed, settings: serde_json::Value) -> Self {
        Self {
            note: note.into(),
            observed,
            settings,
            shape_tolerance_mm: 0.5,
            rest_frame_tolerance: 15,
            strain_tolerance: 0.005,
            seam_gap_tolerance_mm: 1.0,
            intersection_slack: 0.0,
        }
    }

    /// Every difference beyond tolerance, as readable lines; empty = pass.
    pub fn check(&self, now: &Observed, shape_diff_mm: Option<f32>) -> Vec<String> {
        let g = &self.observed;
        let mut bad = Vec::new();
        let mut want = |ok: bool, what: String| {
            if !ok {
                bad.push(what);
            }
        };
        want(
            now.vertices == g.vertices,
            format!("vertices {} (golden {})", now.vertices, g.vertices),
        );
        want(
            now.non_finite_frames == 0,
            format!("{} frames with NaN/inf", now.non_finite_frames),
        );
        want(
            now.max_penetration_mm < 2.0
                && (now.max_penetration_mm - g.max_penetration_mm).abs() < 0.5,
            format!(
                "penetration {:.2} mm (golden {:.2}, limit 2)",
                now.max_penetration_mm, g.max_penetration_mm
            ),
        );
        want(
            match (now.rest_frame, g.rest_frame) {
                (Some(a), Some(b)) => a.abs_diff(b) <= self.rest_frame_tolerance,
                (None, None) => true,
                _ => false,
            },
            format!(
                "rest frame {:?} (golden {:?}, +-{})",
                now.rest_frame, g.rest_frame, self.rest_frame_tolerance
            ),
        );
        let limit = (g.persistent_pairs as f32 * (1.0 + self.intersection_slack)).ceil() as usize
            + if self.intersection_slack > 0.0 { 2 } else { 0 };
        want(
            now.persistent_pairs <= limit,
            format!(
                "persistent self-intersections {} (golden {}, limit {limit})",
                now.persistent_pairs, g.persistent_pairs
            ),
        );
        for (name, a, b) in [
            ("p50", now.strain_p50, g.strain_p50),
            ("p90", now.strain_p90, g.strain_p90),
            ("p99", now.strain_p99, g.strain_p99),
        ] {
            want(
                (a - b).abs() <= self.strain_tolerance,
                format!(
                    "strain {name} {:.2}% (golden {:.2}%, +-{:.2})",
                    a * 100.0,
                    b * 100.0,
                    self.strain_tolerance * 100.0
                ),
            );
        }
        if let (Some(a), Some(b)) = (now.max_seam_gap_mm, g.max_seam_gap_mm) {
            want(
                (a - b).abs() <= self.seam_gap_tolerance_mm,
                format!(
                    "seam gap {a:.1} mm (golden {b:.1}, +-{:.1})",
                    self.seam_gap_tolerance_mm
                ),
            );
        }
        if let Some(d) = shape_diff_mm {
            want(
                d <= self.shape_tolerance_mm,
                format!(
                    "shape differs by up to {d:.2} mm (limit {:.2})",
                    self.shape_tolerance_mm
                ),
            );
        }
        bad
    }
}

/// Largest vertex displacement between two shapes, mm.
pub fn shape_diff_mm(a: &[Vec3], b: &[Vec3]) -> f32 {
    a.iter()
        .zip(b)
        .map(|(p, q)| (*p - *q).length())
        .fold(0.0, f32::max)
        * 1000.0
}

/// Positions as f32 little-endian xyz (the golden shape file).
pub fn positions_to_bytes(p: &[Vec3]) -> Vec<u8> {
    p.iter()
        .flat_map(|v| v.to_array())
        .flat_map(|x| x.to_le_bytes())
        .collect()
}

pub fn positions_from_bytes(b: &[u8]) -> Vec<Vec3> {
    b.as_chunks::<12>()
        .0
        .iter()
        .map(|c| {
            let f = |i: usize| f32::from_le_bytes([c[i], c[i + 1], c[i + 2], c[i + 3]]);
            Vec3::new(f(0), f(4), f(8))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs() -> Observed {
        Observed {
            vertices: 100,
            frames: FRAMES,
            rest_frame: Some(200),
            max_speed: 2.0,
            non_finite_frames: 0,
            max_penetration_mm: 0.0,
            self_intersections: 0,
            persistent_pairs: 0,
            strain_p50: 0.005,
            strain_p90: 0.02,
            strain_p99: 0.06,
            strain_max: 0.2,
            max_seam_gap_mm: Some(2.0),
        }
    }

    #[test]
    fn identical_passes_and_each_regression_is_named() {
        let g = Golden::new("test", obs(), serde_json::json!({}));
        assert!(g.check(&obs(), Some(0.0)).is_empty());
        let mut o = obs();
        o.rest_frame = None;
        o.persistent_pairs = 3;
        o.strain_p99 = 0.09;
        o.max_penetration_mm = 2.5;
        let bad = g.check(&o, Some(1.0));
        assert_eq!(bad.len(), 5, "{bad:?}");
        // A small rest-frame drift is fine, a large one is not.
        let mut o = obs();
        o.rest_frame = Some(210);
        assert!(g.check(&o, None).is_empty());
        o.rest_frame = Some(230);
        assert_eq!(g.check(&o, None).len(), 1);
    }

    #[test]
    fn positions_roundtrip() {
        let p = vec![Vec3::new(1.0, -2.5, 3.25), Vec3::new(0.0, 0.5, -1.0)];
        assert_eq!(positions_from_bytes(&positions_to_bytes(&p)), p);
        assert_eq!(shape_diff_mm(&p, &p), 0.0);
    }
}
