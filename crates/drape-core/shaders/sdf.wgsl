// Shared SDF sampling, prepended to sim.wgsl and metrics.wgsl (one source for every target).
// The including shader declares `sdf_values: array<f32>` (grid values at cell corners, x fastest).
// No float filtering on 3D textures in core WebGPU, so trilinear is done by hand.

// Returns (distance, gradient). Outside the grid: (band, 0) = "far, no contact".
fn sdf_eval(p: vec3<f32>, origin_cell: vec4<f32>, dims: vec4<u32>, band: f32) -> vec4<f32> {
    let g = (p - origin_cell.xyz) / origin_cell.w;
    let maxc = vec3<f32>(dims.xyz - vec3<u32>(1u));
    if (any(g < vec3<f32>(0.0)) || any(g > maxc)) {
        return vec4<f32>(band, 0.0, 0.0, 0.0);
    }
    let gc = min(g, maxc - vec3<f32>(1e-4));
    let i = vec3<u32>(floor(gc));
    let f = gc - floor(gc);
    let sx = 1u;
    let sy = dims.x;
    let sz = dims.x * dims.y;
    let b = i.x + i.y * sy + i.z * sz;
    let c000 = sdf_values[b];
    let c100 = sdf_values[b + sx];
    let c010 = sdf_values[b + sy];
    let c110 = sdf_values[b + sx + sy];
    let c001 = sdf_values[b + sz];
    let c101 = sdf_values[b + sx + sz];
    let c011 = sdf_values[b + sy + sz];
    let c111 = sdf_values[b + sx + sy + sz];
    // Interpolate along x, then y, then z, keeping the partial derivatives.
    let c00 = mix(c000, c100, f.x);
    let c10 = mix(c010, c110, f.x);
    let c01 = mix(c001, c101, f.x);
    let c11 = mix(c011, c111, f.x);
    let c0 = mix(c00, c10, f.y);
    let c1 = mix(c01, c11, f.y);
    let d = mix(c0, c1, f.z);
    let dx = mix(mix(c100 - c000, c110 - c010, f.y), mix(c101 - c001, c111 - c011, f.y), f.z);
    let dy = mix(c10 - c00, c11 - c01, f.z);
    let dz = c1 - c0;
    return vec4<f32>(d, vec3<f32>(dx, dy, dz) / origin_cell.w);
}
