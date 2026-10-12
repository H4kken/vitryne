// SPDX-License-Identifier: AGPL-3.0-or-later
// Long-range stretch limits (M2), see longrange.rs: unilateral distance constraints
// |x_i - x_j| <= (1 + slack) d_ij between vertices several edges apart in the same panel
// (Müller 2008, Hierarchical Position Based Dynamics; Kim, Chentanez & Müller 2012, Long Range
// Attachments). Shared by native and web (hard rule 2).
//
// Jacobi with constraint averaging, no atomics:
//   lr_gather: each vertex reads its partners' positions and writes its own correction (the
//              mass-weighted share of every violated constraint, averaged, times omega) to
//              `delta`. Positions are only read, so nothing races.
//   lr_apply:  pos += delta.

struct LrParams {
    n_verts: u32,
    omega: f32,
    slack: f32,
    gamma: f32,     // XPBD damping, beta / h (Macklin et al. 2016 eq. 26)
    cross_on: u32,  // 1 = pairs across seams (negative rest) are active
    _p0: u32,
    _p1: u32,
    _p2: u32,
};

struct Lr {
    j: u32,
    rest: f32,
};

@group(0) @binding(0) var<uniform> L: LrParams;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;   // xyz, w = inverse mass
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read> items: array<Lr>;
@group(0) @binding(4) var<storage, read_write> delta: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> prev: array<vec4<f32>>;

@compute @workgroup_size(64)
fn lr_gather(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= L.n_verts) { return; }
    let pi = pos[i];
    var d = vec3<f32>(0.0);
    var n_active = 0u;
    if (pi.w > 0.0) {
        for (var k = offsets[i]; k < offsets[i + 1u]; k = k + 1u) {
            let c = items[k];
            if (c.rest < 0.0 && L.cross_on == 0u) { continue; }
            let pj = pos[c.j];
            let v = pi.xyz - pj.xyz;
            let len = length(v);
            let lim = abs(c.rest) * (1.0 + L.slack);
            if (len > lim) {
                let n = v / len;
                // Damping: resist the separation speed along the constraint this substep.
                let rel = dot(n, (pi.xyz - prev[i].xyz) - (pj.xyz - prev[c.j].xyz));
                let dl = ((len - lim) + L.gamma * rel) / ((1.0 + L.gamma) * (pi.w + pj.w));
                d = d - (pi.w * dl) * n;
                n_active = n_active + 1u;
            }
        }
    }
    if (n_active > 0u) {
        d = d * (L.omega / f32(n_active));
    }
    delta[i] = vec4<f32>(d, 0.0);
}

@compute @workgroup_size(64)
fn lr_apply(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= L.n_verts) { return; }
    let p = pos[i];
    pos[i] = vec4<f32>(p.xyz + delta[i].xyz, p.w);
}
