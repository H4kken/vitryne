// Untangling (spike 2, S4): intersection contour minimization, after Volino & Magnenat-Thalmann
// 2006, "Resolving surface collisions through intersection contour minimization" (ACM TOG 25(3),
// SIGGRAPH 2006). Same goal as Baraff, Witkin & Kass 2003, "Untangling cloth" (ACM TOG 22(3)),
// but local, so it needs no flood fill of the regions inside a contour and runs as plain
// per-pair GPU work. Shared by native and web, no float atomics (corrections are fixed-point
// i32 atomicAdd plus a count, as the spike-1 plan has it).
//
// Full detection every `untangle_check_every` substeps (gated = 0), and every `untangle_every`
// in between a gated one (gated = 1) that only tests triangles with a vertex flagged by the last
// detection: around known crossings, so its cost follows the size of the tangle (nearly nothing
// when there is none). As a contour shrinks, the newly crossing triangles share a vertex with
// the old ones, so they are still tested. New crossings elsewhere wait for the next full pass.
//   ut_count, hg_scan_local, hg_scan_blocks, ut_scatter: counting sort of the triangles by the
//               hash cell of their centroid (hashgrid.wgsl, appended). Cell size = 2 x the
//               largest triangle reach (centroid to vertex) supported, so two triangles that
//               touch have centroids in neighbouring cells.
//   ut_detect:  one thread per sorted triangle t; for each candidate u > t that doesn't share a
//               vertex with t (directly or through a seam), the six edge-triangle tests. Each
//               edge E of one triangle crossing the other triangle T is a point P of the
//               intersection contour, and gets a contour-shrinking correction (below).
//   ut_apply:   each vertex moves by the average of its corrections. The move is geometric:
//               prev moves with pos, so it adds no velocity. It also writes the per-vertex
//               "tangled" flags that self-collision reads.
//
// Contour gradient at P (E = a -> b crossing T, plane normal n): within each triangle F that
// borders E, the contour runs along the line where F's plane meets T's plane, d_F = unit(n x n_F),
// signed to point from E into F. dL/dP = -(sum of the d_F) = g: one term per side of E (two,
// or one on an open boundary; seams are welded, so a seam edge has both). Moving E by t along n
// moves P within T by -(t / n.e) e_par, so dL/dt = -(g.e) / (n.e). The correction moves E by
// +delta and T by -delta, delta = step * (g.e)/(n.e) * n, half each (equal masses): down the
// gradient, the contour shrinks. n's sign and e's direction cancel out. A straight contour
// gives g = 0 (nothing to shrink locally); a small closed loop, the pinch case, gives a strong
// gradient; an open contour ending on a free edge is pulled toward it.

struct UtParams {
    n_tris: u32,
    table_size: u32,  // power of two, multiple of 256
    n_blocks: u32,    // table_size / 256
    inv_cell: f32,    // 1 / cell size
    n_verts: u32,
    step: f32,        // displacement per application for a unit gradient ratio (m)
    max_ratio: f32,   // clamp on |(g.e)/(n.e)| (edges almost parallel to T)
    max_reach: f32,   // largest centroid-to-vertex distance the hash supports (m)
    gated: u32,       // 1 = only triangles touching a flagged vertex (see above)
    _p0: u32,
    _p1: u32,
    _p2: u32,
};

@group(0) @binding(0) var<uniform> S: UtParams;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;   // xyz, w = inverse mass
@group(0) @binding(2) var<storage, read_write> prev: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> cell_count: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cell_start: array<u32>;
// Triangle centroids in cell order, triangle index as bits in w.
@group(0) @binding(5) var<storage, read_write> tsorted: array<vec4<f32>>;
// 3 rows per triangle: vertices (v0, v1, v2, -), welded vertex ids (sewn vertices share one),
// and for edge k = (v_k, v_k+1) the third vertex of the triangle across it (NONE on a boundary).
@group(0) @binding(6) var<storage, read> tris: array<vec4<u32>>;
// Per vertex i: [4i, 4i+4) correction sum xyz (fixed point) and count; [4n + i] touched count;
// [5n + i] tangled flag (read by selfcol.wgsl); [6n] pairs found by this detection, [6n + 1]
// pairs found by the last one (benchmark readback).
@group(0) @binding(7) var<storage, read_write> acc: array<atomic<i32>>;

const NONE: u32 = 0xffffffffu;
const FIXED: f32 = 1e8;      // 1e-8 m units, as in selfcol.wgsl
const FIXED_MAX: f32 = 1e6;  // per term: 1 cm, far above any step; x1000 terms < 2^31

fn hash_n_items() -> u32 {
    return S.n_tris;
}

fn tri_centroid(t: u32) -> vec3<f32> {
    let v = tris[3u * t].xyz;
    return (pos[v.x].xyz + pos[v.y].xyz + pos[v.z].xyz) * (1.0 / 3.0);
}

