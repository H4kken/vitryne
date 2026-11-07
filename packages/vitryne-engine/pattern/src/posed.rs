// SPDX-License-Identifier: AGPL-3.0-or-later
//! The avatar's regions in a pose. Regions are stored at rest (file-format.md, Regions); a
//! posed body needs them where its bones went, so that a wrap (region, angle, top, radius)
//! resolves around the posed limb with the same size. Nothing here decides where a piece goes
//! or how big it is: that stays on the rest body (`placement.rs`, patents.md rules 3 and 6).
//! The regions follow the skeleton, not a model and not the cloth.
//!
//! How each moves, all rigid per bone so that lengths hold:
//! - a path (an arm's centreline): each point goes with the bone nearest to it;
//! - an axis with its own bone (`head`, the arms' straight axes): that bone's move;
//! - the torso and the legs: a line through two joints, with the same distances along it, so a
//!   bent hip or a leaned spine tilts it.

use std::collections::BTreeMap;

use vitryne_format::{
    Document, PathRegion, Region, Vec3, glb,
    skin::{Quat, Rigid, Skin},
};

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|k| a[k] - b[k])
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    (0..3).map(|k| a[k] * b[k]).sum()
}
fn unit(a: [f32; 3]) -> Option<[f32; 3]> {
    let l = dot(a, a).sqrt();
    (l > 1e-6).then(|| a.map(|x| x / l))
}
fn mm(p: Vec3) -> [f32; 3] {
    p.map(|x| x as f32 / 1000.0)
}
fn to_mm(p: [f32; 3]) -> Vec3 {
    p.map(|x| (x as f64 * 1e6).round() / 1000.0)
}
fn dir(d: Vec3) -> [f32; 3] {
    d.map(|x| x as f32)
}
fn to_dir(d: [f32; 3]) -> Vec3 {
    d.map(|x| (x as f64 * 1e6).round() / 1e6)
}

