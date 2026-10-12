//! Collision body on the CPU: triangle mesh, BVH, exact signed distance, and the SDF bake
//! uploaded to the GPU. The exact distance is also the benchmark's penetration check.
//!
//! Sign uses angle-weighted pseudo-normals (Bærentzen & Aanæs 2005): correct for a closed,
//! consistently oriented mesh; near holes (eye sockets etc.) it degrades, which is irrelevant
//! for a T-shirt.

use std::collections::HashMap;

use glam::{UVec3, Vec3};

#[derive(Debug, Clone)]
pub struct BodyMesh {
    pub pos: Vec<Vec3>,
    pub tris: Vec<[u32; 3]>,
}

impl BodyMesh {
    /// Minimal OBJ reader: `v x y z` and `f a b c ...` (polygons fanned), indices may carry `/vt/vn`.
    pub fn from_obj(text: &str) -> Result<Self, String> {
        let mut pos = Vec::new();
        let mut tris = Vec::new();
        for (ln, line) in text.lines().enumerate() {
            let mut it = line.split_whitespace();
            match it.next() {
                Some("v") => {
                    let c: Vec<f32> = it
                        .take(3)
                        .map(|t| t.parse().map_err(|e| format!("line {}: {e}", ln + 1)))
                        .collect::<Result<_, _>>()?;
                    if c.len() != 3 {
                        return Err(format!("line {}: bad vertex", ln + 1));
                    }
                    pos.push(Vec3::new(c[0], c[1], c[2]));
                }
                Some("f") => {
                    let idx: Vec<u32> = it
                        .map(|t| {
                            t.split('/')
                                .next()
                                .unwrap()
                                .parse::<i64>()
                                .map(|i| (i - 1) as u32)
                                .map_err(|e| format!("line {}: {e}", ln + 1))
                        })
                        .collect::<Result<_, _>>()?;
                    for k in 1..idx.len().saturating_sub(1) {
                        tris.push([idx[0], idx[k], idx[k + 1]]);
                    }
                }
                _ => {}
            }
        }
        let mut m = Self { pos, tris };
        if m.signed_volume() < 0.0 {
            for t in &mut m.tris {
                t.swap(1, 2);
            }
        }
        Ok(m)
    }

    pub fn signed_volume(&self) -> f32 {
        self.tris
            .iter()
            .map(|t| {
                self.pos[t[0] as usize].dot(self.pos[t[1] as usize].cross(self.pos[t[2] as usize]))
                    / 6.0
            })
            .sum()
    }

    pub fn vertex_normals(&self) -> Vec<Vec3> {
        let mut n = vec![Vec3::ZERO; self.pos.len()];
        for t in &self.tris {
            let [a, b, c] = t.map(|i| self.pos[i as usize]);
            let f = (b - a).cross(c - a);
            for &i in t {
                n[i as usize] += f;
            }
        }
        n.iter().map(|v| v.normalize_or(Vec3::Y)).collect()
    }
}

#[derive(Clone, Copy)]
struct Aabb {
    min: Vec3,
    max: Vec3,
}

impl Aabb {
    fn empty() -> Self {
        Self {
            min: Vec3::splat(f32::MAX),
            max: Vec3::splat(f32::MIN),
        }
    }
    fn grow(&mut self, p: Vec3) {
        self.min = self.min.min(p);
        self.max = self.max.max(p);
    }
    fn union(&mut self, o: &Aabb) {
        self.min = self.min.min(o.min);
        self.max = self.max.max(o.max);
    }
    fn dist2(&self, p: Vec3) -> f32 {
        let d = (self.min - p).max(p - self.max).max(Vec3::ZERO);
        d.length_squared()
    }
}

enum Node {
    Leaf { bb: Aabb, start: u32, end: u32 },
    Inner { bb: Aabb, left: u32, right: u32 },
}

/// Which feature of the triangle the closest point lies on.
#[derive(Clone, Copy)]
enum Feature {
    Face,
    Edge(u8), // edge k = (v_k, v_{k+1})
    Vertex(u8),
}

