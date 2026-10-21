// SPDX-License-Identifier: AGPL-3.0-or-later
// The cloth's cut edges: one quad per free mesh edge, from the outer layer of the shell to the
// inner one (render.wgsl), so a hem or a neckline shows the fabric's thickness. Edges along a
// closed seam are drawn too, but there they lie inside the shell and stay hidden.

struct Camera {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    light_dir: vec4<f32>,
};

struct Material {
    front: vec4<f32>,
    back: vec4<f32>,
    shell: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<uniform> mat: Material;
@group(2) @binding(0) var<storage, read> pos: array<vec4<f32>>;
@group(2) @binding(1) var<storage, read> nrm: array<vec4<f32>>;
@group(2) @binding(2) var<storage, read> tint: array<vec4<f32>>;
// Per edge: its two vertices, and the third vertex of its triangle (which side is inside).
@group(2) @binding(3) var<storage, read> edges: array<vec4<u32>>;

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) n: vec3<f32>,
    @location(1) tint: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ei: u32) -> VOut {
    let e = edges[ei];
    let pa = pos[e.x].xyz;
    let pb = pos[e.y].xyz;
    // Corners of the quad: (end, side) for the two triangles.
    var ends = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
    var sides = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);
    let v = select(e.x, e.y, ends[vi] == 1u);
    let p = pos[v].xyz + nrm[v].xyz * (sides[vi] * mat.shell.x);
    // Facing out of the cloth, across the edge, away from its triangle.
    var out = cross(pb - pa, nrm[e.x].xyz + nrm[e.y].xyz);
    if (dot(out, 0.5 * (pa + pb) - pos[e.z].xyz) < 0.0) {
        out = -out;
    }
    var o: VOut;
    o.clip = cam.view_proj * vec4<f32>(p, 1.0);
    o.n = out;
    o.tint = tint[v];
    return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    let len = length(in.n);
    let n = select(vec3<f32>(0.0, 1.0, 0.0), in.n / len, len > 0.0);
    // The cut edge: between the face and the back colour.
    let front = mix(mat.front.rgb, in.tint.rgb, in.tint.a);
    let back = mix(mat.back.rgb, in.tint.rgb * 0.8, in.tint.a);
    let base = mix(front, back, 0.5);
    let l = normalize(cam.light_dir.xyz);
    let diffuse = max(dot(n, l), 0.0);
    let sky = 0.5 + 0.5 * n.y;
    return vec4<f32>(base * (0.2 + 0.15 * sky + 0.7 * diffuse), 1.0);
}
