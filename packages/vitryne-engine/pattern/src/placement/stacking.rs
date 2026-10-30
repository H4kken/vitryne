// SPDX-License-Identifier: AGPL-3.0-or-later
//! The stack of cuts (file-format.md, The stack): where cuts overlap on the body, the one higher in
//! the stack starts further out. Cuts are resolved from the bottom of the stack up; each is
//! sampled over its outline, and pushed out (its radius grows by one amount along the whole cut)
//! until it is a gap past every cut below it that it overlaps.
//!
//! A point overlaps a cut below it when it lies inside that cut's own area: in the same body
//! region at any radius (a coat starts inside a shirt and is pushed out past it), in another
//! region only within a gap and a half of its surface and facing the same way. Two cuts that only meet along an edge,
//! like the front panels of two trouser legs, overlap nothing. Overlap is judged on the cut at
//! its own start, before it is pushed, so pushing it never changes what it overlaps and one pass
//! settles the stack.

use glam::{Vec2, Vec3};

use super::{Frame, PlaceSpec, Resolved};

/// The least gap between layers, m: what the editor lifts a piece "on top of" another.
pub const MIN_GAP: f32 = 0.012;
/// Spacing of the samples over a cut, m.
const SPACING: f32 = 0.012;
/// Surfaces in different regions only overlap where they face within this cosine of each other:
/// layers lie along one another, while two cylinders that cross each other do not.
const FACING: f32 = 0.7;
/// A cut has at most this many samples (a huge piece gets coarser ones).
const MAX_SAMPLES: usize = 6000;

/// The gap between layers for a mesh of triangles `edge` long (m): the cloth repels itself a
/// little less than one edge away, so layers start clear of that.
pub fn gap_for(edge: f32) -> f32 {
    edge.max(MIN_GAP)
}

/// Which cut is outside which (`order`: every cut's index, closest to the body first) and the
/// gap between layers, m.
#[derive(Debug, Clone)]
pub struct Stacking {
    pub order: Vec<usize>,
    pub gap: f32,
}

impl Stacking {
    /// `order` as every cut `0..n` once: what it lists (a cut that doesn't exist or comes twice
    /// is skipped), then the cuts it left out in their own order.
    pub fn complete(&self, n: usize) -> Vec<usize> {
        let mut seen = vec![false; n];
        let mut out: Vec<usize> = self
            .order
            .iter()
            .copied()
            .filter(|&i| i < n && !std::mem::replace(&mut seen[i], true))
            .collect();
        out.extend((0..n).filter(|&i| !seen[i]));
        out
    }
}

/// The order a garment's cuts start in when nothing says otherwise: by the radius each starts at
/// (a `Follow` at its cut's radius plus lift), ties in cut order, a cut that goes on another
/// never before it. `vitryne_format::Garment::default_stack` and the version 4 migration make
/// the same order.
pub fn default_order(specs: &[PlaceSpec]) -> Vec<usize> {
    let radius = |start: usize| {
        let (mut i, mut sum) = (start, 0.0);
        for _ in 0..=specs.len() {
            match &specs[i] {
                PlaceSpec::Wrap { radius, .. } => return sum + radius,
                PlaceSpec::Follow { of, lift, .. } => {
                    sum += lift;
                    i = *of;
                }
            }
        }
        sum
    };
    let mut left: Vec<usize> = (0..specs.len()).collect();
    left.sort_by(|&a, &b| radius(a).total_cmp(&radius(b)).then(a.cmp(&b)));
    let mut out: Vec<usize> = Vec::with_capacity(left.len());
    while !left.is_empty() {
        let ready = left.iter().position(|&i| match &specs[i] {
            PlaceSpec::Follow { of, .. } => out.contains(of),
            PlaceSpec::Wrap { .. } => true,
        });
        out.push(left.remove(ready.unwrap_or(0)));
    }
    out
}

/// A point of a cut as it starts.
#[derive(Debug, Clone, Copy)]
struct Sample {
    pos: Vec3,
    out: Vec3,
    /// Around the axis, radians in [-pi, pi), and along it, m.
    theta: f32,
    z: f32,
    /// The cylinder's radius here, m.
    radius: f32,
}

