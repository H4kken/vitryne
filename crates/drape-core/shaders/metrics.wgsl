// GPU reduction of per-frame metrics so the bench reads back 16 bytes, not the whole mesh.
// result = (kinetic energy J, max speed m/s, min signed distance to sphere m, non-finite count)

struct MParams {
    sphere: vec4<f32>,
    n_verts: u32,
    n_partials: u32,
    _p0: u32,
    _p1: u32,
};

@group(0) @binding(0) var<uniform> M: MParams;
@group(0) @binding(1) var<storage, read> pos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> vel: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> partials: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> result: array<vec4<f32>>;

const WG: u32 = 64u;
var<workgroup> s: array<vec4<f32>, 64>;

// Exponent all ones = inf or NaN. Bit test, because `x != x` may be folded away by fast-math.
fn bad(v: vec4<f32>) -> bool {
    let e = vec4<u32>(0x7f800000u);
    return any((bitcast<vec4<u32>>(v) & e) == e);
}

fn identity() -> vec4<f32> {
    return vec4<f32>(0.0, 0.0, 1e9, 0.0);
}

fn combine(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(a.x + b.x, max(a.y, b.y), min(a.z, b.z), a.w + b.w);
}

fn tree(li: u32) {
    for (var off = WG / 2u; off > 0u; off = off >> 1u) {
        if (li < off) {
            s[li] = combine(s[li], s[li + off]);
        }
        workgroupBarrier();
    }
}

@compute @workgroup_size(64)
fn reduce_vertices(@builtin(global_invocation_id) gid: vec3<u32>,
                   @builtin(local_invocation_index) li: u32,
                   @builtin(workgroup_id) wid: vec3<u32>) {
    var a = identity();
    let i = gid.x;
    if (i < M.n_verts) {
        let p = pos[i];
        let v = vel[i];
        if (bad(p) || bad(v)) {
            a.w = 1.0;
        } else {
            if (p.w > 0.0) {
                let v2 = dot(v.xyz, v.xyz);
                a.x = 0.5 * v2 / p.w;
                a.y = sqrt(v2);
            }
            a.z = length(p.xyz - M.sphere.xyz) - M.sphere.w;
        }
    }
    s[li] = a;
    workgroupBarrier();
    tree(li);
    if (li == 0u) {
        partials[wid.x] = s[0];
    }
}

@compute @workgroup_size(64)
fn reduce_partials(@builtin(local_invocation_index) li: u32) {
    var a = identity();
    for (var i = li; i < M.n_partials; i = i + WG) {
        a = combine(a, partials[i]);
    }
    s[li] = a;
    workgroupBarrier();
    tree(li);
    if (li == 0u) {
        result[0] = s[0];
    }
}
