// SPDX-License-Identifier: AGPL-3.0-or-later
//! Initial placement (FORMAT.md, Placement): each panel is wrapped on a cylinder around one of
//! the avatar's regions, before sewing pulls it into place. Pieces are drawn as seen from
//! outside, right side up, so the piece's x runs around the cylinder and its y along the axis.
//!
//! Regions come from the avatar (`avatar.json` `regions`, mm). The test avatar's are in
//! assets/body/avatar.json, which the garment.toml path uses too (its frame names map onto
//! region names, `sidecar_region`).

use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

use glam::{Vec2, Vec3};
use serde::{Deserialize, Serialize};
use vitryne_format::{Avatar, Region, Wrap};

use crate::{meshing::MeshedPattern, pattern::Pattern};

/// A body frame: origin, axis (towards the top of the pieces), and the angle-0 direction.
/// A bent frame also has a centreline below the origin (dense samples, see `bent`).
#[derive(Debug, Clone)]
pub struct Frame {
    o: Vec3,
    a: Vec3,
    e0: Vec3,
    path: Option<Arc<Vec<PathSample>>>,
}

/// One sample of a bent frame's centreline, every `PATH_STEP` along it from the origin.
#[derive(Debug, Clone, Copy)]
struct PathSample {
    c: Vec3,
    /// Axis (towards the origin) and angle-0 direction, parallel-transported along the path.
    a: Vec3,
    e0: Vec3,
}

const PATH_STEP: f32 = 0.005;

fn metres(p: [f64; 3]) -> Vec3 {
    Vec3::new(
        (p[0] / 1000.0) as f32,
        (p[1] / 1000.0) as f32,
        (p[2] / 1000.0) as f32,
    )
}

fn direction(p: [f64; 3]) -> Vec3 {
    Vec3::new(p[0] as f32, p[1] as f32, p[2] as f32)
}

impl Frame {
    fn new(o: Vec3, a: Vec3, up_hint: Vec3) -> Self {
        let a = a.normalize();
        let e0 = (up_hint - up_hint.dot(a) * a).normalize();
        Self {
            o,
            a,
            e0,
            path: None,
        }
    }

    /// A frame whose axis follows `pts` (first = origin) below the origin, as a Catmull-Rom
    /// curve, and continues straight past the last point; straight above the origin.
    fn bent(pts: &[Vec3], up_hint: Vec3) -> Self {
        let mut f = Self::new(pts[0], pts[0] - pts[1], up_hint);
        let p = |i: isize| pts[i.clamp(0, pts.len() as isize - 1) as usize];
        let mut dense = vec![pts[0]];
        for i in 0..pts.len() as isize - 1 {
            let (p0, p1, p2, p3) = (p(i - 1), p(i), p(i + 1), p(i + 2));
            for k in 1..=20 {
                let t = k as f32 / 20.0;
                let (t2, t3) = (t * t, t * t * t);
                dense.push(
                    0.5 * (2.0 * p1
                        + (p2 - p0) * t
                        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                        + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3),
                );
            }
        }
        let tail = (pts[pts.len() - 1] - pts[pts.len() - 2]).normalize();
        dense.push(pts[pts.len() - 1] + tail * 0.3);
        // Resample at PATH_STEP by arc length, transporting e0 (project the previous e0 onto
        // the new normal plane; turns are gentle, so this is close to parallel transport).
        let mut out = vec![PathSample {
            c: f.o,
            a: f.a,
            e0: f.e0,
        }];
        let (mut seg, mut u, mut left) = (0usize, 0.0f32, PATH_STEP);
        while seg + 1 < dense.len() {
            let (a, b) = (dense[seg], dense[seg + 1]);
            let l = a.distance(b);
            if (1.0 - u) * l >= left {
                u += left / l;
                left = PATH_STEP;
                let c = a.lerp(b, u);
                let ax = (a - b).normalize();
                let pe = out.last().unwrap().e0;
                out.push(PathSample {
                    c,
                    a: ax,
                    e0: (pe - pe.dot(ax) * ax).normalize(),
                });
            } else {
                left -= (1.0 - u) * l;
                seg += 1;
                u = 0.0;
            }
        }
        f.path = Some(Arc::new(out));
        f
    }

