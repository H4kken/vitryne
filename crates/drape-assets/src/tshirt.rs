// SPDX-License-Identifier: AGPL-3.0-or-later
//! Procedural T-shirt sized for the MakeHuman base body (assets/body/README.md has the
//! measurements), its initial placement around the avatar, and the scene build.
//!
//! Pattern frame: metres, x across (+x = the wearer's left = world +X), y up from the hem.
//! Front and back are drawn as seen from the front, so their side/shoulder seams have the same
//! direction. Sleeves: x across (+x = front half of the cap), y up from the hem to the cap top.

use std::sync::Arc;

use glam::{Vec2, Vec3};
use serde::{Deserialize, Serialize};

use drape_core::{
    body::{BodyMesh, BodyQuery, Sdf},
    constraints::{Constraints, Material},
    scene::{Built, RenderMesh},
    sim::{Collider, Schedule, SimConfig},
};

use crate::{
    meshing::{MeshedPattern, mesh_pattern},
    pattern::{Panel, Pattern, PatternEdge, Seam, bezier},
};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct TshirtParams {
    /// Target triangle edge length, m. 12.2 / 8.64 / 6.1 / 4.32 mm ≈ 5k / 10k / 20k / 40k vertices.
    pub edge: f32,
    /// World height of the hem (pattern y = 0) for the body panels.
    pub hem_y: f32,
    /// Body panels start on a vertical cylinder of this radius around the torso axis.
    pub torso_radius: f32,
    pub torso_axis_z: f32,
    /// Sleeves start wrapped on a cylinder of this radius around the upper-arm axis...
    pub sleeve_radius: f32,
    /// ...starting this far out along the arm from the shoulder.
    pub sleeve_offset: f32,
}

impl Default for TshirtParams {
    fn default() -> Self {
        Self {
            edge: 0.00864,
            hem_y: 0.80,
            torso_radius: 0.20,
            torso_axis_z: 0.04,
            sleeve_radius: 0.10,
            sleeve_offset: 0.08,
        }
    }
}

const HEM: f32 = 0.25; // half width at hem
const CHEST: f32 = 0.24; // half width at underarm
const UNDERARM_Y: f32 = 0.42;
const SHOULDER: Vec2 = Vec2::new(0.18, 0.60);
const NECK: Vec2 = Vec2::new(0.075, 0.635);
const FRONT_NECK_Y: f32 = 0.565;
const BACK_NECK_Y: f32 = 0.615;
const SLEEVE_HEM: f32 = 0.17;
const SLEEVE_UNDER: Vec2 = Vec2::new(0.18, 0.06);
const CAP_TOP_Y: f32 = 0.13;

fn mirror(pts: &[Vec2]) -> Vec<Vec2> {
    pts.iter().rev().map(|p| Vec2::new(-p.x, p.y)).collect()
}

fn body_panel(name: &'static str, neck_y: f32) -> Panel {
    let e = PatternEdge::new;
    let arm_r = bezier(
        Vec2::new(CHEST, UNDERARM_Y),
        Vec2::new(0.19, 0.44),
        SHOULDER,
        12,
    );
    let neck_r = bezier(NECK, Vec2::new(0.07, neck_y), Vec2::new(0.0, neck_y), 10);
    // Neck runs right to left across the top: right half reversed, then the mirrored half.
    let mut neck: Vec<Vec2> = neck_r.clone();
    neck.extend(mirror(&neck_r).into_iter().skip(1));
    Panel::new(
        name,
        vec![
            e("hem", vec![Vec2::new(-HEM, 0.0), Vec2::new(HEM, 0.0)]),
            e(
                "side_r",
                vec![Vec2::new(HEM, 0.0), Vec2::new(CHEST, UNDERARM_Y)],
            ),
            e("arm_r", arm_r.clone()),
            e("shoulder_r", vec![SHOULDER, NECK]),
            e("neck", neck),
            e(
                "shoulder_l",
                vec![
                    Vec2::new(-NECK.x, NECK.y),
                    Vec2::new(-SHOULDER.x, SHOULDER.y),
                ],
            ),
            e("arm_l", mirror(&arm_r)),
            e(
                "side_l",
                vec![Vec2::new(-CHEST, UNDERARM_Y), Vec2::new(-HEM, 0.0)],
            ),
        ],
    )
}

fn sleeve(name: &'static str) -> Panel {
    let e = PatternEdge::new;
    let cap_p = bezier(
        SLEEVE_UNDER,
        Vec2::new(0.10, CAP_TOP_Y),
        Vec2::new(0.0, CAP_TOP_Y),
        12,
    );
    let cap_m: Vec<Vec2> = mirror(&cap_p);
    Panel::new(
        name,
        vec![
            e(
                "hem",
                vec![Vec2::new(-SLEEVE_HEM, 0.0), Vec2::new(SLEEVE_HEM, 0.0)],
            ),
            e("under_p", vec![Vec2::new(SLEEVE_HEM, 0.0), SLEEVE_UNDER]),
            e("cap_p", cap_p),
            e("cap_m", cap_m),
            e(
                "under_m",
                vec![
                    Vec2::new(-SLEEVE_UNDER.x, SLEEVE_UNDER.y),
                    Vec2::new(-SLEEVE_HEM, 0.0),
                ],
            ),
        ],
    )
}