@compute @workgroup_size(64)
fn ut_count(@builtin(global_invocation_id) gid: vec3<u32>) {
    let t = gid.x;
    if (t >= S.n_tris) { return; }
    atomicAdd(&cell_count[hash(cell_of(tri_centroid(t)))], 1u);
}

@compute @workgroup_size(64)
fn ut_scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
    let t = gid.x;
    if (t >= S.n_tris) { return; }
    let c = tri_centroid(t);
    let h = hash(cell_of(c));
    let k = atomicSub(&cell_count[h], 1u) - 1u;
    tsorted[cell_begin(h) + k] = vec4<f32>(c, bitcast<f32>(t));
}

// Segment p -> q against triangle (a, b, c), Moller-Trumbore, as selfcheck.rs (the CPU count):
// true if the segment crosses the triangle. Coplanar contact doesn't count.
fn seg_hits_tri(p: vec3<f32>, q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> bool {
    let d = q - p;
    let e1 = b - a;
    let e2 = c - a;
    let h = cross(d, e2);
    let det = dot(e1, h);
    if (abs(det) < 1e-14) { return false; }
    let f = 1.0 / det;
    let s = p - a;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) { return false; }
    let qv = cross(s, e1);
    let v = f * dot(d, qv);
    if (v < 0.0 || u + v > 1.0) { return false; }
    let t = f * dot(e2, qv);
    return t >= 0.0 && t <= 1.0;
}

// Direction of the contour from a point on edge a -> b into the triangle (a, b, c), where it
// meets the plane with unit normal n. Zero if the two planes are (nearly) parallel.
fn contour_dir(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    let e = b - a;
    let nf = cross(e, c - a);
    let lf = length(nf);
    if (lf < 1e-14) { return vec3<f32>(0.0); }
    let l = cross(n, nf / lf);
    let ll = length(l);
    if (ll < 1e-4) { return vec3<f32>(0.0); }
    let w = c - a;
    let m = w - e * (dot(w, e) / dot(e, e)); // in F's plane, perpendicular to E, toward c
    let d = l / ll;
    return select(-d, d, dot(d, m) >= 0.0);
}

fn fx(v: vec3<f32>) -> vec3<i32> {
    return vec3<i32>(round(clamp(v * FIXED, vec3<f32>(-FIXED_MAX), vec3<f32>(FIXED_MAX))));
}

fn add_corr(i: u32, d: vec3<i32>) {
    atomicAdd(&acc[4u * i], d.x);
    atomicAdd(&acc[4u * i + 1u], d.y);
    atomicAdd(&acc[4u * i + 2u], d.z);
    atomicAdd(&acc[4u * i + 3u], 1);
}

// Edge (ia -> ib) of a triangle with third vertex ic and, across the edge, third vertex io (or
// NONE), against triangle tv. Returns true if the edge crosses it, after adding the correction.
fn edge_vs_tri(ia: u32, ib: u32, ic: u32, io: u32, tv: vec3<u32>) -> bool {
    let a = pos[ia].xyz;
    let b = pos[ib].xyz;
    let p0 = pos[tv.x].xyz;
    let p1 = pos[tv.y].xyz;
    let p2 = pos[tv.z].xyz;
    if (!seg_hits_tri(a, b, p0, p1, p2)) { return false; }
    let nt = cross(p1 - p0, p2 - p0);
    let ln = length(nt);
    let e = b - a;
    if (ln < 1e-14) { return true; }
    let n = nt / ln;
    var g = -contour_dir(a, b, pos[ic].xyz, n);
    if (io != NONE) {
        g = g - contour_dir(a, b, pos[io].xyz, n);
    }
    let ne = dot(n, e);
    if (abs(ne) < 1e-12) { return true; }
    let ratio = clamp(dot(g, e) / ne, -S.max_ratio, S.max_ratio);
    let d = fx(n * (0.5 * S.step * ratio));
    add_corr(ia, d);
    add_corr(ib, d);
    add_corr(tv.x, -d);
    add_corr(tv.y, -d);
    add_corr(tv.z, -d);
    return true;
}

fn touch(v: vec3<u32>) {
    let n = S.n_verts;
    atomicAdd(&acc[4u * n + v.x], 1);
    atomicAdd(&acc[4u * n + v.y], 1);
    atomicAdd(&acc[4u * n + v.z], 1);
}

fn flagged(v: vec3<u32>) -> bool {
    let o = 5u * S.n_verts;
    return atomicLoad(&acc[o + v.x]) != 0 || atomicLoad(&acc[o + v.y]) != 0 || atomicLoad(&acc[o + v.z]) != 0;
}

fn shares_vertex(a: vec3<u32>, b: vec3<u32>) -> bool {
    return any(a == b.xxx) || any(a == b.yyy) || any(a == b.zzz);
}