    /// The frame of an avatar region (positions in mm).
    pub fn from_region(r: &Region) -> Result<Self, String> {
        match r {
            Region::Axis(a) => Ok(Self::new(
                metres(a.origin),
                direction(a.axis),
                direction(a.zero),
            )),
            Region::Path(p) if p.points.len() >= 2 => {
                let pts: Vec<Vec3> = p.points.iter().map(|&q| metres(q)).collect();
                Ok(Self::bent(&pts, direction(p.zero)))
            }
            Region::Path(_) => Err("a path region needs two points".into()),
        }
    }

    pub fn origin(&self) -> Vec3 {
        self.o
    }

    /// The point at (angle, radius, along) and the directions it moves in when each of them
    /// grows (unit vectors): around the axis, along it, away from it.
    pub fn basis(&self, angle: f32, radius: f32, along: f32) -> Basis {
        let (c, a, e0) = match &self.path {
            Some(path) if along < 0.0 => {
                let x = -along / PATH_STEP;
                let k = (x.floor() as usize).min(path.len() - 2);
                let u = (x - k as f32).min(1.0);
                let (s0, s1) = (path[k], path[k + 1]);
                (
                    s0.c.lerp(s1.c, u),
                    s0.a.lerp(s1.a, u).normalize(),
                    s0.e0.lerp(s1.e0, u).normalize(),
                )
            }
            _ => (self.o + along * self.a, self.a, self.e0),
        };
        let e1 = a.cross(e0);
        let out = angle.cos() * e0 + angle.sin() * e1;
        Basis {
            point: c + radius * out,
            around: angle.cos() * e1 - angle.sin() * e0,
            along: a,
            out,
        }
    }
}

/// See `Frame::basis`.
#[derive(Debug, Clone, Copy)]
pub struct Basis {
    pub point: Vec3,
    pub around: Vec3,
    pub along: Vec3,
    pub out: Vec3,
}

/// The test avatar (MakeHuman base mesh, assets/body/): its entity as it goes into a project,
/// with the regions measured on the mesh (assets/body/README.md). Its mesh is
/// assets/body/makehuman_body_m.obj.
pub fn default_avatar() -> &'static Avatar {
    static AVATAR: OnceLock<Avatar> = OnceLock::new();
    AVATAR.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../assets/body/avatar.json"))
            .expect("assets/body/avatar.json")
    })
}

/// garment.toml frame names, mapped to the region vocabulary (FORMAT.md, Regions).
pub const SIDECAR_REGIONS: [(&str, &str); 11] = [
    ("torso", "torso"),
    ("head", "head"),
    ("head_over", "head-over"),
    ("arm_l", "upper-arm-left"),
    ("arm_r", "upper-arm-right"),
    ("bentarm_l", "arm-left"),
    ("bentarm_r", "arm-right"),
    ("longarm_l", "arm-straight-left"),
    ("longarm_r", "arm-straight-right"),
    ("leg_l", "leg-left"),
    ("leg_r", "leg-right"),
];

pub fn sidecar_region(frame: &str) -> Result<&'static str, String> {
    SIDECAR_REGIONS
        .iter()
        .find(|(f, _)| *f == frame)
        .map(|(_, r)| *r)
        .ok_or_else(|| {
            format!(
                "unknown frame {frame} ({})",
                SIDECAR_REGIONS.map(|(f, _)| f).join(" | ")
            )
        })
}

pub fn region_frame(regions: &BTreeMap<String, Region>, name: &str) -> Result<Frame, String> {
    let r = regions
        .get(name)
        .ok_or_else(|| format!("the avatar has no region {name:?}"))?;
    Frame::from_region(r).map_err(|e| format!("region {name}: {e}"))
}

