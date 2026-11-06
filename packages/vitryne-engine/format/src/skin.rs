// SPDX-License-Identifier: AGPL-3.0-or-later
//! A skeleton and skin weights for an avatar mesh (file-format.md, Avatar: skin). The rest pose is
//! translation only: every joint sits at a point of the avatar's space with no rotation of its
//! own, so a pose is one rotation per joint and the bind matrix of a joint is just a shift by
//! minus its position. That is what `body.glb` stores (glTF nodes with a translation, and
//! inverse bind matrices that say the same), and what the posing below uses: linear blend
//! skinning, the standard method, whose known artefacts (a collapsing elbow, a candy-wrapper
//! twist) are not corrected here.

/// Up to this many joints move a vertex (glTF's `JOINTS_0`/`WEIGHTS_0`).
pub const INFLUENCES: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct Joint {
    pub name: String,
    /// The joint above it, by index; none for a root.
    pub parent: Option<usize>,
    /// Its position at rest, metres, avatar space.
    pub rest: [f32; 3],
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Skin {
    pub joints: Vec<Joint>,
    /// Per vertex: the joints that move it.
    pub joint_ids: Vec<[u16; INFLUENCES]>,
    /// Per vertex: how much each moves it; they add up to one (a joint with no share has 0).
    pub weights: Vec<[f32; INFLUENCES]>,
}

/// A rotation as (x, y, z, w); the identity is `IDENTITY`.
pub type Quat = [f32; 4];
pub const IDENTITY: Quat = [0.0, 0.0, 0.0, 1.0];

/// The rotation by `angle` radians about a unit `axis`.
pub fn axis_angle(axis: [f32; 3], angle: f32) -> Quat {
    let (s, c) = (angle / 2.0).sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, c]
}