/// A cut placed: where it is and the outline it covers.
struct Placed {
    cut: usize,
    frame: u32,
    r: Resolved,
    outline: Vec<Vec2>,
    /// The outline's box in pattern coordinates, and the placed outline's in space.
    flat: (Vec2, Vec2),
    space: (Vec3, Vec3),
}

/// The cuts placed so far, bottom of the stack first.
pub struct Cloud {
    gap: f32,
    frames: Vec<Frame>,
    placed: Vec<Placed>,
}

fn wrap_angle(a: f32) -> f32 {
    use std::f32::consts::{PI, TAU};
    (a + PI).rem_euclid(TAU) - PI
}

impl Cloud {
    pub fn new(gap: f32) -> Self {
        Self {
            gap,
            frames: Vec::new(),
            placed: Vec::new(),
        }
    }

    fn frame_id(&mut self, f: &Frame) -> u32 {
        let same = |g: &Frame| {
            g.o == f.o
                && g.a == f.a
                && g.e0 == f.e0
                && g.path.as_ref().map(|p| p.len()) == f.path.as_ref().map(|p| p.len())
        };
        match self.frames.iter().position(same) {
            Some(k) => k as u32,
            None => {
                self.frames.push(f.clone());
                self.frames.len() as u32 - 1
            }
        }
    }

    /// Points over `outline` (pattern coordinates, m) as it is placed by `r`: a grid inside it,
    /// and its corners.
    fn sample(outline: &[Vec2], r: &Resolved) -> Vec<Sample> {
        let (lo, hi) = bounds(outline);
        let area = (hi.x - lo.x) * (hi.y - lo.y);
        let step = SPACING.max((area / MAX_SAMPLES as f32).sqrt());
        let at = |p: Vec2| {
            let b = r.basis_at(p);
            let q = p - r.anchor;
            let radius = r.radius_at(p.y);
            Sample {
                pos: b.point,
                out: b.out,
                theta: wrap_angle(r.angle + q.x / radius),
                z: r.top + q.y,
                radius,
            }
        };
        let mut out: Vec<Sample> = outline.iter().map(|&p| at(p)).collect();
        let mut y = lo.y + step / 2.0;
        while y < hi.y {
            let mut x = lo.x + step / 2.0;
            while x < hi.x {
                let p = Vec2::new(x, y);
                if inside(outline, p) {
                    out.push(at(p));
                }
                x += step;
            }
            y += step;
        }
        out
    }

    /// How far cut `cut`, placed by `r` (with its outline), must move out to clear the cuts
    /// below it, m; at least 0. `skip`: cuts it goes on (it sits `lift` above those on purpose).
    ///
    /// A point of the cut overlaps a cut below it where it lies in that cut's own area: in the
    /// same region at any radius, in another region only within a gap and a half of its surface
    /// (a cut that merely touches another along an edge overlaps nothing). The cut moves out until
    /// that point is a gap past the other's surface.
    pub fn push(&mut self, outline: &[Vec2], r: &Resolved, cut: usize, skip: &[usize]) -> f32 {
        let frame = self.frame_id(&r.frame);
        let gap = self.gap;
        let reach = 1.5 * gap;
        let mut push = 0.0f32;
        for a in Self::sample(outline, r) {
            for b in &self.placed {
                if b.cut == cut || skip.contains(&b.cut) {
                    continue;
                }
                // Where the point falls on b's pattern, and b's radius there.
                let (spot, radius, other) = if b.frame == frame {
                    let y = a.z - b.r.top + b.r.anchor.y;
                    let radius = b.r.radius_at(y);
                    let x = wrap_angle(a.theta - b.r.angle) * radius + b.r.anchor.x;
                    (Vec2::new(x, y), radius, false)
                } else {
                    if b.r.frame.path.is_some()
                        || a.pos.cmplt(b.space.0 - Vec3::splat(reach)).any()
                        || a.pos.cmpgt(b.space.1 + Vec3::splat(reach)).any()
                    {
                        continue;
                    }
                    let f = &b.r.frame;
                    let q = a.pos - f.o;
                    let along = q.dot(f.a);
                    let v = q - along * f.a;
                    let e1 = f.a.cross(f.e0);
                    let y = along - b.r.top + b.r.anchor.y;
                    let radius = b.r.radius_at(y);
                    if (v.length() - radius).abs() > reach {
                        continue;
                    }
                    let theta = v.dot(e1).atan2(v.dot(f.e0));
                    let x = wrap_angle(theta - b.r.angle) * radius + b.r.anchor.x;
                    (Vec2::new(x, y), radius, true)
                };
                if spot.cmplt(b.flat.0).any() || spot.cmpgt(b.flat.1).any() {
                    continue;
                }
                if !inside(&b.outline, spot) {
                    continue;
                }
                if !other {
                    push = push.max(gap + radius - a.radius);
                    continue;
                }
                let under = b.r.basis_at(spot);
                if a.out.dot(under.out) > FACING {
                    push = push.max(gap + (under.point - a.pos).dot(a.out));
                }
            }
        }
        push.max(0.0)
    }