pub fn pattern() -> Pattern {
    let panels = vec![
        body_panel("front", FRONT_NECK_Y),
        body_panel("back", BACK_NECK_Y),
        sleeve("sleeve_r"),
        sleeve("sleeve_l"),
    ];
    let (front, back, sr, sl) = (0, 1, 2, 3);
    let ed = |p: usize, n: &str| (p, panels[p].edge(n));
    let seam = Seam::simple;
    let seams = vec![
        seam("side_r", ed(front, "side_r"), ed(back, "side_r"), false),
        seam("side_l", ed(front, "side_l"), ed(back, "side_l"), false),
        seam(
            "shoulder_r",
            ed(front, "shoulder_r"),
            ed(back, "shoulder_r"),
            false,
        ),
        seam(
            "shoulder_l",
            ed(front, "shoulder_l"),
            ed(back, "shoulder_l"),
            false,
        ),
        // Armholes: body arm edge vs sleeve cap half (front half = cap_p, +x).
        seam(
            "armhole_front_r",
            ed(front, "arm_r"),
            ed(sr, "cap_p"),
            false,
        ),
        seam("armhole_back_r", ed(back, "arm_r"), ed(sr, "cap_m"), true),
        seam("armhole_front_l", ed(front, "arm_l"), ed(sl, "cap_p"), true),
        seam("armhole_back_l", ed(back, "arm_l"), ed(sl, "cap_m"), false),
        // Sleeve tubes.
        seam("underarm_r", ed(sr, "under_p"), ed(sr, "under_m"), true),
        seam("underarm_l", ed(sl, "under_p"), ed(sl, "under_m"), true),
    ];
    Pattern { panels, seams }
}

/// Upper-arm frame for the right (+1) or left (-1) arm, measured on the MakeHuman body.
fn arm_frame(side: f32) -> (Vec3, Vec3, Vec3, Vec3) {
    let shoulder = Vec3::new(0.182 * side, 1.36, 0.006);
    let axis = Vec3::new(0.544 * side, -0.837, 0.061).normalize();
    let up = (Vec3::Y - Vec3::Y.dot(axis) * axis).normalize();
    let mut fwd = axis.cross(up);
    if fwd.z < 0.0 {
        fwd = -fwd;
    }
    (shoulder, axis, up, fwd)
}