/// BVH + pseudo-normals for exact signed distance queries.
pub struct BodyQuery {
    pub mesh: BodyMesh,
    nodes: Vec<Node>,
    order: Vec<u32>,
    face_n: Vec<Vec3>,
    edge_n: HashMap<(u32, u32), Vec3>,
    vert_n: Vec<Vec3>,
}

const LEAF: usize = 4;

impl BodyQuery {
    pub fn new(mesh: BodyMesh) -> Self {
        let p = &mesh.pos;
        let face_n: Vec<Vec3> = mesh
            .tris
            .iter()
            .map(|t| {
                (p[t[1] as usize] - p[t[0] as usize])
                    .cross(p[t[2] as usize] - p[t[0] as usize])
                    .normalize_or_zero()
            })
            .collect();
        let mut edge_n: HashMap<(u32, u32), Vec3> = HashMap::new();
        let mut vert_n = vec![Vec3::ZERO; p.len()];
        for (fi, t) in mesh.tris.iter().enumerate() {
            for k in 0..3 {
                let (a, b) = (t[k], t[(k + 1) % 3]);
                *edge_n.entry((a.min(b), a.max(b))).or_default() += face_n[fi];
                // angle at vertex t[k]
                let v = p[t[k] as usize];
                let e1 = (p[t[(k + 1) % 3] as usize] - v).normalize_or_zero();
                let e2 = (p[t[(k + 2) % 3] as usize] - v).normalize_or_zero();
                vert_n[t[k] as usize] += e1.dot(e2).clamp(-1.0, 1.0).acos() * face_n[fi];
            }
        }
        let mut q = Self {
            nodes: Vec::new(),
            order: (0..mesh.tris.len() as u32).collect(),
            face_n,
            edge_n,
            vert_n,
            mesh,
        };
        let centroids: Vec<Vec3> = q
            .mesh
            .tris
            .iter()
            .map(|t| (p_of(&q.mesh, t[0]) + p_of(&q.mesh, t[1]) + p_of(&q.mesh, t[2])) / 3.0)
            .collect();
        let n = q.order.len();
        q.build(&centroids, 0, n);
        q
    }

    fn tri_bb(&self, ti: u32) -> Aabb {
        let mut bb = Aabb::empty();
        for &v in &self.mesh.tris[ti as usize] {
            bb.grow(self.mesh.pos[v as usize]);
        }
        bb
    }

    fn build(&mut self, c: &[Vec3], start: usize, end: usize) -> u32 {
        let mut bb = Aabb::empty();
        let mut cb = Aabb::empty();
        for &ti in &self.order[start..end] {
            bb.union(&self.tri_bb(ti));
            cb.grow(c[ti as usize]);
        }
        let id = self.nodes.len() as u32;
        if end - start <= LEAF {
            self.nodes.push(Node::Leaf {
                bb,
                start: start as u32,
                end: end as u32,
            });
            return id;
        }
        self.nodes.push(Node::Leaf {
            bb,
            start: 0,
            end: 0,
        }); // placeholder
        let ext = cb.max - cb.min;
        let axis = if ext.x >= ext.y && ext.x >= ext.z {
            0
        } else if ext.y >= ext.z {
            1
        } else {
            2
        };
        let mid = (start + end) / 2;
        self.order[start..end].select_nth_unstable_by(mid - start, |&a, &b| {
            c[a as usize][axis]
                .partial_cmp(&c[b as usize][axis])
                .unwrap()
        });
        let left = self.build(c, start, mid);
        let right = self.build(c, mid, end);
        self.nodes[id as usize] = Node::Inner { bb, left, right };
        id
    }