fn mul(a: Quat, b: Quat) -> Quat {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

/// `q` rotating `v` (a unit quaternion).
fn rotate(q: Quat, v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let cross = |a: [f32; 3], b: [f32; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let t = cross(u, v).map(|x| 2.0 * x);
    let c = cross(u, t);
    [0, 1, 2].map(|k| v[k] + q[3] * t[k] + c[k])
}

impl Skin {
    /// A joint's place after a pose: the rotation and the position of its head in the posed
    /// avatar space. `pose[j]` turns joint `j` about its head, in the frame of the joint above it.
    fn posed(&self, pose: &[Quat]) -> Vec<(Quat, [f32; 3])> {
        let mut out: Vec<Option<(Quat, [f32; 3])>> = vec![None; self.joints.len()];
        for j in 0..self.joints.len() {
            self.place(j, pose, &mut out);
        }
        out.into_iter().map(|p| p.expect("placed")).collect()
    }

    fn place(&self, j: usize, pose: &[Quat], out: &mut Vec<Option<(Quat, [f32; 3])>>) {
        if out[j].is_some() {
            return;
        }
        let joint = &self.joints[j];
        let turn = pose.get(j).copied().unwrap_or(IDENTITY);
        let placed = match joint.parent {
            None => (turn, joint.rest),
            Some(p) => {
                self.place(p, pose, out);
                let (pr, pt) = out[p].expect("parent placed");
                let offset = [0, 1, 2].map(|k| joint.rest[k] - self.joints[p].rest[k]);
                let at = rotate(pr, offset);
                (mul(pr, turn), [0, 1, 2].map(|k| pt[k] + at[k]))
            }
        };
        out[j] = Some(placed);
    }

    /// The vertices moved by `pose` (one rotation per joint, missing ones the identity). With
    /// every rotation the identity, `positions` come back as they are.
    pub fn pose(&self, positions: &[[f32; 3]], pose: &[Quat]) -> Vec<[f32; 3]> {
        let placed = self.posed(pose);
        positions
            .iter()
            .zip(self.joint_ids.iter().zip(&self.weights))
            .map(|(v, (ids, ws))| {
                let mut sum = [0.0f32; 3];
                for (&j, &w) in ids.iter().zip(ws) {
                    if w == 0.0 {
                        continue;
                    }
                    let (r, t) = placed[j as usize];
                    let rest = self.joints[j as usize].rest;
                    let moved = rotate(r, [0, 1, 2].map(|k| v[k] - rest[k]));
                    for k in 0..3 {
                        sum[k] += w * (moved[k] + t[k]);
                    }
                }
                sum
            })
            .collect()
    }

    /// Whether the skin is well formed over `n` vertices: a weight set for each, joints in range,
    /// weights not negative and adding up to one, parents that exist.
    pub fn check(&self, n: usize) -> Result<(), String> {
        if self.joint_ids.len() != n || self.weights.len() != n {
            return Err(format!(
                "skin: {} and {} weight sets for {n} vertices",
                self.joint_ids.len(),
                self.weights.len()
            ));
        }
        for (k, j) in self.joints.iter().enumerate() {
            if j.parent.is_some_and(|p| p >= self.joints.len() || p == k) {
                return Err(format!("skin: joint {} has no valid parent", j.name));
            }
        }
        // A cycle of parents would never end.
        for k in 0..self.joints.len() {
            let (mut at, mut steps) = (k, 0);
            while let Some(p) = self.joints[at].parent {
                at = p;
                steps += 1;
                if steps > self.joints.len() {
                    return Err("skin: the joints' parents go in a circle".into());
                }
            }
        }
        for (v, (ids, ws)) in self.joint_ids.iter().zip(&self.weights).enumerate() {
            if ids
                .iter()
                .zip(ws)
                .any(|(&j, &w)| w != 0.0 && j as usize >= self.joints.len())
            {
                return Err(format!("skin: vertex {v} uses a joint that doesn't exist"));
            }
            let sum: f32 = ws.iter().sum();
            if ws.iter().any(|&w| w < 0.0) || (sum - 1.0).abs() > 1e-3 {
                return Err(format!("skin: vertex {v}'s weights add up to {sum}, not 1"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glb::{self, Mesh};

    /// Two joints, a root at the origin and a child one metre up, and a vertex at each end of a
    /// bar between them and beyond: the bottom follows the root, the top the child, the middle
    /// both.
    fn chain() -> (Mesh, Skin) {
        let skin = Skin {
            joints: vec![
                Joint {
                    name: "root".into(),
                    parent: None,
                    rest: [0.0, 0.0, 0.0],
                },
                Joint {
                    name: "child".into(),
                    parent: Some(0),
                    rest: [0.0, 1.0, 0.0],
                },
            ],
            joint_ids: vec![[0, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]],
            weights: vec![
                [1.0, 0.0, 0.0, 0.0],
                [0.5, 0.5, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0, 0.0],
            ],
        };
        let mesh = Mesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 2.0, 0.0],
                [0.0, 3.0, 0.0],
            ],
            indices: vec![0, 1, 2, 1, 2, 3],
            skin: Some(skin.clone()),
        };
        (mesh, skin)
    }

    #[test]
    fn a_skin_survives_the_file() {
        let (mesh, skin) = chain();
        skin.check(4).unwrap();
        let bytes = glb::write(&mesh, "test");
        assert_eq!(bytes.len() % 4, 0);
        assert_eq!(glb::read(&bytes).unwrap(), mesh);
        // Without it the file is the plain one again.
        let plain = Mesh {
            skin: None,
            ..mesh.clone()
        };
        assert_eq!(glb::read(&glb::write(&plain, "test")).unwrap(), plain);
    }

    /// The writer's output for a mesh without a skin is what it was before skins existed: the
    /// bundled avatar's file, read and written again, comes back byte for byte.
    #[test]
    fn a_mesh_without_a_skin_is_written_as_before() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../assets/examples/tshirt.vtry/avatars");
        let glb_path = std::fs::read_dir(dir)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("body.glb");
        let bytes = std::fs::read(glb_path).unwrap();
        let mesh = glb::read(&bytes).unwrap();
        assert!(mesh.skin.is_none());
        assert_eq!(glb::write(&mesh, crate::GENERATOR), bytes);
    }

    #[test]
    fn the_rest_pose_moves_nothing() {
        let (mesh, skin) = chain();
        let moved = skin.pose(&mesh.positions, &[]);
        assert_eq!(moved, mesh.positions);
        let moved = skin.pose(&mesh.positions, &[IDENTITY, IDENTITY]);
        assert_eq!(moved, mesh.positions);
    }

    #[test]
    fn a_joint_turns_what_hangs_from_it() {
        let (mesh, skin) = chain();
        let q = axis_angle([0.0, 0.0, 1.0], std::f32::consts::FRAC_PI_2);
        let near = |a: [f32; 3], b: [f32; 3]| (0..3).all(|k| (a[k] - b[k]).abs() < 1e-5);
        // The child turns a quarter about z at its own head, (0, 1, 0): what follows it only
        // (the two upper vertices) swings to -x around that point, the root's vertex stays, and
        // the one at the joint itself (half and half) doesn't move, as it is on the axis.
        let moved = skin.pose(&mesh.positions, &[IDENTITY, q]);
        assert!(near(moved[0], [0.0, 0.0, 0.0]), "{:?}", moved[0]);
        assert!(near(moved[1], [0.0, 1.0, 0.0]), "{:?}", moved[1]);
        assert!(near(moved[2], [-1.0, 1.0, 0.0]), "{:?}", moved[2]);
        assert!(near(moved[3], [-2.0, 1.0, 0.0]), "{:?}", moved[3]);
        // The root turning carries the child's joint with it, so everything swings about the
        // origin: (0, y, 0) goes to (-y, 0, 0).
        let moved = skin.pose(&mesh.positions, &[q, IDENTITY]);
        assert!(near(moved[1], [-1.0, 0.0, 0.0]), "{:?}", moved[1]);
        assert!(near(moved[2], [-2.0, 0.0, 0.0]), "{:?}", moved[2]);
        assert!(near(moved[3], [-3.0, 0.0, 0.0]), "{:?}", moved[3]);
    }

    fn bundled(slug: &str) -> Mesh {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../assets/bodies/{slug}/body.glb"));
        glb::read(&std::fs::read(path).unwrap()).unwrap()
    }

    const BODIES: [&str; 6] = [
        "female-slim",
        "female-average",
        "female-full",
        "male-slim",
        "male-average",
        "male-full",
    ];

    /// Every bundled body carries the same 22-joint skeleton, well-formed weights, and the rest
    /// pose is the mesh.
    #[test]
    fn the_bundled_bodies_have_a_skin() {
        for slug in BODIES {
            let mesh = bundled(slug);
            let skin = mesh
                .skin
                .as_ref()
                .unwrap_or_else(|| panic!("{slug}: no skin"));
            assert_eq!(skin.joints.len(), 22, "{slug}");
            assert_eq!(skin.joints[0].name, "root");
            skin.check(mesh.positions.len()).unwrap();
            let moved = skin.pose(&mesh.positions, &[]);
            let worst = moved
                .iter()
                .zip(&mesh.positions)
                .map(|(a, b)| (0..3).map(|k| (a[k] - b[k]).abs()).fold(0.0, f32::max))
                .fold(0.0, f32::max);
            // Weights are 16-bit integers adding up to exactly one: the rest pose is the mesh.
            assert!(worst < 1e-5, "{slug}: rest pose moves a vertex by {worst}");
        }
    }

    /// Swing the left upper arm 40 degrees towards the body: what hangs only from it (the hand)
    /// turns rigidly about the shoulder joint, and what has no share in the arm at all (the legs,
    /// the head, the right side) doesn't move.
    #[test]
    fn raising_an_arm_moves_the_arm_and_nothing_far_from_it() {
        for slug in BODIES {
            let mesh = bundled(slug);
            let skin = mesh.skin.as_ref().unwrap();
            let id = |name: &str| skin.joints.iter().position(|j| j.name == name).unwrap();
            let (upper, lower, wrist) = (id("upperarm01.L"), id("lowerarm01.L"), id("wrist.L"));
            let arm = [id("clavicle.L"), upper, lower, wrist];
            let mut pose = vec![IDENTITY; skin.joints.len()];
            let angle = -40f32.to_radians();
            pose[upper] = axis_angle([0.0, 0.0, 1.0], angle);
            let moved = skin.pose(&mesh.positions, &pose);
            let at = skin.joints[upper].rest;
            let (s, c) = angle.sin_cos();
            let (mut hand, mut far) = (0, 0);
            for (v, (&p, &q)) in mesh.positions.iter().zip(&moved).enumerate() {
                let share = |ids: &[usize]| -> f32 {
                    (0..INFLUENCES)
                        .filter(|&k| ids.contains(&(skin.joint_ids[v][k] as usize)))
                        .map(|k| skin.weights[v][k])
                        .sum()
                };
                if share(&[wrist]) > 0.999 {
                    // Rigid about the shoulder joint: a turn about z.
                    let (x, y) = (p[0] - at[0], p[1] - at[1]);
                    let want = [at[0] + c * x - s * y, at[1] + s * x + c * y, p[2]];
                    for k in 0..3 {
                        assert!(
                            (q[k] - want[k]).abs() < 1e-4,
                            "{slug}: hand vertex {v} {q:?} vs {want:?}"
                        );
                    }
                    hand += 1;
                } else if share(&arm) < 1e-6 && p[0] < at[0] - 0.05 {
                    // The wearer's right side, away from the arm's joint and its chest.
                    for k in 0..3 {
                        assert!(
                            (p[k] - q[k]).abs() < 1e-6,
                            "{slug}: vertex {v} moved {p:?} {q:?}"
                        );
                    }
                    far += 1;
                }
            }
            assert!(hand > 100, "{slug}: {hand} hand vertices");
            assert!(far > 1000, "{slug}: {far} unmoved vertices");
        }
    }

    #[test]
    fn a_bad_skin_is_refused() {
        let (_, mut skin) = chain();
        skin.weights[0] = [0.5, 0.0, 0.0, 0.0];
        assert!(skin.check(4).unwrap_err().contains("add up"));
        let (_, mut skin) = chain();
        skin.joints[0].parent = Some(1);
        assert!(skin.check(4).unwrap_err().contains("circle"));
        let (_, skin) = chain();
        assert!(skin.check(3).is_err());
    }
}
