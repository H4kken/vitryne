// SPDX-License-Identifier: AGPL-3.0-or-later
// The cloth as drawn: sewn vertices pulled together, then per-vertex normals by gathering incident
// triangles (CSR), so no float atomics are needed.
//
// The solver leaves a sewn pair a millimetre or two apart, and each piece's edge gets normals from
// its own triangles alone, so a closed seam shows as a crack. Drawn, a sewn vertex goes to the
// average of its partners (`weld`: the other vertices sewn to it) and its normal gathers theirs
// too. Only once they are close: an open seam (still closing, or torn) is drawn as it is.

struct NParams {
    n_verts: u32,
    // Partners closer than `weld_near` are drawn welded, further than `weld_far` apart, m.
    weld_near: f32,
    weld_far: f32,
    _p0: u32,
};

@group(0) @binding(0) var<uniform> N: NParams;
@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> tris: array<u32>;
@group(0) @binding(3) var<storage, read> adj_off: array<u32>;
@group(0) @binding(4) var<storage, read> adj: array<u32>;
@group(0) @binding(5) var<storage, read_write> nrm: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> weld_off: array<u32>;
@group(0) @binding(7) var<storage, read> weld: array<u32>;
@group(0) @binding(8) var<storage, read_write> draw_pos: array<vec4<f32>>;

// How welded two partners are drawn: 1 when close, 0 when apart.
fn weld_weight(i: u32, j: u32) -> f32 {
    return 1.0 - smoothstep(N.weld_near, N.weld_far, distance(pos[i].xyz, pos[j].xyz));
}

@compute @workgroup_size(64)
fn weld_positions(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N.n_verts) { return; }
    let p = pos[i].xyz;
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var k = weld_off[i]; k < weld_off[i + 1u]; k = k + 1u) {
        let j = weld[k];
        let w = weld_weight(i, j);
        acc = acc + w * (pos[j].xyz - p);
        wsum = wsum + w;
    }
    // All partners welded: the group's mean, the same point for each of them.
    draw_pos[i] = vec4<f32>(p + acc / (1.0 + wsum), 1.0);
}

// Area-weighted sum of the normals of the triangles around `i`.
fn face_sum(i: u32) -> vec3<f32> {
    var n = vec3<f32>(0.0);
    for (var k = adj_off[i]; k < adj_off[i + 1u]; k = k + 1u) {
        let t = adj[k] * 3u;
        let a = draw_pos[tris[t]].xyz;
        let b = draw_pos[tris[t + 1u]].xyz;
        let c = draw_pos[tris[t + 2u]].xyz;
        n = n + cross(b - a, c - a);
    }
    return n;
}

@compute @workgroup_size(64)
fn compute_normals(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N.n_verts) { return; }
    let own = face_sum(i);
    var n = own;
    for (var k = weld_off[i]; k < weld_off[i + 1u]; k = k + 1u) {
        let j = weld[k];
        var nj = face_sum(j);
        // A piece meshed the other way round: its side of the seam still faces ours.
        if (dot(nj, own) < 0.0) { nj = -nj; }
        n = n + weld_weight(i, j) * nj;
    }
    let l = length(n);
    nrm[i] = vec4<f32>(select(vec3<f32>(0.0, 1.0, 0.0), n / l, l > 0.0), 0.0);
}