    /// Exact signed distance (negative inside). Returns `None` if nothing is within `max_dist`.
    pub fn signed_distance(&self, p: Vec3, max_dist: f32) -> Option<f32> {
        let mut best = max_dist * max_dist;
        let mut hit: Option<(u32, Vec3, Feature)> = None;
        let mut stack = [0u32; 64];
        let mut sp = 1;
        while sp > 0 {
            sp -= 1;
            match &self.nodes[stack[sp] as usize] {
                Node::Leaf { bb, start, end } => {
                    if bb.dist2(p) > best {
                        continue;
                    }
                    for &ti in &self.order[*start as usize..*end as usize] {
                        let t = self.mesh.tris[ti as usize];
                        let (q, f) = closest_on_triangle(
                            p,
                            p_of(&self.mesh, t[0]),
                            p_of(&self.mesh, t[1]),
                            p_of(&self.mesh, t[2]),
                        );
                        let d2 = (p - q).length_squared();
                        if d2 < best {
                            best = d2;
                            hit = Some((ti, q, f));
                        }
                    }
                }
                Node::Inner { bb, left, right } => {
                    if bb.dist2(p) > best {
                        continue;
                    }
                    // push farther child first so the nearer one is popped first
                    let (l, r) = (*left, *right);
                    let dl = self.node_bb(l).dist2(p);
                    let dr = self.node_bb(r).dist2(p);
                    let (a, b) = if dl < dr { (r, l) } else { (l, r) };
                    stack[sp] = a;
                    stack[sp + 1] = b;
                    sp += 2;
                }
            }
        }
        let (ti, q, f) = hit?;
        let t = self.mesh.tris[ti as usize];
        let n = match f {
            Feature::Face => self.face_n[ti as usize],
            Feature::Edge(k) => {
                let (a, b) = (t[k as usize], t[(k as usize + 1) % 3]);
                self.edge_n[&(a.min(b), a.max(b))]
            }
            Feature::Vertex(k) => self.vert_n[t[k as usize] as usize],
        };
        let d = best.sqrt();
        Some(if (p - q).dot(n) < 0.0 { -d } else { d })
    }

    fn node_bb(&self, i: u32) -> &Aabb {
        match &self.nodes[i as usize] {
            Node::Leaf { bb, .. } | Node::Inner { bb, .. } => bb,
        }
    }
}

fn p_of(m: &BodyMesh, i: u32) -> Vec3 {
    m.pos[i as usize]
}

/// Ericson, Real-Time Collision Detection 5.1.5, plus which feature was hit.
fn closest_on_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> (Vec3, Feature) {
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;
    let d1 = ab.dot(ap);
    let d2 = ac.dot(ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return (a, Feature::Vertex(0));
    }
    let bp = p - b;
    let d3 = ab.dot(bp);
    let d4 = ac.dot(bp);
    if d3 >= 0.0 && d4 <= d3 {
        return (b, Feature::Vertex(1));
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return (a + v * ab, Feature::Edge(0));
    }
    let cp = p - c;
    let d5 = ab.dot(cp);
    let d6 = ac.dot(cp);
    if d6 >= 0.0 && d5 <= d6 {
        return (c, Feature::Vertex(2));
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return (a + w * ac, Feature::Edge(2));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return (b + w * (c - b), Feature::Edge(1));
    }
    let denom = 1.0 / (va + vb + vc);
    let v = vb * denom;
    let w = vc * denom;
    (a + ab * v + ac * w, Feature::Face)
}

/// Signed distance grid, sampled at cell corners. Values are clamped to ±`band`.
#[derive(Debug, Clone)]
pub struct Sdf {
    pub origin: Vec3,
    pub cell: f32,
    pub dims: UVec3,
    pub band: f32,
    pub values: Vec<f32>,
}

impl Sdf {
    /// Narrow-band bake: exact signed distance within `band`, ±band beyond it. Far points that
    /// are inside (no surface within the band) are found with a ray-parity test.
    pub fn bake(q: &BodyQuery, min: Vec3, max: Vec3, cell: f32, band: f32) -> Self {
        let dims = ((max - min) / cell).ceil().as_uvec3() + UVec3::ONE;
        let (nx, ny, nz) = (dims.x as usize, dims.y as usize, dims.z as usize);
        let slice = |k: usize| -> Vec<f32> {
            let mut out = Vec::with_capacity(nx * ny);
            for j in 0..ny {
                let mut crossings: Option<Vec<f32>> = None;
                for i in 0..nx {
                    let p = min + Vec3::new(i as f32, j as f32, k as f32) * cell;
                    out.push(match q.signed_distance(p, band) {
                        Some(d) => d.clamp(-band, band),
                        None => {
                            // Far from the surface: only the sign matters. One ray per row.
                            let xs = crossings.get_or_insert_with(|| q.x_crossings(p.y, p.z));
                            if xs.iter().filter(|&&x| x > p.x).count() % 2 == 1 {
                                -band
                            } else {
                                band
                            }
                        }
                    });
                }
            }
            out
        };
        #[cfg(not(target_arch = "wasm32"))]
        let slices: Vec<Vec<f32>> = {
            use rayon::prelude::*;
            (0..nz).into_par_iter().map(slice).collect()
        };
        #[cfg(target_arch = "wasm32")]
        let slices: Vec<Vec<f32>> = (0..nz).map(slice).collect();
        Self {
            origin: min,
            cell,
            dims,
            band,
            values: slices.concat(),
        }
    }