/// Where one panel goes (angles in radians, lengths in metres).
#[derive(Debug, Clone)]
pub enum PlaceSpec {
    Wrap {
        frame: Frame,
        angle: f32,
        radius: f32,
        top: f32,
        /// Tube ease (long sleeves), see `tube_profile`.
        tube: Option<f32>,
    },
    /// On top of panel `of`: its frame, anchor, top and tube profile, at its radius + `lift`,
    /// at its angle unless `angle` is given.
    Follow {
        of: usize,
        angle: Option<f32>,
        lift: f32,
    },
}

/// Wraps every panel (`specs[i]` for panel i) onto its cylinder: a point p of the pattern goes
/// to `frame.at(top + (p - anchor).y)` at angle `angle + (p - anchor).x / r` and radius r,
/// where the anchor is the centre of the panel's bounding box in x and its top in y.
pub fn place(mp: &mut MeshedPattern, pat: &Pattern, specs: &[PlaceSpec]) -> Result<(), String> {
    let outlines: Vec<Vec<Vec2>> = pat.panels.iter().map(|p| p.outline()).collect();
    let names: Vec<&str> = pat.panels.iter().map(|p| p.name.as_str()).collect();
    let resolved = resolve_all(&outlines, &names, specs)?;
    mp.mesh.pos = positions(&mp.uv, &mp.panel_vertices, &resolved);
    for (pi, r) in resolved.iter().enumerate() {
        // Render-only: front faces point away from the axis (mirrored pieces flip winding).
        let f = &r.frame;
        let score: f32 = mp.mesh.tris[mp.panel_tris[pi].clone()]
            .iter()
            .map(|t| {
                let [a, b, c] = t.map(|k| mp.mesh.pos[k as usize]);
                let q = (a + b + c) / 3.0 - f.o;
                (b - a).cross(c - a).dot(q - q.dot(f.a) * f.a)
            })
            .sum();
        if score < 0.0 {
            for t in &mut mp.mesh.tris[mp.panel_tris[pi].clone()] {
                t.swap(1, 2);
            }
        }
    }
    Ok(())
}

/// Each panel's wrap, with `follow`s resolved (`outlines`: each panel's, in its pattern
/// coordinates; `names` for errors).
pub fn resolve_all(
    outlines: &[Vec<Vec2>],
    names: &[&str],
    specs: &[PlaceSpec],
) -> Result<Vec<Resolved>, String> {
    fn resolve(
        i: usize,
        outlines: &[Vec<Vec2>],
        names: &[&str],
        specs: &[PlaceSpec],
        done: &mut Vec<Option<Resolved>>,
        visiting: &mut Vec<bool>,
    ) -> Result<Resolved, String> {
        if let Some(r) = &done[i] {
            return Ok(r.clone());
        }
        if visiting[i] {
            return Err(format!("{}: its placement follows itself", names[i]));
        }
        visiting[i] = true;
        let outline = &outlines[i];
        let (lo, hi) = outline.iter().fold(
            (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)),
            |(lo, hi), q| (lo.min(*q), hi.max(*q)),
        );
        let r = match &specs[i] {
            PlaceSpec::Follow { of, angle, lift } => {
                let base = resolve(*of, outlines, names, specs, done, visiting)?;
                Resolved {
                    angle: angle.unwrap_or(base.angle),
                    radius: base.radius + lift,
                    ..base
                }
            }
            PlaceSpec::Wrap {
                frame,
                angle,
                radius,
                top,
                tube,
            } => Resolved {
                frame: frame.clone(),
                angle: *angle,
                radius: *radius,
                top: *top,
                anchor: Vec2::new(0.5 * (lo.x + hi.x), hi.y),
                tube: tube.map(|ease| tube_profile(outline, lo.y, hi.y, ease, *radius)),
            },
        };
        done[i] = Some(r.clone());
        Ok(r)
    }
    let mut done = vec![None; specs.len()];
    let mut visiting = vec![false; specs.len()];
    (0..specs.len())
        .map(|i| resolve(i, outlines, names, specs, &mut done, &mut visiting))
        .collect()
}

