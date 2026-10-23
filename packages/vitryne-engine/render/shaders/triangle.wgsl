// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke-test shader. Shared verbatim by native and web (hard rule 2).

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    var p = array<vec2<f32>, 3>(vec2(0.0, 0.6), vec2(-0.6, -0.5), vec2(0.6, -0.5));
    var c = array<vec3<f32>, 3>(vec3(1.0, 0.2, 0.2), vec3(0.2, 1.0, 0.2), vec3(0.2, 0.3, 1.0));
    var out: VsOut;
    out.pos = vec4(p[vi], 0.0, 1.0);
    out.color = c[vi];
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    return vec4(in.color, 1.0);
}