    pub fn bytes(&self) -> u64 {
        self.values.len() as u64 * 4
    }

    /// CPU trilinear sample, same convention as the shader.
    pub fn sample(&self, p: Vec3) -> f32 {
        let g = (p - self.origin) / self.cell;
        let maxc = (self.dims - UVec3::ONE).as_vec3();
        if g.cmplt(Vec3::ZERO).any() || g.cmpgt(maxc).any() {
            return self.band;
        }
        let g = g.min(maxc - Vec3::splat(1e-4));
        let i = g.floor();
        let f = g - i;
        let i = i.as_uvec3();
        let at = |x: u32, y: u32, z: u32| {
            self.values[((z * self.dims.y + y) * self.dims.x + x) as usize]
        };
        let mut v = 0.0;
        for dz in 0..2 {
            for dy in 0..2 {
                for dx in 0..2 {
                    let w = (if dx == 1 { f.x } else { 1.0 - f.x })
                        * (if dy == 1 { f.y } else { 1.0 - f.y })
                        * (if dz == 1 { f.z } else { 1.0 - f.z });
                    v += w * at(i.x + dx, i.y + dy, i.z + dz);
                }
            }
        }
        v
    }

    /// Central-difference gradient of the trilinear field.
    pub fn gradient(&self, p: Vec3) -> Vec3 {
        let h = self.cell * 0.5;
        Vec3::new(
            self.sample(p + Vec3::X * h) - self.sample(p - Vec3::X * h),
            self.sample(p + Vec3::Y * h) - self.sample(p - Vec3::Y * h),
            self.sample(p + Vec3::Z * h) - self.sample(p - Vec3::Z * h),
        ) / (2.0 * h)
    }

    /// Move `p` out until it is at least `margin` outside the surface (a few gradient steps).
    /// Points deeper than the band (zero gradient) are returned unchanged.
    pub fn push_out(&self, mut p: Vec3, margin: f32) -> Vec3 {
        for _ in 0..4 {
            let d = self.sample(p);
            if d >= margin {
                break;
            }
            let g = self.gradient(p);
            if g.length() < 1e-6 {
                break;
            }
            p += g.normalize() * (margin - d);
        }
        p
    }

    /// Binary cache format: magic, origin, cell, dims, band, values (little endian f32/u32).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(48 + self.values.len() * 4);
        b.extend_from_slice(b"DSDF0001");
        for f in [
            self.origin.x,
            self.origin.y,
            self.origin.z,
            self.cell,
            self.band,
        ] {
            b.extend_from_slice(&f.to_le_bytes());
        }
        for u in [self.dims.x, self.dims.y, self.dims.z] {
            b.extend_from_slice(&u.to_le_bytes());
        }
        b.extend_from_slice(bytemuck::cast_slice(&self.values));
        b
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() < 40 || &b[..8] != b"DSDF0001" {
            return None;
        }
        let f = |o: usize| f32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let u = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
        let dims = UVec3::new(u(28), u(32), u(36));
        let n = (dims.x * dims.y * dims.z) as usize;
        let data = b.get(40..40 + n * 4)?;
        Some(Self {
            origin: Vec3::new(f(8), f(12), f(16)),
            cell: f(20),
            band: f(24),
            dims,
            values: bytemuck::pod_collect_to_vec(data),
        })
    }
}