/// The distance from `p` to the segment `a`..`b`.
fn segment_distance(p: [f32; 3], a: [f32; 3], b: [f32; 3]) -> f32 {
    let ab = sub(b, a);
    let l2 = dot(ab, ab);
    let t = if l2 > 0.0 {
        (dot(sub(p, a), ab) / l2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let q = [0, 1, 2].map(|k| a[k] + t * ab[k]);
    dot(sub(p, q), sub(p, q)).sqrt()
}

/// The part of `d` across the unit `axis`, as a direction; none if `d` lies along it.
fn across(d: [f32; 3], axis: [f32; 3]) -> Option<[f32; 3]> {
    let k = dot(d, axis);
    unit([0, 1, 2].map(|i| d[i] - k * axis[i]))
}

struct Rig<'a> {
    skin: &'a Skin,
    pose: &'a [Quat],
}

impl Rig<'_> {
    fn joint(&self, name: &str) -> Result<usize, String> {
        self.skin.joint_index(name).ok_or_else(|| {
            format!("pose: the skeleton has no joint {name}, which the regions need")
        })
    }
    fn rigid(&self, name: &str) -> Result<Rigid, String> {
        Ok(self.skin.rigid(self.pose, self.joint(name)?))
    }
    fn rest(&self, name: &str) -> Result<[f32; 3], String> {
        Ok(self.skin.joints[self.joint(name)?].rest)
    }

    /// A path region: each point goes with the bone nearest to it at rest (a bone runs from a
    /// joint to the joints below it, and is carried by the upper one).
    fn path(&self, r: &PathRegion) -> Result<PathRegion, String> {
        let bones: Vec<(usize, [f32; 3], [f32; 3])> = self
            .skin
            .joints
            .iter()
            .filter_map(|joint| {
                let p = joint.parent?;
                Some((p, self.skin.joints[p].rest, joint.rest))
            })
            .collect();
        let owner = |p: [f32; 3]| {
            bones
                .iter()
                .min_by(|a, b| {
                    segment_distance(p, a.1, a.2).total_cmp(&segment_distance(p, b.1, b.2))
                })
                .map(|b| b.0)
                .ok_or("pose: the skeleton has no bones")
        };
        let mut points = Vec::new();
        let mut first = None;
        for &q in &r.points {
            let p = mm(q);
            let j = owner(p)?;
            let m = self.skin.rigid(self.pose, j);
            first.get_or_insert(m);
            points.push(to_mm(m.point(p)));
        }
        let m = first.ok_or("pose: a path region has no points")?;
        Ok(PathRegion {
            points,
            zero: to_dir(m.dir(dir(r.zero))),
            other: r.other.clone(),
        })
    }

    /// An axis region carried whole by one bone.
    fn on_bone(&self, a: &vitryne_format::AxisRegion, bone: &str) -> Result<Region, String> {
        let m = self.rigid(bone)?;
        Ok(Region::Axis(vitryne_format::AxisRegion {
            origin: to_mm(m.point(mm(a.origin))),
            axis: to_dir(m.dir(dir(a.axis))),
            zero: to_dir(m.dir(dir(a.zero))),
            other: a.other.clone(),
        }))
    }

    /// An axis region that tilts with the line through two joints: the points of the axis
    /// nearest to each joint go with that joint, and the axis is drawn through them.
    fn between(
        &self,
        a: &vitryne_format::AxisRegion,
        from: &str,
        to: &str,
    ) -> Result<Region, String> {
        let (o, ax) = (mm(a.origin), dir(a.axis));
        let near = |name: &str| -> Result<(f32, [f32; 3]), String> {
            let t = dot(sub(self.rest(name)?, o), ax);
            Ok((t, [0, 1, 2].map(|k| o[k] + t * ax[k])))
        };
        let ((ta, pa), (tb, pb)) = (near(from)?, near(to)?);
        let (ma, mb) = (self.rigid(from)?, self.rigid(to)?);
        let (qa, qb) = (ma.point(pa), mb.point(pb));
        let new_axis = unit(sub(qb, qa))
            .filter(|_| (tb - ta).abs() > 1e-6)
            .map(|u| if tb > ta { u } else { u.map(|x| -x) })
            .ok_or_else(|| format!("pose: {from} and {to} coincide"))?;
        let origin = [0, 1, 2].map(|k| qa[k] - ta * new_axis[k]);
        let zero = across(ma.dir(dir(a.zero)), new_axis)
            .ok_or("pose: a region's zero direction lies along its axis")?;
        Ok(Region::Axis(vitryne_format::AxisRegion {
            origin: to_mm(origin),
            axis: to_dir(new_axis),
            zero: to_dir(zero),
            other: a.other.clone(),
        }))
    }

    fn region(&self, name: &str, r: &Region) -> Result<Region, String> {
        let side = |s: &str| match s {
            "left" => "L",
            _ => "R",
        };
        match r {
            Region::Path(p) => Ok(Region::Path(self.path(p)?)),
            Region::Axis(a) => match name {
                "head" | "head-over" => self.on_bone(a, "head"),
                "torso" => self.between(a, "root", "neck01"),
                n => match n.rsplit_once('-') {
                    Some(("leg", s)) => {
                        let l = side(s);
                        self.between(a, &format!("upperleg01.{l}"), &format!("foot.{l}"))
                    }
                    Some(("upper-arm" | "arm-straight", s)) => {
                        self.on_bone(a, &format!("upperarm01.{}", side(s)))
                    }
                    // A region this does not know stays where it was.
                    _ => Ok(r.clone()),
                },
            },
        }
    }
}

/// `regions` after `turns` (a project's pose: a unit quaternion per joint name) on `skin`.
pub fn pose_regions(
    regions: &BTreeMap<String, Region>,
    skin: &Skin,
    turns: &BTreeMap<String, Quat>,
) -> Result<BTreeMap<String, Region>, String> {
    let pose = skin.rotations(turns)?;
    let rig = Rig { skin, pose: &pose };
    regions
        .iter()
        .map(|(k, r)| Ok((k.clone(), rig.region(k, r)?)))
        .collect()
}

