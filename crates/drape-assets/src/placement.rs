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
use vitryne_format::{Avatar, Region};

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

    fn place(&self, angle: f32, radius: f32, along: f32) -> Vec3 {
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
        c + radius * (angle.cos() * e0 + angle.sin() * e1)
    }
}

/// The test avatar (MakeHuman base mesh, assets/body/): its entity as it goes into a project,
/// with the regions measured on the mesh (assets/body/README.md). Its mesh is
/// assets/body/makehuman_body_m.obj.
pub fn default_avatar() -> &'static Avatar {
    static AVATAR: OnceLock<Avatar> = OnceLock::new();
    AVATAR.get_or_init(|| {
        serde_json::from_str(include_str!("../../../assets/body/avatar.json"))
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

#[derive(Clone)]
struct Resolved {
    frame: Frame,
    angle: f32,
    radius: f32,
    top: f32,
    anchor: Vec2,
    /// Tube radius by pattern y (lo, step, radii); None = constant `radius`.
    tube: Option<(f32, f32, Vec<f32>)>,
}

/// Wraps every panel (`specs[i]` for panel i) onto its cylinder: a point p of the pattern goes
/// to `frame.at(top + (p - anchor).y)` at angle `angle + (p - anchor).x / r` and radius r,
/// where the anchor is the centre of the panel's bounding box in x and its top in y.
pub fn place(mp: &mut MeshedPattern, pat: &Pattern, specs: &[PlaceSpec]) -> Result<(), String> {
    fn resolve(
        i: usize,
        pat: &Pattern,
        specs: &[PlaceSpec],
        done: &mut Vec<Option<Resolved>>,
        visiting: &mut Vec<bool>,
    ) -> Result<Resolved, String> {
        if let Some(r) = &done[i] {
            return Ok(r.clone());
        }
        if visiting[i] {
            return Err(format!(
                "{}: its placement follows itself",
                pat.panels[i].name
            ));
        }
        visiting[i] = true;
        let outline = pat.panels[i].outline();
        let (lo, hi) = outline.iter().fold(
            (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)),
            |(lo, hi), q| (lo.min(*q), hi.max(*q)),
        );
        let r = match &specs[i] {
            PlaceSpec::Follow { of, angle, lift } => {
                let base = resolve(*of, pat, specs, done, visiting)?;
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
                tube: tube.map(|ease| tube_profile(&outline, lo.y, hi.y, ease, *radius)),
            },
        };
        done[i] = Some(r.clone());
        Ok(r)
    }
    let mut done = vec![None; specs.len()];
    let mut visiting = vec![false; specs.len()];
    for pi in 0..specs.len() {
        let r = resolve(pi, pat, specs, &mut done, &mut visiting)?;
        for v in mp.panel_vertices[pi].clone() {
            let q = mp.uv[v as usize] - r.anchor;
            let radius = match &r.tube {
                Some((lo, step, radii)) => {
                    let x =
                        ((mp.uv[v as usize].y - lo) / step).clamp(0.0, (radii.len() - 1) as f32);
                    let k = (x.floor() as usize).min(radii.len() - 2);
                    radii[k] + (radii[k + 1] - radii[k]) * (x - k as f32)
                }
                None => r.radius,
            };
            mp.mesh.pos[v as usize] = r.frame.place(r.angle + q.x / radius, radius, r.top + q.y);
        }
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