/// Where every vertex goes (`uv`: its pattern coordinates; `panel_vertices`: each panel's).
pub fn positions(
    uv: &[Vec2],
    panel_vertices: &[std::ops::Range<u32>],
    resolved: &[Resolved],
) -> Vec<Vec3> {
    let mut pos = vec![Vec3::ZERO; uv.len()];
    for (r, range) in resolved.iter().zip(panel_vertices) {
        for v in range.clone() {
            pos[v as usize] = r.at(uv[v as usize]);
        }
    }
    pos
}

/// One panel's wrap, resolved (see `place`).
#[derive(Clone)]
pub struct Resolved {
    frame: Frame,
    angle: f32,
    radius: f32,
    top: f32,
    anchor: Vec2,
    /// Tube radius by pattern y (lo, step, radii); None = constant `radius`.
    tube: Option<(f32, f32, Vec<f32>)>,
}

impl Resolved {
    /// The cylinder's radius at pattern height `y` (the tube's, or the wrap's).
    pub fn radius_at(&self, y: f32) -> f32 {
        match &self.tube {
            Some((lo, step, radii)) => {
                let x = ((y - lo) / step).clamp(0.0, (radii.len() - 1) as f32);
                let k = (x.floor() as usize).min(radii.len() - 2);
                radii[k] + (radii[k + 1] - radii[k]) * (x - k as f32)
            }
            None => self.radius,
        }
    }

    /// Where pattern point `p` goes.
    pub fn at(&self, p: Vec2) -> Vec3 {
        self.basis_at(p).point
    }

    /// Where pattern point `p` goes, and how it moves with the wrap's angle, top and radius
    /// (for the editor's gizmo).
    pub fn basis_at(&self, p: Vec2) -> Basis {
        let q = p - self.anchor;
        let radius = self.radius_at(p.y);
        self.frame
            .basis(self.angle + q.x / radius, radius, self.top + q.y)
    }

    pub fn anchor(&self) -> Vec2 {
        self.anchor
    }
}

/// Tube radius along a piece (see `Wrap::tube`): `ease` x width / 2 pi below the widest row,
/// then linear up to `top_radius` at the top edge. Returns (lo y, step, radius per step).
fn tube_profile(
    outline: &[Vec2],
    lo: f32,
    hi: f32,
    ease: f32,
    top_radius: f32,
) -> (f32, f32, Vec<f32>) {
    let n = 200;
    let step = (hi - lo) / n as f32;
    let width = |y: f32| {
        let xs: Vec<f32> = (0..outline.len())
            .filter_map(|i| {
                let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
                ((a.y - y) * (b.y - y) < 0.0).then(|| a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x))
            })
            .collect();
        xs.iter().cloned().fold(f32::MIN, f32::max) - xs.iter().cloned().fold(f32::MAX, f32::min)
    };
    let w: Vec<f32> = (0..=n)
        .map(|k| width(lo + (k as f32 + 0.5).min(n as f32 - 0.5) * step).max(0.0))
        .collect();
    let widest = (0..=n).max_by(|&i, &j| w[i].total_cmp(&w[j])).unwrap();
    let r_wide = ease * w[widest] / std::f32::consts::TAU;
    let radii = (0..=n)
        .map(|k| {
            if k <= widest {
                ease * w[k] / std::f32::consts::TAU
            } else {
                r_wide + (top_radius - r_wide) * (k - widest) as f32 / (n - widest) as f32
            }
        })
        .collect();
    (lo, step, radii)
}

// ---- the editor's places (docs/ARCHITECTURE.md, Placement) --------------------------------

