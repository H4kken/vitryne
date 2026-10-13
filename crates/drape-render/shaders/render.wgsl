// SPDX-License-Identifier: AGPL-3.0-or-later
// Simple two-sided Lambert + ambient. No PBR, no textures (out of scope).

struct Camera {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    light_dir: vec4<f32>,  // towards the light
};

struct Material {
    front: vec4<f32>,
    back: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<uniform> mat: Material;

struct VIn {
    @location(0) pos: vec4<f32>,
    @location(1) nrm: vec4<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) n: vec3<f32>,
};

@vertex
fn vs_main(v: VIn) -> VOut {
    var o: VOut;
    o.clip = cam.view_proj * vec4<f32>(v.pos.xyz, 1.0);
    o.n = v.nrm.xyz;
    return o;
}

@fragment
fn fs_main(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4<f32> {
    var n = normalize(in.n);
    var base = mat.front.rgb;
    if (!ff) {
        n = -n;
        base = mat.back.rgb;
    }
    let l = normalize(cam.light_dir.xyz);
    let diffuse = max(dot(n, l), 0.0);
    let sky = 0.5 + 0.5 * n.y;  // hemisphere ambient
    return vec4<f32>(base * (0.2 + 0.15 * sky + 0.7 * diffuse), 1.0);
}
