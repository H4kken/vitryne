// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-vertex normals by gathering incident triangles (CSR), so no float atomics are needed.

struct NParams {
    n_verts: u32,
    _p0: u32,
    _p1: u32,
    _p2: u32,
};

@group(0) @binding(0) var<uniform> N: NParams;
@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> tris: array<u32>;
@group(0) @binding(3) var<storage, read> adj_off: array<u32>;
@group(0) @binding(4) var<storage, read> adj: array<u32>;
@group(0) @binding(5) var<storage, read_write> nrm: array<vec4<f32>>;

@compute @workgroup_size(64)
fn compute_normals(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= N.n_verts) { return; }
    var n = vec3<f32>(0.0);
    for (var k = adj_off[i]; k < adj_off[i + 1u]; k = k + 1u) {
        let t = adj[k] * 3u;
        let a = pos[tris[t]].xyz;
        let b = pos[tris[t + 1u]].xyz;
        let c = pos[tris[t + 2u]].xyz;
        n = n + cross(b - a, c - a); // area-weighted
    }
    let l = length(n);
    nrm[i] = vec4<f32>(select(vec3<f32>(0.0, 1.0, 0.0), n / l, l > 0.0), 0.0);
}
