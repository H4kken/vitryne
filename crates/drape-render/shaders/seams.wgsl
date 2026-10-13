// SPDX-License-Identifier: AGPL-3.0-or-later
// Seam lines on the cloth: one screen-space quad per segment between two cloth vertices, a few
// pixels wide whatever the zoom, pulled slightly towards the camera so it sits on the cloth.

struct Camera {
    view_proj: mat4x4<f32>,
    eye: vec4<f32>,
    light_dir: vec4<f32>,
};

struct Params {
    viewport: vec2<f32>,
    half_width_px: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(1) @binding(0) var<storage, read> pos: array<vec4<f32>>;
@group(1) @binding(1) var<uniform> params: Params;

struct VIn {
    @builtin(vertex_index) vi: u32,
    @location(0) seg: vec2<u32>,
    @location(1) color: vec4<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(v: VIn) -> VOut {
    let a = cam.view_proj * vec4<f32>(pos[v.seg.x].xyz, 1.0);
    let b = cam.view_proj * vec4<f32>(pos[v.seg.y].xyz, 1.0);
    // Corners of the quad: (end, side) for the two triangles.
    var ends = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
    var sides = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);
    let end = ends[v.vi];
    let side = sides[v.vi];
    var o: VOut;
    o.color = v.color;
    let base = select(a, b, end == 1u);
    if (a.w <= 0.0 || b.w <= 0.0) {
        o.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);  // behind the camera: off screen
        return o;
    }
    let da = a.xy / a.w;
    let db = b.xy / b.w;
    var dir = (db - da) * params.viewport;
    let len = length(dir);
    if (len < 1e-4) {
        dir = vec2<f32>(1.0, 0.0);
    } else {
        dir = dir / len;
    }
    let n = vec2<f32>(-dir.y, dir.x);
    let offset = n * side * params.half_width_px * 2.0 / params.viewport;
    o.clip = vec4<f32>(base.xy + offset * base.w, base.z - 4e-4 * base.w, base.w);
    return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    return in.color;
}