impl BodyQuery {
    /// X coordinates where the ray from (-inf, y, z) along +X crosses the surface, sorted.
    /// BVH-accelerated; the ray is nudged off-axis by a tiny irrational offset so it doesn't
    /// pass exactly through shared edges/vertices (which would double count).
    pub fn x_crossings(&self, y: f32, z: f32) -> Vec<f32> {
        let (y, z) = (y + 1.234_567e-6, z + 2.345_678e-6);
        let mut out = Vec::new();
        let mut stack = vec![0u32];
        while let Some(n) = stack.pop() {
            let node = &self.nodes[n as usize];
            let bb = self.node_bb(n);
            if y < bb.min.y || y > bb.max.y || z < bb.min.z || z > bb.max.z {
                continue;
            }
            match node {
                Node::Inner { left, right, .. } => {
                    stack.push(*left);
                    stack.push(*right);
                }
                Node::Leaf { start, end, .. } => {
                    for &ti in &self.order[*start as usize..*end as usize] {
                        let [a, b, c] =
                            self.mesh.tris[ti as usize].map(|i| self.mesh.pos[i as usize]);
                        // Project to the YZ plane: is (y, z) inside triangle abc? Then solve for x.
                        let (ay, az, by, bz, cy, cz) = (a.y, a.z, b.y, b.z, c.y, c.z);
                        let det = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
                        if det.abs() < 1e-14 {
                            continue;
                        }
                        let u = ((y - ay) * (cz - az) - (z - az) * (cy - ay)) / det;
                        let v = ((by - ay) * (z - az) - (bz - az) * (y - ay)) / det;
                        if u < 0.0 || v < 0.0 || u + v > 1.0 {
                            continue;
                        }
                        out.push(a.x + u * (b.x - a.x) + v * (c.x - a.x));
                    }
                }
            }
        }
        out.sort_by(|a, b| a.partial_cmp(b).unwrap());
        out
    }

    /// Inside test by crossing parity (works for any point, used where no surface is near).
    pub fn inside_by_parity(&self, p: Vec3) -> bool {
        self.x_crossings(p.y, p.z)
            .iter()
            .filter(|&&x| x > p.x)
            .count()
            % 2
            == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cube(h: f32) -> BodyMesh {
        let obj = format!(
            "v -{h} -{h} -{h}\nv {h} -{h} -{h}\nv {h} {h} -{h}\nv -{h} {h} -{h}\nv -{h} -{h} {h}\nv {h} -{h} {h}\nv {h} {h} {h}\nv -{h} {h} {h}\n\
             f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n"
        );
        BodyMesh::from_obj(&obj).unwrap()
    }

    #[test]
    fn cube_signed_distance() {
        let q = BodyQuery::new(cube(0.5));
        let cases = [
            (Vec3::ZERO, -0.5),
            (Vec3::new(0.2, 0.1, 0.0), -0.3),
            (Vec3::new(0.8, 0.0, 0.0), 0.3),
            (Vec3::new(0.8, 0.8, 0.0), (0.3f32 * 0.3 * 2.0).sqrt()), // edge region
            (Vec3::new(0.8, 0.8, 0.8), (0.3f32 * 0.3 * 3.0).sqrt()), // vertex region
            (Vec3::new(0.49, 0.49, 0.49), -0.01),
        ];
        for (p, want) in cases {
            let d = q.signed_distance(p, 10.0).unwrap();
            assert!((d - want).abs() < 1e-4, "at {p}: got {d}, want {want}");
        }
        assert!(q.inside_by_parity(Vec3::new(0.1, 0.2, 0.3)));
        assert!(!q.inside_by_parity(Vec3::new(1.1, 0.2, 0.3)));
    }

    #[test]
    fn sdf_bake_and_roundtrip() {
        let q = BodyQuery::new(cube(0.5));
        let sdf = Sdf::bake(&q, Vec3::splat(-1.0), Vec3::splat(1.0), 0.05, 0.2);
        assert!((sdf.sample(Vec3::new(0.6, 0.0, 0.0)) - 0.1).abs() < 1e-3);
        assert!((sdf.sample(Vec3::new(0.45, 0.0, 0.0)) + 0.05).abs() < 1e-3);
        assert_eq!(sdf.sample(Vec3::ZERO), -0.2); // deep inside, beyond band
        let back = Sdf::from_bytes(&sdf.to_bytes()).unwrap();
        assert_eq!(back.values, sdf.values);
        assert_eq!(back.dims, sdf.dims);
    }
}
