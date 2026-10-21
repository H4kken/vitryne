// SPDX-License-Identifier: AGPL-3.0-or-later
// XPBD cloth, small steps (Macklin et al. 2019): one iteration per substep, so lambda starts at
// zero every substep and never has to be stored. Shared by native and web (hard rule 2).
//
// Per substep: predict -> stretch (one dispatch per colour) -> sew (per colour)
//              -> bend (per colour) -> collide (sphere or SDF) -> update_velocity.
// Prepended at build time: sdf.wgsl (sdf_eval).

struct Params {
    gravity_dt: vec4<f32>,  // xyz = gravity (m/s², already ramped), w = substep dt (s)
    sphere: vec4<f32>,      // xyz = centre, w = radius (m)
    sdf_origin: vec4<f32>,  // xyz = grid origin, w = cell size (m)
    sdf_dims: vec4<u32>,    // xyz = grid dims (corner samples)
    n_verts: u32,
    damping: f32,           // linear velocity damping (1/s)
    thickness: f32,         // collision offset (m)
    friction: f32,          // Coulomb coefficient against the collider
    sew_compliance: f32,    // ramped from soft to stiff while sewing
    sew_max_step: f32,      // max sewing correction per vertex per substep (m)
    sdf_band: f32,
    stretch_damping: f32,   // Rayleigh beta (s): gamma = beta / h, Macklin et al. 2016 eq. 26
    drag_target: vec4<f32>, // xyz = where the grabbed patch's centre is pulled, w = compliance
    drag_count: u32,        // vertices in the grabbed patch, 0 = no drag
    contact_max_step: f32,  // max collision push-out per substep (m)
    air_drag: f32,          // quadratic air drag k = 0.5 rho Cd / areal density (1/m)
    contact_dv_max: f32,    // S3 velocity filter: max speed gain per substep in body contact (m/s), 0 = off
    contact_vfriction: f32, // S3: velocity-level Coulomb coefficient in body contact, 0 = off
    strain_limit: f32,      // M2: max edge strain after the contact pass (Provot 1995), 0 = off
    _p4: u32,
    _p5: u32,
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
@group(0) @binding(4) var<storage, read> sdf_values: array<f32>;

@group(1) @binding(0) var<uniform> R: Range;
// Stretch constraints, followed by the sewing constraints (same layout, rest = 0).
@group(1) @binding(1) var<storage, read> stretch: array<Stretch>;
@group(1) @binding(2) var<storage, read> bend: array<Bend>;
// Grabbed patch: (vertex index as bits in w, offset from the patch centre in xyz).
@group(1) @binding(3) var<storage, read> drag_patch: array<vec4<f32>>;

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
    // Quadratic air drag, semi-implicit so it stays stable at any speed. Negligible at drape
    // speeds, strong for whipping free edges.
    v = v / (1.0 + P.air_drag * length(v) * dt);
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
    let n = d / len;
    // Damping: resist the relative velocity along the edge this substep (internal friction).
    // Stiffness-proportional: damping coefficient beta * k, so gamma = alpha~ * (h^2 beta k) / h
    // = beta / h (Macklin et al. 2016 eq. 26, beta~ = h^2 * damping coefficient).
    let gamma = P.stretch_damping / dt;
    let rel = dot(n, (pi.xyz - prev[c.i].xyz) - (pj.xyz - prev[c.j].xyz));
    let dl = (-(len - c.rest) - gamma * rel) / ((1.0 + gamma) * w + alpha);
    pos[c.i] = vec4<f32>(pi.xyz + (pi.w * dl) * n, pi.w);
    pos[c.j] = vec4<f32>(pj.xyz - (pj.w * dl) * n, pj.w);
}

// M2 strain limiting (Provot 1995, "Deformation constraints in a mass-spring model to describe
// rigid cloth behavior", Graphics Interface): after the body contact, every edge longer than
// (1 + strain_limit) x rest is shortened to that length. One Gauss-Seidel sweep, per colour.
@compute @workgroup_size(64)
fn limit_stretch(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= R.count) { return; }
    let c = stretch[R.offset + gid.x];
    let pi = pos[c.i];
    let pj = pos[c.j];
    let w = pi.w + pj.w;
    if (w == 0.0) { return; }
    let d = pi.xyz - pj.xyz;
    let len = length(d);
    let lim = c.rest * (1.0 + P.strain_limit);
    if (len <= lim) { return; }
    let dl = (lim - len) / w;
    let n = d / len;
    pos[c.i] = vec4<f32>(pi.xyz + (pi.w * dl) * n, pi.w);
    pos[c.j] = vec4<f32>(pj.xyz - (pj.w * dl) * n, pj.w);
}

// Zero-length seam constraint with ramped compliance and a per-substep step clamp, so seams
// close smoothly instead of snapping (the plan's main explosion risk).
@compute @workgroup_size(64)
fn solve_sew(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= R.count) { return; }
    let c = stretch[R.offset + gid.x];
    let pi = pos[c.i];
    let pj = pos[c.j];
    let w = pi.w + pj.w;
    if (w == 0.0) { return; }
    let d = pi.xyz - pj.xyz;
    let dt = P.gravity_dt.w;
    let alpha = P.sew_compliance / (dt * dt);
    // C = |d|, gradient = d/|d|: the update is along d with magnitude |d| * w / (w + alpha).
    var corr = -d / (w + alpha);
    let m = max(pi.w, pj.w) * length(corr);
    if (m > P.sew_max_step) {
        corr = corr * (P.sew_max_step / m);
    }
    pos[c.i] = vec4<f32>(pi.xyz + pi.w * corr, pi.w);
    pos[c.j] = vec4<f32>(pj.xyz - pj.w * corr, pj.w);
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