// Nine threads per sorted slot, one per (y, z) row of the 3x3x3 cells (as in selfcol.wgsl
// sc_query, which loops over the rows in one thread). One thread per triangle was latency-bound:
// in the gated pass a few flagged triangles each walked their whole neighbourhood serially
// and cost as much as the full pass (docs/history/PROGRESS.md S4).
@compute @workgroup_size(64)
fn ut_detect(@builtin(global_invocation_id) gid: vec3<u32>) {
    let s = gid.x / 9u;
    let row = gid.x % 9u;
    let nt = S.n_tris;
    if (s >= nt) { return; }
    let ct = tsorted[s];
    let t = bitcast<u32>(ct.w);
    let vt = tris[3u * t].xyz;
    let wt = tris[3u * t + 1u].xyz;
    let ot = tris[3u * t + 2u].xyz;
    // Gated: each pair with at least one flagged triangle is tested once, by the flagged one
    // (by the lower index if both are).
    let gated = S.gated != 0u;
    if (gated && !flagged(vt)) { return; }
    let a0 = pos[vt.x].xyz;
    let a1 = pos[vt.y].xyz;
    let a2 = pos[vt.z].xyz;
    let reach_t = sqrt(max(max(dot(a0 - ct.xyz, a0 - ct.xyz), dot(a1 - ct.xyz, a1 - ct.xyz)), dot(a2 - ct.xyz, a2 - ct.xyz)));
    let reach = reach_t + S.max_reach;
    let c0 = cell_of(ct.xyz);
    let mask = S.table_size - 1u;
    let dz = i32(row / 3u) - 1;
    let dy = i32(row % 3u) - 1;
    {
        {
            let h0 = hash(c0 + vec3<i32>(-1, dy, dz));
            let h2 = (h0 + 2u) & mask;
            var a_0 = cell_begin(h0);
            var b_0 = cell_end(h2);
            var b_1 = 0u;
            if (h2 < h0) {
                b_0 = nt;
                b_1 = cell_end(h2);
            }
            for (var part = 0u; part < 2u; part = part + 1u) {
                var k = a_0;
                var b = b_0;
                if (part == 1u) { k = 0u; b = b_1; }
                for (; k < b; k = k + 1u) {
                    let cu = tsorted[k];
                    let u = bitcast<u32>(cu.w);
                    if (u == t || (!gated && u < t)) { continue; }
                    let dc = cu.xyz - ct.xyz;
                    if (dot(dc, dc) >= reach * reach) { continue; }
                    let wu = tris[3u * u + 1u].xyz;
                    if (shares_vertex(wt, wu)) { continue; }
                    let vu = tris[3u * u].xyz;
                    if (gated && u < t && flagged(vu)) { continue; }
                    let ou = tris[3u * u + 2u].xyz;
                    // Bitwise |, not ||: every crossing edge must add its correction.
                    var hit = edge_vs_tri(vt.x, vt.y, vt.z, ot.x, vu);
                    hit = edge_vs_tri(vt.y, vt.z, vt.x, ot.y, vu) | hit;
                    hit = edge_vs_tri(vt.z, vt.x, vt.y, ot.z, vu) | hit;
                    hit = edge_vs_tri(vu.x, vu.y, vu.z, ou.x, vt) | hit;
                    hit = edge_vs_tri(vu.y, vu.z, vu.x, ou.y, vt) | hit;
                    hit = edge_vs_tri(vu.z, vu.x, vu.y, ou.z, vt) | hit;
                    if (hit) {
                        touch(vt);
                        touch(vu);
                        atomicAdd(&acc[6u * S.n_verts], 1);
                    }
                }
            }
        }
    }
}

@compute @workgroup_size(64)
fn ut_apply(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let n = S.n_verts;
    if (i >= n) { return; }
    if (i == 0u) {
        atomicStore(&acc[6u * n + 1u], atomicExchange(&acc[6u * n], 0));
    }
    let touched = atomicExchange(&acc[4u * n + i], 0);
    atomicStore(&acc[5u * n + i], select(0, 1, touched > 0));
    let c = atomicExchange(&acc[4u * i + 3u], 0);
    let sx = atomicExchange(&acc[4u * i], 0);
    let sy = atomicExchange(&acc[4u * i + 1u], 0);
    let sz = atomicExchange(&acc[4u * i + 2u], 0);
    if (c == 0) { return; }
    let p = pos[i];
    if (p.w == 0.0) { return; }
    let d = vec3<f32>(f32(sx), f32(sy), f32(sz)) / (f32(c) * FIXED);
    pos[i] = vec4<f32>(p.xyz + d, p.w);
    let pv = prev[i];
    prev[i] = vec4<f32>(pv.xyz + d, pv.w);
}
