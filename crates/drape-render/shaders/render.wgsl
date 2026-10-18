// SPDX-License-Identifier: AGPL-3.0-or-later
// Simple two-sided Lambert + ambient. No PBR, no textures (out of scope).
//
// Cloth with a thickness is drawn as a shell, two instances: instance 0 moved half the thickness
// out along the normal shows only its front faces, instance 1 moved in shows only its back faces.
// rim.wgsl closes it along the free edges.

struct Camera {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    light_dir: vec4<f32>,  // towards the light
};

struct Material {
    front: vec4<f32>,
    back: vec4<f32>,
    // x: half the thickness drawn, m (0: a plain surface, one instance).
    shell: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<uniform> mat: Material;

struct VIn {
    @builtin(instance_index) layer: u32,
    @location(0) pos: vec4<f32>,
    @location(1) nrm: vec4<f32>,
    // A panel's own colour (rgb), and how much it replaces the material's (a: 0 or 1).
    @location(2) tint: vec4<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) n: vec3<f32>,
    @location(1) tint: vec4<f32>,
    @location(2) @interpolate(flat) layer: u32,
};

@vertex
fn vs_main(v: VIn) -> VOut {
    var o: VOut;
    let side = select(1.0, -1.0, v.layer == 1u);
    let p = v.pos.xyz + v.nrm.xyz * (side * mat.shell.x);
    o.clip = cam.view_proj * vec4<f32>(p, 1.0);
    o.n = v.nrm.xyz;
    o.tint = v.tint;
    o.layer = v.layer;
    return o;
}

@fragment
fn fs_main(in: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4<f32> {
    if (mat.shell.x > 0.0 && ff != (in.layer == 0u)) {
        discard;  // the inside of the shell
    }
    var n = normalize(in.n);
    var base = mix(mat.front.rgb, in.tint.rgb, in.tint.a);
    if (!ff) {
        n = -n;
        // The wrong side of a coloured panel: its colour, a little darker.
        base = mix(mat.back.rgb, in.tint.rgb * 0.8, in.tint.a);
    }
    let l = normalize(cam.light_dir.xyz);
    let diffuse = max(dot(n, l), 0.0);
    let sky = 0.5 + 0.5 * n.y;  // hemisphere ambient
    return vec4<f32>(base * (0.2 + 0.15 * sky + 0.7 * diffuse), 1.0);
}
