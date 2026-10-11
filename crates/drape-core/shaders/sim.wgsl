// XPBD cloth, small steps (Macklin et al. 2019): one iteration per substep, so lambda starts at
// zero every substep and never has to be stored. Shared by native and web (hard rule 2).
//
// Per substep: predict -> stretch (one dispatch per colour) -> bend (per colour)
//              -> collide_sphere -> update_velocity.

struct Params {
    gravity_dt: vec4<f32>,  // xyz = gravity (m/s²), w = substep dt (s)
    sphere: vec4<f32>,      // xyz = centre, w = radius (m)
    n_verts: u32,
    damping: f32,           // linear velocity damping (1/s)
    thickness: f32,         // collision offset (m)
    friction: f32,          // Coulomb coefficient against the collider
};

// One entry per colour, selected with a dynamic uniform offset (no push constants: hard rule 1).
struct Range {
    offset: u32,
    count: u32,
    _p0: u32,
    _p1: u32,
};

struct Stretch {
    i: u32,
    j: u32,
    rest: f32,
    compliance: f32,
};

struct Bend {
    idx: vec4<u32>,
    k: vec4<f32>,
    compliance: f32,
    _p0: f32,
    _p1: f32,
    _p2: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;   // xyz, w = inverse mass
@group(0) @binding(2) var<storage, read_write> prev: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec4<f32>>;

@group(1) @binding(0) var<uniform> R: Range;
@group(1) @binding(1) var<storage, read> stretch: array<Stretch>;
@group(1) @binding(2) var<storage, read> bend: array<Bend>;

@compute @workgroup_size(64)
fn predict(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= P.n_verts) { return; }
    let p = pos[i];
    prev[i] = p;
    if (p.w == 0.0) { return; }
    let dt = P.gravity_dt.w;
    var v = vel[i].xyz + P.gravity_dt.xyz * dt;
    v = v * max(0.0, 1.0 - P.damping * dt);
    pos[i] = vec4<f32>(p.xyz + v * dt, p.w);
}

@compute @workgroup_size(64)
fn solve_stretch(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= R.count) { return; }
    let c = stretch[R.offset + gid.x];
    let pi = pos[c.i];
    let pj = pos[c.j];
    let w = pi.w + pj.w;
    if (w == 0.0) { return; }
    let d = pi.xyz - pj.xyz;
    let len = length(d);
    if (len < 1e-9) { return; }
    let dt = P.gravity_dt.w;
    let alpha = c.compliance / (dt * dt);
    let dl = -(len - c.rest) / (w + alpha);
    let n = d / len;
    pos[c.i] = vec4<f32>(pi.xyz + (pi.w * dl) * n, pi.w);
    pos[c.j] = vec4<f32>(pj.xyz - (pj.w * dl) * n, pj.w);
}

@compute @workgroup_size(64)
fn solve_bend(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= R.count) { return; }
    let b = bend[R.offset + gid.x];
    let p0 = pos[b.idx.x];
    let p1 = pos[b.idx.y];
    let p2 = pos[b.idx.z];
    let p3 = pos[b.idx.w];
    let k = b.k;
    // Linear vector constraint C = Σ k_i x_i, gradient k_i * I.
    let cv = k.x * p0.xyz + k.y * p1.xyz + k.z * p2.xyz + k.w * p3.xyz;
    let dt = P.gravity_dt.w;
    let alpha = b.compliance / (dt * dt);
    let denom = k.x * k.x * p0.w + k.y * k.y * p1.w + k.z * k.z * p2.w + k.w * k.w * p3.w + alpha;
    if (denom <= 0.0) { return; }
    let dl = -cv / denom;
    pos[b.idx.x] = vec4<f32>(p0.xyz + (p0.w * k.x) * dl, p0.w);
    pos[b.idx.y] = vec4<f32>(p1.xyz + (p1.w * k.y) * dl, p1.w);
    pos[b.idx.z] = vec4<f32>(p2.xyz + (p2.w * k.z) * dl, p2.w);
    pos[b.idx.w] = vec4<f32>(p3.xyz + (p3.w * k.w) * dl, p3.w);
}

@compute @workgroup_size(64)
fn collide_sphere(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= P.n_verts) { return; }
    let p = pos[i];
    if (p.w == 0.0) { return; }
    let c = P.sphere.xyz;
    let r = P.sphere.w + P.thickness;
    let d = p.xyz - c;
    let dist = length(d);
    if (dist >= r || dist < 1e-9) { return; }
    let n = d / dist;
    var x = c + n * r;
    // Friction: cancel tangential motion over this substep, limited by the Coulomb cone
    // (normal correction depth * mu).
    let depth = r - dist;
    let dx = x - prev[i].xyz;
    let dxt = dx - dot(dx, n) * n;
    let lt = length(dxt);
    if (lt > 0.0) {
        x = x - dxt * min(1.0, P.friction * depth / lt);
    }
    pos[i] = vec4<f32>(x, p.w);
}

@compute @workgroup_size(64)
fn update_velocity(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= P.n_verts) { return; }
    let p = pos[i];
    if (p.w == 0.0) {
        vel[i] = vec4<f32>(0.0);
        return;
    }
    vel[i] = vec4<f32>((p.xyz - prev[i].xyz) / P.gravity_dt.w, 0.0);
}
