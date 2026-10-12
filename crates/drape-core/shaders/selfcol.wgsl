// Cloth self-collision (M4): vertex-vertex repulsion. Neighbours come from a spatial hash built
// with a counting sort. Shared by native and web (hard rule 2), no float atomics (hard rule 4):
// the only atomics are u32 cell counters.
//
// Rebuild (every `self_rebuild_every` substeps), hash kernels in hashgrid.wgsl (appended):
//   count, scan_local, scan_blocks, scatter: counting sort of the vertices by hash cell, into
//                the cell-sorted copy
//   query:       per vertex, the non-excluded vertices within query_radius (= radius +
//                margin, so the list stays valid until the next rebuild) -> neighbour list
// Every substep:
//   snapshot:    copy positions and this substep's displacement (Jacobi: read a snapshot,
//                write only your own vertex, so nothing races)
//   collide:     each vertex gathers the corrections from its listed neighbours, averaged,
//                summed in fixed point. A gather instead of the plan's fixed-point atomicAdd
//                scatter: no atomics on the corrections at all.

struct SelfParams {
    n_verts: u32,
    table_size: u32,   // power of two, multiple of 256
    n_blocks: u32,     // table_size / 256
    radius: f32,       // repulsion distance (m)
    inv_cell: f32,     // 1 / cell size (cell size = query_radius)
    friction: f32,     // Coulomb coefficient between cloth layers
    query_radius: f32, // neighbour-list radius (m)
    max_neighbors: u32,
    max_elastic: f32,  // push per substep that may turn into velocity (m)
    tangle_flags: u32, // 1 = skip pairs of vertices both flagged by untangling (S4)
    _p1: u32,
    _p2: u32,
};

@group(0) @binding(0) var<uniform> S: SelfParams;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4<f32>>;   // xyz, w = inverse mass
@group(0) @binding(2) var<storage, read_write> prev: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> cell_count: array<atomic<u32>>;
// [0, T): start of each cell within its block; [T, T + n_blocks): start of each block.
@group(0) @binding(4) var<storage, read_write> cell_start: array<u32>;
// [0, n): positions in cell order, vertex index as bits in w (rebuild only).
// [n, 2n): snapshot of positions (w = inverse mass); [2n, 3n): this substep's displacement.
@group(0) @binding(5) var<storage, read_write> sorted: array<vec4<f32>>;
// Excluded neighbours (close in the rest shape, or across a seam): CSR, offsets [0, n]
// pointing into the same array, each list sorted ascending.
@group(0) @binding(6) var<storage, read> excl: array<u32>;
// Neighbour lists: row i = [count found (may exceed max_neighbors), up to max_neighbors ids].
@group(0) @binding(7) var<storage, read_write> nbr: array<u32>;
// Untangling's accumulator (untangle.wgsl); [5n, 6n) = 1 for vertices of a triangle that was in
// an intersecting pair at the last detection. A 1-element dummy when untangling is off.
@group(0) @binding(8) var<storage, read> tangled: array<u32>;

fn hash_n_items() -> u32 {
    return S.n_verts;
}

@compute @workgroup_size(64)
fn sc_count(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= S.n_verts) { return; }
    atomicAdd(&cell_count[hash(cell_of(pos[i].xyz))], 1u);
}

@compute @workgroup_size(64)
fn sc_scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= S.n_verts) { return; }
    let p = pos[i];
    let h = hash(cell_of(p.xyz));
    let k = atomicSub(&cell_count[h], 1u) - 1u;
    sorted[cell_begin(h) + k] = vec4<f32>(p.xyz, bitcast<f32>(i));
}

fn excluded(a: u32, b: u32, j: u32) -> bool {
    var lo = a;
    var hi = b;
    while (lo < hi) {
        let m = (lo + hi) / 2u;
        let v = excl[m];
        if (v == j) { return true; }
        if (v < j) { lo = m + 1u; } else { hi = m; }
    }
    return false;
}

