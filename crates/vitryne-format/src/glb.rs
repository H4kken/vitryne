// SPDX-License-Identifier: AGPL-3.0-or-later
//! Just enough glTF 2.0 binary for avatar meshes (FORMAT.md, Avatar): triangles, positions in
//! metres, optional indices. Reading takes every triangle primitive of the first mesh and
//! ignores node transforms (an avatar mesh is already in avatar space).

use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    /// Triangle list.
    pub indices: Vec<u32>,
}

const MAGIC: u32 = 0x4654_6c67; // "glTF"
const CHUNK_JSON: u32 = 0x4e4f_534a;
const CHUNK_BIN: u32 = 0x004e_4942;

pub fn write(mesh: &Mesh, generator: &str) -> Vec<u8> {
    let vbytes: Vec<u8> = mesh
        .positions
        .iter()
        .flatten()
        .flat_map(|x| x.to_le_bytes())
        .collect();
    let ibytes: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for p in &mesh.positions {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let gltf = json!({
        "asset": { "version": "2.0", "generator": generator },
        "scene": 0,
        "scenes": [{ "nodes": [0] }],
        "nodes": [{ "mesh": 0, "name": "body" }],
        "meshes": [{ "name": "body", "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }],
        "accessors": [
            { "bufferView": 0, "componentType": 5126, "count": mesh.positions.len(), "type": "VEC3", "min": lo, "max": hi },
            { "bufferView": 1, "componentType": 5125, "count": mesh.indices.len(), "type": "SCALAR" }
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": vbytes.len(), "target": 34962 },
            { "buffer": 0, "byteOffset": vbytes.len(), "byteLength": ibytes.len(), "target": 34963 }
        ],
        "buffers": [{ "byteLength": vbytes.len() + ibytes.len() }]
    });
    let mut js = serde_json::to_vec(&gltf).unwrap();
    js.resize(js.len().div_ceil(4) * 4, b' ');
    let mut bin = vbytes;
    bin.extend_from_slice(&ibytes);
    bin.resize(bin.len().div_ceil(4) * 4, 0);
    let total = 12 + 8 + js.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    for w in [MAGIC, 2, total as u32, js.len() as u32, CHUNK_JSON] {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out.extend_from_slice(&js);
    for w in [bin.len() as u32, CHUNK_BIN] {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out.extend_from_slice(&bin);
    out
}

pub fn read(bytes: &[u8]) -> Result<Mesh, String> {
    let u32_at = |o: usize| -> Result<u32, String> {
        bytes
            .get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .ok_or_else(|| "glb: truncated".to_string())
    };
    if u32_at(0)? != MAGIC || u32_at(4)? != 2 {
        return Err("not a glTF 2.0 binary".into());
    }
    let (mut gltf, mut bin): (Option<Value>, &[u8]) = (None, &[]);
    let mut o = 12;
    while o + 8 <= bytes.len() {
        let (len, kind) = (u32_at(o)? as usize, u32_at(o + 4)?);
        let data = bytes
            .get(o + 8..o + 8 + len)
            .ok_or("glb: truncated chunk")?;
        match kind {
            CHUNK_JSON => {
                gltf = Some(serde_json::from_slice(data).map_err(|e| format!("glb JSON: {e}"))?)
            }
            CHUNK_BIN => bin = data,
            _ => {}
        }
        o += 8 + len;
    }
    let g = gltf.ok_or("glb: no JSON chunk")?;
    let num = |v: &Value, what: &str| {
        v.as_u64()
            .map(|x| x as usize)
            .ok_or_else(|| format!("glb: {what} missing"))
    };
    // An accessor's bytes: (data, element stride, count, component type, components).
    let accessor = |i: usize| -> Result<(&[u8], usize, usize, u64, usize), String> {
        let a = &g["accessors"][i];
        let comps = match a["type"].as_str() {
            Some("SCALAR") => 1,
            Some("VEC3") => 3,
            other => return Err(format!("glb: accessor type {other:?} not supported")),
        };
        let ctype = a["componentType"].as_u64().unwrap_or(0);
        let csize = match ctype {
            5121 => 1,
            5123 => 2,
            5125 | 5126 => 4,
            other => return Err(format!("glb: component type {other} not supported")),
        };
        let view = &g["bufferViews"][num(&a["bufferView"], "bufferView")?];
        if view["buffer"].as_u64().unwrap_or(0) != 0 {
            return Err("glb: only the binary chunk's buffer is supported".into());
        }
        let start = view["byteOffset"].as_u64().unwrap_or(0) as usize
            + a["byteOffset"].as_u64().unwrap_or(0) as usize;
        let stride = view["byteStride"]
            .as_u64()
            .map_or(csize * comps, |s| s as usize);
        let count = num(&a["count"], "accessor count")?;
        let end = start + stride * count.saturating_sub(1) + csize * comps;
        let data = bin
            .get(start..end.max(start))
            .ok_or("glb: accessor outside the buffer")?;
        Ok((data, stride, count, ctype, comps))
    };
    let mut mesh = Mesh::default();
    let prims = g["meshes"][0]["primitives"]
        .as_array()
        .ok_or("glb: no mesh")?;
    for p in prims {
        if p["mode"].as_u64().unwrap_or(4) != 4 {
            return Err("glb: only triangle lists are supported".into());
        }
        let (data, stride, count, ctype, comps) =
            accessor(num(&p["attributes"]["POSITION"], "POSITION")?)?;
        if ctype != 5126 || comps != 3 {
            return Err("glb: POSITION must be float VEC3".into());
        }
        let base = mesh.positions.len() as u32;
        for k in 0..count {
            let e = &data[k * stride..];
            mesh.positions
                .push([0, 4, 8].map(|o| f32::from_le_bytes(e[o..o + 4].try_into().unwrap())));
        }
        if p["indices"].is_null() {
            mesh.indices.extend((0..count as u32).map(|i| base + i));
        } else {
            let (data, stride, count, ctype, _) = accessor(num(&p["indices"], "indices")?)?;
            for k in 0..count {
                let e = &data[k * stride..];
                let i = match ctype {
                    5121 => e[0] as u32,
                    5123 => u16::from_le_bytes([e[0], e[1]]) as u32,
                    5125 => u32::from_le_bytes(e[..4].try_into().unwrap()),
                    _ => return Err("glb: indices must be unsigned integers".into()),
                };
                mesh.indices.push(base + i);
            }
        }
    }
    let n = mesh.positions.len() as u32;
    if mesh.indices.len() % 3 != 0 || mesh.indices.iter().any(|&i| i >= n) {
        return Err("glb: indices don't form triangles over the vertices".into());
    }
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let m = Mesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.5, -2.0]],
            indices: vec![0, 1, 2],
        };
        let b = write(&m, "test");
        assert_eq!(b.len() % 4, 0);
        assert_eq!(read(&b).unwrap(), m);
        assert!(read(&b[..20]).is_err());
    }
}