/// Where the editor offers to start a cut, as people say it: a region and a side of it. Each
/// is a region name and an angle; `auto_wrap` works out the rest. "Left" is the wearer's left.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BodyPlace {
    BodyFront,
    BodyBack,
    BodyLeft,
    BodyRight,
    ArmLeft,
    ArmRight,
    LegLeftFront,
    LegLeftBack,
    LegRightFront,
    LegRightBack,
    HeadLeft,
    HeadRight,
    OverHead,
}

/// Room around the piece's own circumference (a garment is looser than the body).
const EASE: f32 = 1.15;
/// The same for a sleeve's tube (`Wrap::tube`), as the file stores it.
const TUBE_EASE: f64 = 1.15;
/// The least gap between the cylinder and the body where it's measured, m.
const CLEARANCE: f32 = 0.02;
/// Heights as fractions of the avatar's height (standing, feet at y = 0), after the usual body
/// proportions: the base of the neck (where a top's neckline sits), the waist (a waistband),
/// the chin (the head is what's above it).
const NECK_BASE: f32 = 0.86;
const WAIST: f32 = 0.65;
const CHIN: f32 = 0.87;
/// A hood's top edge goes this far above the head, m.
const HOOD_ABOVE: f32 = 0.03;

impl BodyPlace {
    pub fn region(self) -> &'static str {
        use BodyPlace::*;
        match self {
            BodyFront | BodyBack | BodyLeft | BodyRight => "torso",
            ArmLeft => "arm-left",
            ArmRight => "arm-right",
            LegLeftFront | LegLeftBack => "leg-left",
            LegRightFront | LegRightBack => "leg-right",
            HeadLeft | HeadRight => "head",
            OverHead => "head-over",
        }
    }

    /// Radians from the region's zero direction (torso, legs, head: the front; arms, over the
    /// head: the top), towards the wearer's left.
    pub fn angle(self) -> f64 {
        use BodyPlace::*;
        use std::f64::consts::{FRAC_PI_2, PI};
        match self {
            BodyBack | LegLeftBack | LegRightBack => PI,
            BodyLeft | HeadLeft => FRAC_PI_2,
            BodyRight | HeadRight => -FRAC_PI_2,
            _ => 0.0,
        }
    }
}

/// What `auto_wrap` needs to know about the avatar, measured once from its mesh (m).
#[derive(Debug, Clone, Copy)]
pub struct BodyFacts {
    pub height: f32,
    /// Farthest point of the head (above the chin) from the head axis, and from the over-the-
    /// head axis.
    pub head: f32,
    pub over_head: f32,
    /// The shoulder joints' distance from the torso axis (the widest the torso gets, arms
    /// aside); None without arm regions.
    pub shoulders: Option<f32>,
}

fn axis_distance(p: Vec3, o: Vec3, a: Vec3) -> f32 {
    let d = p - o;
    (d - d.dot(a) * a).length()
}

impl BodyFacts {
    pub fn measure(body: &[Vec3], regions: &BTreeMap<String, Region>) -> Result<Self, String> {
        let height = body.iter().map(|p| p.y).fold(0.0, f32::max);
        if height <= 0.0 {
            return Err("the avatar's mesh has no height".into());
        }
        let farthest = |name: &str| -> Result<f32, String> {
            let f = region_frame(regions, name)?;
            Ok(body
                .iter()
                .filter(|p| p.y > CHIN * height)
                .map(|&p| axis_distance(p, f.o, f.a))
                .fold(0.0, f32::max))
        };
        let shoulders = region_frame(regions, "upper-arm-left")
            .ok()
            .and_then(|arm| {
                let t = region_frame(regions, "torso").ok()?;
                Some(axis_distance(arm.o, t.o, t.a))
            });
        Ok(Self {
            height,
            head: farthest("head").unwrap_or(0.0),
            over_head: farthest("head-over").unwrap_or(0.0),
            shoulders,
        })
    }
}