/// The document with the project avatar's regions in the project's pose, or the document
/// itself without a pose. Only for resolving wraps in 3D: the file keeps its regions at rest.
pub fn with_posed_regions(doc: &Document) -> Result<std::borrow::Cow<'_, Document>, String> {
    use std::borrow::Cow;
    let (Some(pose), Some(avatar)) = (doc.project_pose(), doc.project_avatar()) else {
        return Ok(Cow::Borrowed(doc));
    };
    let file = doc
        .files
        .get(&avatar.mesh)
        .ok_or_else(|| format!("avatar mesh {} missing", avatar.mesh))?;
    let mesh = glb::read(&file.bytes).map_err(|e| format!("{}: {e}", avatar.mesh))?;
    let skin = mesh
        .skin
        .ok_or_else(|| format!("{}: the pose needs a skeleton", avatar.mesh))?;
    let turns = pose.joints.iter().map(|(k, q)| (k.clone(), *q)).collect();
    let posed = pose_regions(&avatar.regions, &skin, &turns)?;
    let mut out = doc.clone();
    let id = avatar.id.clone();
    if let Some(a) = out.avatars.iter_mut().find(|a| a.id == id) {
        a.regions = posed;
    }
    Ok(Cow::Owned(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use vitryne_format::{Avatar, skin::axis_angle};

    fn body(slug: &str) -> (Avatar, Skin, Vec<[f32; 3]>) {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../../../assets/bodies/{slug}"));
        let avatar: Avatar =
            serde_json::from_str(&std::fs::read_to_string(dir.join("avatar.json")).unwrap())
                .unwrap();
        let mesh = glb::read(&std::fs::read(dir.join("body.glb")).unwrap()).unwrap();
        (avatar, mesh.skin.unwrap(), mesh.positions)
    }

    fn turn(joint: &str, axis: [f32; 3], deg: f32) -> BTreeMap<String, Quat> {
        [(joint.to_string(), axis_angle(axis, deg.to_radians()))].into()
    }

    fn near(a: Vec3, b: Vec3, tol: f64) -> bool {
        (0..3).all(|k| (a[k] - b[k]).abs() <= tol)
    }

    fn length(points: &[Vec3]) -> f64 {
        points
            .windows(2)
            .map(|w| {
                (0..3)
                    .map(|k| (w[0][k] - w[1][k]).powi(2))
                    .sum::<f64>()
                    .sqrt()
            })
            .sum()
    }

    /// No turns: every region is where it was (to the file's micrometre).
    #[test]
    fn the_rest_pose_moves_no_region() {
        for slug in ["male-average", "female-slim"] {
            let (avatar, skin, _) = body(slug);
            let posed = pose_regions(&avatar.regions, &skin, &BTreeMap::new()).unwrap();
            for (name, r) in &avatar.regions {
                match (r, &posed[name]) {
                    (Region::Path(a), Region::Path(b)) => {
                        assert!(
                            a.points
                                .iter()
                                .zip(&b.points)
                                .all(|(p, q)| near(*p, *q, 0.5))
                        );
                    }
                    (Region::Axis(a), Region::Axis(b)) => {
                        // The joints are not exactly on the stored axes (sub-millimetre).
                        assert!(near(a.origin, b.origin, 0.5), "{slug} {name}");
                        assert!(near(a.axis, b.axis, 1e-3), "{slug} {name}");
                        // `zero` is only a hint: the frame uses the part across the axis.
                        let (za, zb) = (
                            across(dir(a.zero), dir(a.axis)),
                            across(dir(b.zero), dir(b.axis)),
                        );
                        assert!(
                            za.zip(zb).is_some_and(|(x, y)| dot(x, y) > 0.999),
                            "{slug} {name}"
                        );
                    }
                    _ => panic!("{name} changed kind"),
                }
            }
        }
    }

    /// An arm raised: the left arm's centreline goes with the arm and keeps its length; the
    /// other side, the torso and the head do not move.
    #[test]
    fn a_raised_arm_takes_its_regions_along() {
        let (avatar, skin, verts) = body("male-average");
        let turns = turn("upperarm01.L", [0.0, 0.0, 1.0], 70.0);
        let posed = pose_regions(&avatar.regions, &skin, &turns).unwrap();
        let pts = |r: &Region| match r {
            Region::Path(p) => p.points.clone(),
            _ => panic!(),
        };
        let (rest, now) = (pts(&avatar.regions["arm-left"]), pts(&posed["arm-left"]));
        assert!(near(rest[0], now[0], 0.5), "the shoulder is the pivot");
        assert!(!near(rest[4], now[4], 100.0), "the wrist moved");
        let drift = (length(&now) - length(&rest)).abs() / length(&rest);
        assert!(drift < 0.02, "the arm keeps its length: {drift}");
        assert_eq!(avatar.regions["arm-right"], posed["arm-right"]);
        for still in ["head", "head-over", "torso"] {
            let (Region::Axis(a), Region::Axis(b)) = (&avatar.regions[still], &posed[still]) else {
                panic!()
            };
            assert!(
                near(a.origin, b.origin, 0.5) && near(a.axis, b.axis, 1e-3),
                "{still}"
            );
        }
        // The centreline stays inside the posed arm: each point keeps its distance to the
        // nearest vertex of the posed body (within 15 mm of what it was at rest).
        let moved = skin.pose(&verts, &skin.rotations(&turns).unwrap());
        let nearest = |vs: &[[f32; 3]], p: Vec3| {
            vs.iter()
                .map(|v| {
                    (0..3)
                        .map(|k| (v[k] as f64 * 1000.0 - p[k]).powi(2))
                        .sum::<f64>()
                        .sqrt()
                })
                .fold(f64::MAX, f64::min)
        };
        for (r, n) in rest.iter().zip(&now) {
            let (d0, d1) = (nearest(&verts, *r), nearest(&moved, *n));
            assert!((d0 - d1).abs() < 15.0, "{d0} mm at rest, {d1} mm posed");
        }
    }

    /// Leaning forward tilts the torso's axis the same way and swings a leg's about the hip.
    #[test]
    fn a_lean_and_a_step_tilt_the_axes() {
        let (avatar, skin, _) = body("male-average");
        let lean = pose_regions(
            &avatar.regions,
            &skin,
            &turn("spine03", [1.0, 0.0, 0.0], 30.0),
        )
        .unwrap();
        let Region::Axis(t) = &lean["torso"] else {
            panic!()
        };
        // Facing +Z, bending forward with a turn about +X: the top goes towards +Z.
        assert!(t.axis[2] > 0.1 && t.axis[1] > 0.9, "{:?}", t.axis);
        let step = pose_regions(
            &avatar.regions,
            &skin,
            &turn("upperleg01.L", [1.0, 0.0, 0.0], -30.0),
        )
        .unwrap();
        let (Region::Axis(a), Region::Axis(b)) = (&avatar.regions["leg-left"], &step["leg-left"])
        else {
            panic!()
        };
        assert!(
            (a.axis[2] - b.axis[2]).abs() > 0.1,
            "{:?} {:?}",
            a.axis,
            b.axis
        );
        let (Region::Axis(a), Region::Axis(b)) = (&avatar.regions["leg-right"], &step["leg-right"])
        else {
            panic!()
        };
        assert!(near(a.origin, b.origin, 0.5) && near(a.axis, b.axis, 1e-3));
    }

    #[test]
    fn a_skeleton_without_the_joints_is_refused() {
        let (avatar, mut skin, _) = body("male-average");
        for j in &mut skin.joints {
            j.name = j.name.replace("neck01", "neck");
        }
        let e = pose_regions(&avatar.regions, &skin, &BTreeMap::new()).unwrap_err();
        assert!(e.contains("neck01"), "{e}");
    }
}