    /// Adds cut `cut`, placed by `r`, to what later cuts must clear.
    pub fn add(&mut self, outline: &[Vec2], r: &Resolved, cut: usize) {
        let frame = self.frame_id(&r.frame);
        let flat = bounds(outline);
        let space = outline.iter().map(|&p| r.at(p)).fold(
            (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN)),
            |(lo, hi), p| (lo.min(p), hi.max(p)),
        );
        self.placed.push(Placed {
            cut,
            frame,
            r: r.clone(),
            outline: outline.to_vec(),
            flat,
            space,
        });
    }
}

fn bounds(outline: &[Vec2]) -> (Vec2, Vec2) {
    outline.iter().fold(
        (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN)),
        |(lo, hi), q| (lo.min(*q), hi.max(*q)),
    )
}

/// Whether `p` is inside the closed polygon `outline` (even-odd).
fn inside(outline: &[Vec2], p: Vec2) -> bool {
    let mut inside = false;
    for i in 0..outline.len() {
        let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            inside = !inside;
        }
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::placement::{default_avatar, region_frame, resolve_all};

    const GAP: f32 = 0.012;

    fn rect(w: f32, h: f32) -> Vec<Vec2> {
        vec![
            Vec2::new(-w / 2.0, -h),
            Vec2::new(w / 2.0, -h),
            Vec2::new(w / 2.0, 0.0),
            Vec2::new(-w / 2.0, 0.0),
        ]
    }

    fn wrap(region: &str, angle: f32, radius: f32, offset: f32) -> PlaceSpec {
        wrap_at(region, angle, radius, offset, 1.3)
    }

    fn wrap_at(region: &str, angle: f32, radius: f32, offset: f32, top: f32) -> PlaceSpec {
        PlaceSpec::Wrap {
            frame: region_frame(&default_avatar().regions, region).unwrap(),
            angle,
            radius,
            top,
            tube: None,
            offset,
        }
    }

    /// Each cut's radius where it is placed, in the stack `order`.
    fn radii(specs: &[PlaceSpec], order: &[usize]) -> Vec<f32> {
        let outlines: Vec<Vec<Vec2>> = specs.iter().map(|_| rect(0.3, 0.4)).collect();
        let names: Vec<&str> = specs.iter().map(|_| "cut").collect();
        let stacking = Stacking {
            order: order.to_vec(),
            gap: GAP,
        };
        resolve_all(&outlines, &names, specs, &stacking)
            .unwrap()
            .iter()
            .map(|r| r.radius_at(-0.2))
            .collect()
    }

    #[test]
    fn cuts_on_one_spot_start_one_gap_apart_in_stack_order() {
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", 0.0, 0.15, 0.0),
        ];
        let r = radii(&specs, &[0, 1, 2]);
        assert!((r[0] - 0.15).abs() < 1e-6, "{r:?}");
        assert!((r[1] - r[0] - GAP).abs() < 1e-5, "{r:?}");
        assert!((r[2] - r[1] - GAP).abs() < 1e-5, "{r:?}");
        // The other way up: the order decides, not the cut's number.
        let r = radii(&specs, &[2, 1, 0]);
        assert!(r[2] < r[1] && r[1] < r[0], "{r:?}");
    }

    #[test]
    fn a_cut_higher_in_the_stack_starts_outside_one_wrapped_further_out() {
        // A coat drawn closer to the body than the shirt under it.
        let specs = [wrap("torso", 0.0, 0.2, 0.0), wrap("torso", 0.0, 0.15, 0.0)];
        let r = radii(&specs, &[0, 1]);
        assert!((r[1] - (r[0] + GAP)).abs() < 1e-5, "{r:?}");
        // Already outside: left where it is.
        let specs = [wrap("torso", 0.0, 0.15, 0.0), wrap("torso", 0.0, 0.2, 0.0)];
        assert_eq!(radii(&specs, &[0, 1]), vec![0.15, 0.2]);
    }

    #[test]
    fn cuts_that_do_not_overlap_are_left_alone_in_any_order() {
        // A front and a back.
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", std::f32::consts::PI, 0.15, 0.0),
        ];
        assert_eq!(radii(&specs, &[0, 1]), vec![0.15, 0.15]);
        assert_eq!(radii(&specs, &[1, 0]), vec![0.15, 0.15]);
        // Different regions, far apart: the torso piece and one on the lower leg.
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap_at("leg-left", 0.0, 0.08, 0.0, 0.4),
        ];
        assert_eq!(radii(&specs, &[0, 1]), vec![0.15, 0.08]);
        assert_eq!(radii(&specs, &[1, 0]), vec![0.15, 0.08]);
    }

    #[test]
    fn cuts_in_different_regions_that_touch_move_at_most_a_little() {
        // A torso piece and one at the top of the leg, meeting at the hip: not stacked on one
        // cylinder, so the cut that is higher in the stack moves by a few gaps at most.
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap_at("leg-left", 0.0, 0.08, 0.0, 1.3),
        ];
        for order in [[0, 1], [1, 0]] {
            let r = radii(&specs, &order);
            assert!(r[0] - 0.15 <= 2.5 * GAP + 1e-6, "{r:?}");
            assert!(r[1] - 0.08 <= 2.5 * GAP + 1e-6, "{r:?}");
        }
    }

    #[test]
    fn an_offset_adds_to_where_the_stack_puts_the_cut() {
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", 0.0, 0.15, 0.02),
        ];
        let r = radii(&specs, &[0, 1]);
        assert!((r[1] - (r[0] + GAP + 0.02)).abs() < 1e-5, "{r:?}");
        // On its own it is just further out.
        let specs = [wrap("torso", 0.0, 0.15, 0.02)];
        assert!((radii(&specs, &[0])[0] - 0.17).abs() < 1e-6);
    }

    #[test]
    fn a_cut_on_another_sits_its_lift_above_it_and_no_further() {
        // 5 mm is less than a gap, but it is what the person asked for.
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            PlaceSpec::Follow {
                of: 0,
                angle: None,
                lift: 0.005,
            },
        ];
        let r = radii(&specs, &[0, 1]);
        assert!((r[1] - 0.155).abs() < 1e-6, "{r:?}");
        // Another cut over both clears the pair.
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            PlaceSpec::Follow {
                of: 0,
                angle: None,
                lift: 0.005,
            },
            wrap("torso", 0.0, 0.15, 0.0),
        ];
        let r = radii(&specs, &[0, 1, 2]);
        assert!((r[2] - (r[1] + GAP)).abs() < 1e-5, "{r:?}");
    }

    #[test]
    fn a_cut_starts_the_same_every_time() {
        let specs = [
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", 0.1, 0.17, 0.0),
            wrap("torso", 0.0, 0.2, 0.01),
        ];
        assert_eq!(radii(&specs, &[1, 0, 2]), radii(&specs, &[1, 0, 2]));
    }

    #[test]
    fn the_default_order_is_by_distance_with_followers_after() {
        let specs = [
            wrap("torso", 0.0, 0.2, 0.0),
            PlaceSpec::Follow {
                of: 2,
                angle: None,
                lift: 0.0,
            },
            wrap("torso", 0.0, 0.15, 0.0),
            wrap("torso", 0.0, 0.15, 0.0),
        ];
        assert_eq!(default_order(&specs), vec![2, 1, 3, 0]);
    }

    #[test]
    fn an_order_with_gaps_or_repeats_is_completed() {
        let s = Stacking {
            order: vec![2, 2, 9, 0],
            gap: GAP,
        };
        assert_eq!(s.complete(4), vec![2, 0, 1, 3]);
    }
}