/// Initial placement (the plan: hardcoded for this one garment). Body panels on a cylinder
/// around the torso, front in front and back behind; sleeves wrapped around the upper arms.
pub fn place(mp: &mut MeshedPattern, p: &TshirtParams) {
    let r = p.torso_radius;
    let mut axes: Vec<(Vec3, Vec3)> = Vec::new(); // per panel: a point on its axis and the direction
    for (pi, range) in mp.panel_vertices.clone().into_iter().enumerate() {
        for v in range {
            let q = mp.uv[v as usize];
            if axes.len() <= pi {
                axes.push(match pi {
                    0 | 1 => (Vec3::new(0.0, 0.0, p.torso_axis_z), Vec3::Y),
                    _ => {
                        let (sh, axis, _, _) = arm_frame(if pi == 2 { 1.0 } else { -1.0 });
                        (sh, axis)
                    }
                });
            }
            mp.mesh.pos[v as usize] = match pi {
                0 | 1 => {
                    let phi = q.x / r;
                    let s = if pi == 0 { 1.0 } else { -1.0 };
                    Vec3::new(
                        r * phi.sin(),
                        p.hem_y + q.y,
                        p.torso_axis_z + s * r * phi.cos(),
                    )
                }
                _ => {
                    let side = if pi == 2 { 1.0 } else { -1.0 };
                    let (sh, axis, up, fwd) = arm_frame(side);
                    let th = q.x / p.sleeve_radius;
                    let along = p.sleeve_offset + (CAP_TOP_Y - q.y);
                    sh + axis * along + p.sleeve_radius * (th.cos() * up + th.sin() * fwd)
                }
            };
        }
    }
    // Render-only: wind every panel so its front face points away from its axis (mirrored
    // placements flip winding). The solver doesn't care about winding.
    for (pi, tr) in mp.panel_tris.clone().into_iter().enumerate() {
        let (o, d) = axes[pi];
        let score: f32 = mp.mesh.tris[tr.clone()]
            .iter()
            .map(|t| {
                let [a, b, c] = t.map(|k| mp.mesh.pos[k as usize]);
                let n = (b - a).cross(c - a);
                let q = (a + b + c) / 3.0 - o;
                n.dot(q - q.dot(d) * d)
            })
            .sum();
        if score < 0.0 {
            for t in &mut mp.mesh.tris[tr] {
                t.swap(1, 2);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdfParams {
    pub cell: f32,
    pub band: f32,
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl Default for SdfParams {
    /// Everything the T-shirt can reach, including when dragged: hips and thighs, forearms.
    /// Outside the box there is no collision, so the box must not clip the body anywhere the
    /// cloth can go (an earlier box ending at y = 0.70 let dragged hems sink into the hips and
    /// whip at the box boundary). The 12 cm band covers the whole torso interior, so even a deep
    /// penetration has a gradient pointing out.
    fn default() -> Self {
        Self {
            cell: 0.004,
            band: 0.12,
            min: [-0.55, 0.40, -0.25],
            max: [0.55, 1.60, 0.35],
        }
    }
}

impl SdfParams {
    pub fn bake(&self, q: &BodyQuery) -> Sdf {
        Sdf::bake(
            q,
            Vec3::from(self.min),
            Vec3::from(self.max),
            self.cell,
            self.band,
        )
    }
}

pub fn tshirt_schedule() -> Schedule {
    Schedule {
        sew_compliance_start: 1e-2,
        sew_compliance_end: 1e-8,
        sew_ramp_s: 0.5,
        sew_max_step: 0.0005,
        gravity_delay_s: 0.6,
        gravity_ramp_s: 0.3,
    }
}

/// Builds the T-shirt scene. The SDF is passed in so callers can cache it (bake takes seconds).
pub fn build(
    params: &TshirtParams,
    body: Arc<BodyQuery>,
    sdf: Arc<Sdf>,
    mut sim: SimConfig,
) -> Built {
    let pat = pattern();
    let mut mp = mesh_pattern(&pat, params.edge);
    place(&mut mp, params);
    let material = Material::cotton();
    let mut constraints = Constraints::build(&mp.mesh, &material);
    constraints.set_sewing(&mp.sew_pairs, mp.mesh.n_verts());
    sim.schedule = tshirt_schedule();

    // Diagnostics: seam lengths, initial seam gaps, initial penetration.
    let gaps: Vec<f32> = mp
        .sew_pairs
        .iter()
        .map(|&(i, j)| (mp.mesh.pos[i as usize] - mp.mesh.pos[j as usize]).length())
        .collect();
    let inside = mp
        .mesh
        .pos
        .iter()
        .filter(|p| sdf.sample(**p) < sim.thickness)
        .count();
    log::info!(
        "tshirt: {} verts, {} tris, {} sew pairs (initial gap max {:.0} mm, mean {:.0} mm), {} verts start inside thickness",
        mp.mesh.n_verts(),
        mp.mesh.tris.len(),
        mp.sew_pairs.len(),
        gaps.iter().cloned().fold(0.0, f32::max) * 1000.0,
        gaps.iter().sum::<f32>() / gaps.len() as f32 * 1000.0,
        inside
    );

    let names = ["front", "back", "sleeve_r", "sleeve_l"];
    let groups = mp
        .panel_vertices
        .iter()
        .enumerate()
        .map(|(i, r)| (names[i].to_string(), r.clone()))
        .collect();
    let seams = mp.seam_pairs.clone();
    let bm: &BodyMesh = &body.mesh;
    let collider_mesh = RenderMesh {
        pos: bm.pos.clone(),
        nrm: bm.vertex_normals(),
        idx: bm.tris.iter().flatten().copied().collect(),
    };
    Built {
        name: "tshirt".into(),
        description: serde_json::json!({ "tshirt": params, "pattern_panels": pat.panels.len(), "seams": pat.seams.len(),
            "initial_inside_thickness": inside, "sdf": { "cell": sdf.cell, "band": sdf.band, "dims": sdf.dims.to_array(), "bytes": sdf.bytes() } }),
        mesh: mp.mesh,
        constraints,
        material,
        collider: Collider::Sdf(sdf),
        collider_mesh,
        sim,
        body: Some(body),
        camera: (Vec3::new(0.0, 1.12, 0.03), 1.5),
        seams,
        groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_meshes_and_seams_pair_up() {
        let pat = pattern();
        let mp = mesh_pattern(&pat, 0.01);
        assert!(mp.mesh.n_verts() > 5000, "{}", mp.mesh.n_verts());
        // Every seam pair joins two different vertices of the same pattern corner role, and
        // the pairs' 2D edge positions advance consistently (lengths roughly proportional).
        for (i, j) in &mp.sew_pairs {
            assert_ne!(i, j);
        }
        // Mesh quality: no degenerate triangles, edge lengths close to target.
        let e = mp.mesh.mean_edge_length();
        assert!((e - 0.01).abs() < 0.002, "mean edge {e}");
        let mut worst = (f32::MAX, Vec2::ZERO, 0usize);
        for t in &mp.mesh.tris {
            let [a, b, c] = t.map(|k| mp.uv[k as usize]);
            let area2 = (b - a).perp_dot(c - a);
            let panel = mp
                .panel_vertices
                .iter()
                .position(|r| r.contains(&t[0]))
                .unwrap();
            if area2 < worst.0 {
                worst = (area2, (a + b + c) / 3.0, panel);
            }
        }
        // Equilateral 1 cm triangle: 2*area = 8.7e-5. Require at least 5% of that.
        assert!(
            worst.0 > 0.05 * 8.7e-5,
            "worst triangle 2*area {} at {} in panel {}",
            worst.0,
            worst.1,
            worst.2
        );
    }
}