// Project out to the contact surface along `n`, then cancel tangential motion over this
// substep, limited by the Coulomb cone (normal correction depth * mu). The push-out per substep
// is capped: in narrow creases (between the thighs, armpits) the gradient flips between
// neighbouring vertices, and full projections there turn into large velocity kicks.
fn contact(i: u32, p: vec4<f32>, n: vec3<f32>, depth_in: f32) {
    let depth = min(depth_in, P.contact_max_step);
    var x = p.xyz + n * depth;
    let dx = x - prev[i].xyz;
    let dxt = dx - dot(dx, n) * n;
    let lt = length(dxt);
    if (lt > 0.0) {
        x = x - dxt * min(1.0, P.friction * depth / lt);
    }
    pos[i] = vec4<f32>(x, p.w);
    // Inelastic contact: the push-out moves the vertex but must not launch it. Shift `prev` so
    // the outward normal velocity this substep is zero (otherwise a 6 mm push-out in one
    // substep becomes a 7 m/s kick). Tangential motion (after friction) is untouched.
    let pv = prev[i];
    let vn = dot(x - pv.xyz, n);
    var shift = 0.0;
    if (vn > 0.0) {
        prev[i] = vec4<f32>(pv.xyz + n * vn, pv.w);
        shift = vn;
    }
    // For the velocity filter in update_velocity: how far contact moved the vertex along n this
    // substep (push-out + the removed outward velocity), i.e. the normal impulse / (m / h).
    vel[i].w = depth + shift;
}

// Mouse drag: zero-length XPBD attachments of a small patch (picked vertex + connected
// neighbours, <= 32) to a moving target, keeping their offsets. Applied at the start of the
// collide pass (per-vertex lookup, no extra dispatch), so collision still wins.
fn apply_drag(i: u32, p: vec4<f32>) -> vec4<f32> {
    if (P.drag_count == 0u || p.w == 0.0) { return p; }
    for (var k = 0u; k < P.drag_count; k = k + 1u) {
        let e = drag_patch[k];
        if (bitcast<u32>(e.w) == i) {
            let dt = P.gravity_dt.w;
            let alpha = P.drag_target.w / (dt * dt);
            let t = P.drag_target.xyz + e.xyz;
            return vec4<f32>(p.xyz + (t - p.xyz) * (p.w / (p.w + alpha)), p.w);
        }
    }
    return p;
}

@compute @workgroup_size(64)
fn collide_sphere(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= P.n_verts) { return; }
    let p = apply_drag(i, pos[i]);
    pos[i] = p;
    if (p.w == 0.0) { return; }
    let d = p.xyz - P.sphere.xyz;
    let dist = length(d);
    let r = P.sphere.w + P.thickness;
    if (dist >= r || dist < 1e-9) { return; }
    contact(i, p, d / dist, r - dist);
}

@compute @workgroup_size(64)
fn collide_sdf(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= P.n_verts) { return; }
    let p = apply_drag(i, pos[i]);
    pos[i] = p;
    if (p.w == 0.0) { return; }
    let s = sdf_eval(p.xyz, P.sdf_origin, P.sdf_dims, P.sdf_band);
    if (s.x >= P.thickness) { return; }
    let gl = length(s.yzw);
    if (gl < 1e-6) { return; }
    contact(i, p, s.yzw / gl, P.thickness - s.x);
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
    let h = P.gravity_dt.w;
    var v = (p.xyz - prev[i].xyz) / h;
    // S3 contact velocity filter, for vertices the body contact moved this substep (w > 0).
    // In a crease, stretch pulls a vertex into the body and the projection pushes it back out
    // along n, not back along the pull; the sideways remainder becomes velocity every substep.
    let c = vel[i].w;
    if (c > 0.0) {
        if (P.contact_vfriction > 0.0) {
            // Coulomb friction on the velocity, with the normal impulse the contact applied
            // this substep (Bridson, Fedkiw & Anderson 2002, "Robust treatment of collisions,
            // contact and friction for cloth animation", sec. 7.2).
            let s = sdf_eval(p.xyz, P.sdf_origin, P.sdf_dims, P.sdf_band);
            let gl = length(s.yzw);
            if (gl > 1e-6) {
                let n = s.yzw / gl;
                let vn = dot(v, n);
                let vt = v - vn * n;
                let lt = length(vt);
                if (lt > 0.0) {
                    v = vn * n + vt * max(0.0, 1.0 - P.contact_vfriction * (c / h) / lt);
                }
            }
        }
        if (P.contact_dv_max > 0.0) {
            // Contact may stop a vertex at once, but not speed it up by more than dv_max per
            // substep: what the body does is push back, not launch.
            let s0 = length(vel[i].xyz);
            let s1 = length(v);
            if (s1 > s0 + P.contact_dv_max) {
                v = v * ((s0 + P.contact_dv_max) / s1);
            }
        }
    }
    vel[i] = vec4<f32>(v, 0.0);
}
