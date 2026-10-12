
// Spatial hash by counting sort (M4), shared by self-collision (vertices) and untangling
// (triangle centroids, S4). Appended to each module, which declares:
//   S with table_size (power of two, multiple of 256), n_blocks (= table_size / 256) and
//     inv_cell (1 / cell size);
//   cell_count: array<atomic<u32>> [table_size], zero between rebuilds;
//   cell_start: array<u32> [table_size + n_blocks];
//   fn hash_n_items() -> u32, the number of hashed items.
//
//   count (module):   cell_count[hash(cell(x_i))] += 1                       (atomic u32)
//   hg_scan_local:    exclusive scan of cell_count inside each 256-cell block -> cell_start[c],
//                     block totals -> cell_start[T + block]
//   hg_scan_blocks:   exclusive scan of the block totals, in place (one workgroup)
//   scatter (module): slot = --cell_count[c] (counts return to zero: no clear pass)

var<workgroup> tmp: array<u32, 256>;

fn cell_of(p: vec3<f32>) -> vec3<i32> {
    return vec3<i32>(floor(p * S.inv_cell));
}

// Linear in x: the cells (x-1, y, z), (x, y, z), (x+1, y, z) land in consecutive slots, so a
// 3x3x3 query reads one contiguous range per (y, z) row, 9 lookups instead of 27.
fn hash(c: vec3<i32>) -> u32 {
    let u = bitcast<vec3<u32>>(c);
    return (((u.y * 19349663u) ^ (u.z * 83492791u)) + u.x) & (S.table_size - 1u);
}

fn cell_begin(h: u32) -> u32 {
    return cell_start[h] + cell_start[S.table_size + (h >> 8u)];
}

fn cell_end(h: u32) -> u32 {
    if (h + 1u < S.table_size) { return cell_begin(h + 1u); }
    return hash_n_items();
}

// Hillis-Steele inclusive scan of tmp[0..256) (all threads of the workgroup must call it).
fn scan_tmp(l: u32) {
    for (var off = 1u; off < 256u; off = off * 2u) {
        var t = 0u;
        if (l >= off) { t = tmp[l - off]; }
        workgroupBarrier();
        tmp[l] = tmp[l] + t;
        workgroupBarrier();
    }
}

@compute @workgroup_size(256)
fn hg_scan_local(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let l = lid.x;
    let c = wid.x * 256u + l;
    let v = atomicLoad(&cell_count[c]);
    tmp[l] = v;
    workgroupBarrier();
    scan_tmp(l);
    cell_start[c] = tmp[l] - v;
    if (l == 255u) {
        cell_start[S.table_size + wid.x] = tmp[255];
    }
}

// One workgroup; each thread scans a run of `per` consecutive blocks serially.
@compute @workgroup_size(256)
fn hg_scan_blocks(@builtin(local_invocation_id) lid: vec3<u32>) {
    let l = lid.x;
    let per = (S.n_blocks + 255u) / 256u;
    let b0 = l * per;
    var s = 0u;
    for (var k = 0u; k < per; k = k + 1u) {
        let b = b0 + k;
        if (b < S.n_blocks) { s = s + cell_start[S.table_size + b]; }
    }
    tmp[l] = s;
    workgroupBarrier();
    scan_tmp(l);
    var run = tmp[l] - s;
    for (var k = 0u; k < per; k = k + 1u) {
        let b = b0 + k;
        if (b < S.n_blocks) {
            let v = cell_start[S.table_size + b];
            cell_start[S.table_size + b] = run;
            run = run + v;
        }
    }
}