/// The starting wrap for a piece at `place` (docs/ARCHITECTURE.md, Placement): the cylinder
/// is the piece's own circumference with some ease (a front and a back each make half of it, a
/// sleeve all of it), never closer to the body than `CLEARANCE` where the body is measured;
/// the top edge goes where that kind of piece usually starts (the base of the neck, the waist,
/// above the head, the shoulder joint). `outline`: the piece in its cut's frame (mirrored and
/// rotated), m. Lengths in the result are whole mm.
pub fn auto_wrap(
    place: BodyPlace,
    outline: &[Vec2],
    regions: &BTreeMap<String, Region>,
    facts: &BodyFacts,
) -> Result<Wrap, String> {
    use BodyPlace::*;
    use std::f32::consts::PI;
    let region = place.region();
    let f = region_frame(regions, region)?;
    let (lo, hi) = outline.iter().fold(
        (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)),
        |(lo, hi), q| (lo.min(*q), hi.max(*q)),
    );
    let (w, h) = (hi.x - lo.x, hi.y - lo.y);
    if !(w > 0.0 && h > 0.0) {
        return Err("the piece has no area".into());
    }
    let half = EASE * w / PI;
    let height = facts.height;
    // Along the axis to where it reaches height `y` (torso, head and legs rise with y).
    let at_height = |y: f32| -> Result<f32, String> {
        if f.a.y.abs() < 0.1 {
            return Err(format!("region {region} doesn't rise"));
        }
        Ok((y - f.o.y) / f.a.y)
    };
    let (radius, top, tube) = match place {
        BodyFront | BodyBack | BodyLeft | BodyRight => (
            half.max(facts.shoulders.unwrap_or(0.11 * height) + CLEARANCE),
            at_height(NECK_BASE * height)?,
            None,
        ),
        // The tube follows the sleeve's width; its top radius is the widest row's.
        ArmLeft | ArmRight => (EASE * w / (2.0 * PI), 0.0, Some(TUBE_EASE)),
        LegLeftFront | LegLeftBack | LegRightFront | LegRightBack => {
            (half, at_height(WAIST * height)?, None)
        }
        HeadLeft | HeadRight => (
            half.max(facts.head + CLEARANCE),
            at_height(height + HOOD_ABOVE)?,
            None,
        ),
        // A strip over the head, centred on the axis.
        OverHead => (half.max(facts.over_head + CLEARANCE), h / 2.0, None),
    };
    let whole_mm = |x: f32| (x as f64 * 1000.0).round() + 0.0;
    Ok(Wrap {
        region: region.to_string(),
        angle: place.angle(),
        radius: whole_mm(radius),
        top: whole_mm(top),
        rotation: None,
        tube,
        other: Default::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The regions moved from code (`Frame::named`, measured on the MakeHuman mesh) into
    /// assets/body/avatar.json; the numbers must be the same.
    #[test]
    fn avatar_regions_match_the_old_frames() {
        let regions = &default_avatar().regions;
        let f = region_frame(regions, "upper-arm-right").unwrap();
        let old = Frame::new(
            Vec3::new(-0.182, 1.36, 0.006),
            -Vec3::new(-0.544, -0.837, 0.061),
            Vec3::Y,
        );
        assert_eq!((f.o, f.a, f.e0), (old.o, old.a, old.e0));
        let bent = region_frame(regions, "arm-left").unwrap();
        let old = Frame::bent(
            &[
                [0.182, 1.36, 0.006],
                [0.297, 1.179, 0.012],
                [0.335, 1.143, 0.048],
                [0.366, 1.113, 0.090],
                [0.428, 1.058, 0.177],
            ]
            .map(|[x, y, z]| Vec3::new(x, y, z)),
            Vec3::Y,
        );
        let (p, q) = (bent.path.unwrap(), old.path.unwrap());
        assert_eq!(p.len(), q.len());
        assert!(
            p.iter()
                .zip(q.iter())
                .all(|(a, b)| a.c == b.c && a.e0 == b.e0)
        );
        for (frame, region) in SIDECAR_REGIONS {
            assert!(regions.contains_key(region), "{frame} -> {region}");
        }
        assert_eq!(regions.len(), SIDECAR_REGIONS.len());
    }
}