// One thread per sorted slot (neighbouring threads look at neighbouring cells). Cell size =
// query radius, so every neighbour in range is in the 3x3x3 block, read as 9 x-rows of 3
// consecutive hash slots. Slots shared with other cells only add candidates (rejected by
// distance); a row that crosses the end of the table is read as two ranges. Two rows of the
// block can overlap in slots, so a vertex may be listed twice (rare, harmless with averaging).
@compute @workgroup_size(64)
fn sc_query(@builtin(global_invocation_id) gid: vec3<u32>) {
    let s = gid.x;
    let n = S.n_verts;
    if (s >= n) { return; }
    let p = sorted[s];
    let i = bitcast<u32>(p.w);
    let e0 = excl[i];
    let e1 = excl[i + 1u];
    let rq2 = S.query_radius * S.query_radius;
    let c0 = cell_of(p.xyz);
    let row = i * (S.max_neighbors + 1u);
    let mask = S.table_size - 1u;
    var cnt = 0u;
    for (var dz = -1; dz <= 1; dz = dz + 1) {
        for (var dy = -1; dy <= 1; dy = dy + 1) {
            let h0 = hash(c0 + vec3<i32>(-1, dy, dz));
            let h2 = (h0 + 2u) & mask;
            // [a0, b0) and, if the row wraps, [a1, b1).
            var a0 = cell_begin(h0);
            var b0 = cell_end(h2);
            var a1 = 0u;
            var b1 = 0u;
            if (h2 < h0) {
                b0 = n;
                b1 = cell_end(h2);
            }
            for (var part = 0u; part < 2u; part = part + 1u) {
                var k = a0;
                var b = b0;
                if (part == 1u) { k = a1; b = b1; }
                for (; k < b; k = k + 1u) {
                    if (k == s) { continue; }
                    let q = sorted[k];
                    let d = p.xyz - q.xyz;
                    if (dot(d, d) >= rq2) { continue; }
                    let j = bitcast<u32>(q.w);
                    if (excluded(e0, e1, j)) { continue; }
                    if (cnt < S.max_neighbors) { nbr[row + 1u + cnt] = j; }
                    cnt = cnt + 1u;
                }
            }
        }
    }
    nbr[row] = cnt;
}

@compute @workgroup_size(64)
fn sc_snapshot(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let n = S.n_verts;
    if (i >= n) { return; }
    let p = pos[i];
    sorted[n + i] = p;
    sorted[2u * n + i] = vec4<f32>(p.xyz - prev[i].xyz, 0.0);
}

// Corrections are summed in fixed point (1e-8 m units): integer addition is associative, so
// the result doesn't depend on the order of the neighbour list (which comes from the atomic
// scatter and varies run to run). Keeps the solver bit-reproducible, native and browsers.
const FIXED: f32 = 1e8;
const FIXED_MAX: f32 = 3e7; // per term: 0.3 m, far above any real correction; x32 terms < 2^31

fn fx(v: vec3<f32>) -> vec3<i32> {
    return vec3<i32>(round(clamp(v * FIXED, vec3<f32>(-FIXED_MAX), vec3<f32>(FIXED_MAX))));
}

@compute @workgroup_size(64)
fn sc_collide(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let n = S.n_verts;
    if (i >= n) { return; }
    let p = sorted[n + i];
    if (p.w == 0.0) { return; }
    let dp = sorted[2u * n + i];
    let r = S.radius;
    let row = i * (S.max_neighbors + 1u);
    let m = min(nbr[row], S.max_neighbors);
    var corr = vec3<i32>(0);
    var corr_v = vec3<i32>(0);
    var cnt = 0u;
    let flagged = S.tangle_flags != 0u && tangled[5u * n + i] != 0u;
    for (var k = 0u; k < m; k = k + 1u) {
        let j = nbr[row + 1u + k];
        // Both vertices at a crossing (S4): repulsion would hold the two layers on the wrong
        // sides of each other; the untangling pass moves them back through instead.
        if (flagged && tangled[5u * n + j] != 0u) { continue; }
        let q = sorted[n + j];
        let d = p.xyz - q.xyz;
        let d2 = dot(d, d);
        if (d2 >= r * r || d2 < 1e-12) { continue; }
        let dist = sqrt(d2);
        let nrm = d / dist;
        let share = p.w / (p.w + q.w);
        let push = nrm * ((r - dist) * share);
        // Friction: cancel relative sliding between the layers this substep, within the
        // Coulomb cone of the push.
        let rel = dp.xyz - sorted[2u * n + j].xyz;
        let rt = rel - dot(rel, nrm) * nrm;
        let lt = length(rt);
        var f = vec3<f32>(0.0);
        if (lt > 1e-9) {
            f = rt * (share * min(1.0, S.friction * (r - dist) / lt));
        }
        corr = corr + fx(push - f);
        // Remove this vertex's share of the approach velocity (shift prev). The push itself is
        // elastic up to `max_elastic` per substep and inelastic beyond: fully inelastic (as for
        // the body) turned every fight between the repulsion and another constraint (the drag,
        // the body) into fake velocity; fully elastic launched deep overlaps (a crossing caught
        // at 1 mm becomes a 3 m/s kick).
        let pl = (r - dist) * share;
        let excess = max(pl - S.max_elastic, 0.0);
        corr_v = corr_v + fx(nrm * (share * min(dot(rel, nrm), 0.0) + excess));
        cnt = cnt + 1u;
    }
    if (cnt == 0u) { return; }
    let inv = 1.0 / (f32(cnt) * FIXED);
    pos[i] = vec4<f32>(p.xyz + vec3<f32>(corr) * inv, p.w);
    let pv = prev[i];
    prev[i] = vec4<f32>(pv.xyz + vec3<f32>(corr_v) * inv, pv.w);
}
