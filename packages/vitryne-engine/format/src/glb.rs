// SPDX-License-Identifier: AGPL-3.0-or-later
//! Just enough glTF 2.0 binary for avatar meshes (file-format.md, Avatar): triangles, positions in
//! metres, optional indices, and optionally a skin (`skin.rs`). Reading takes every triangle
//! primitive of the first mesh and ignores node transforms (an avatar mesh is already in avatar
//! space); a skin's joints are the exception, read with their translations.

use serde_json::{Value, json};

use crate::skin::{INFLUENCES, Joint, Skin};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    /// Triangle list.
    pub indices: Vec<u32>,
    /// A skeleton and per-vertex weights, if the file has them.
    pub skin: Option<Skin>,
}

const MAGIC: u32 = 0x4654_6c67; // "glTF"
const CHUNK_JSON: u32 = 0x4e4f_534a;
const CHUNK_BIN: u32 = 0x004e_4942;

pub fn write(mesh: &Mesh, generator: &str) -> Vec<u8> {
    if let Some(skin) = &mesh.skin {
        return write_skinned(mesh, skin, generator);
    }
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

/// `write` for a mesh with a skin: the same mesh node plus the skin (`JOINTS_0` as unsigned shorts,
/// `WEIGHTS_0` as floats), one node per joint with its translation from the joint above, and the
/// inverse bind matrices (a shift by minus the joint's rest position).
fn write_skinned(mesh: &Mesh, skin: &Skin, generator: &str) -> Vec<u8> {
    let mut vbytes: Vec<u8> = mesh
        .positions
        .iter()
        .flatten()
        .flat_map(|x| x.to_le_bytes())
        .collect();
    let ibytes: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    let jbytes: Vec<u8> = skin
        .joint_ids
        .iter()
        .flatten()
        .flat_map(|j| j.to_le_bytes())
        .collect();
    let wbytes: Vec<u8> = skin
        .weights
        .iter()
        .flatten()
        .flat_map(|w| w.to_le_bytes())
        .collect();
    let mbytes: Vec<u8> = skin
        .joints
        .iter()
        .flat_map(|j| {
            let [x, y, z] = j.rest;
            [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -x, -y, -z, 1.0,
            ]
        })
        .flat_map(|f: f32| f.to_le_bytes())
        .collect();
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for p in &mesh.positions {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let n = skin.joints.len();
    let mut nodes = vec![json!({ "mesh": 0, "skin": 0, "name": "body" })];
    let mut roots = vec![0];
    for (k, j) in skin.joints.iter().enumerate() {
        let local = match j.parent {
            Some(p) => [0, 1, 2].map(|c| j.rest[c] - skin.joints[p].rest[c]),
            None => j.rest,
        };
        let children: Vec<usize> = (0..n)
            .filter(|&c| skin.joints[c].parent == Some(k))
            .map(|c| c + 1)
            .collect();
        let mut node = json!({ "name": j.name, "translation": local });
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        nodes.push(node);
        if j.parent.is_none() {
            roots.push(k + 1);
        }
    }
    let lens = [
        vbytes.len(),
        ibytes.len(),
        jbytes.len(),
        wbytes.len(),
        mbytes.len(),
    ];
    let mut offsets = [0usize; 5];
    for k in 1..5 {
        offsets[k] = offsets[k - 1] + lens[k - 1];
    }
    let gltf = json!({
        "asset": { "version": "2.0", "generator": generator },
        "scene": 0,
        "scenes": [{ "nodes": roots }],
        "nodes": nodes,
        "skins": [{
            "inverseBindMatrices": 4,
            "joints": (1..=n).collect::<Vec<_>>(),
            "skeleton": roots.get(1).copied().unwrap_or(1),
        }],
        "meshes": [{ "name": "body", "primitives": [{
            "attributes": { "POSITION": 0, "JOINTS_0": 2, "WEIGHTS_0": 3 },
            "indices": 1,
        }] }],
        "accessors": [
            { "bufferView": 0, "componentType": 5126, "count": mesh.positions.len(), "type": "VEC3", "min": lo, "max": hi },
            { "bufferView": 1, "componentType": 5125, "count": mesh.indices.len(), "type": "SCALAR" },
            { "bufferView": 2, "componentType": 5123, "count": skin.joint_ids.len(), "type": "VEC4" },
            { "bufferView": 3, "componentType": 5126, "count": skin.weights.len(), "type": "VEC4" },
            { "bufferView": 4, "componentType": 5126, "count": n, "type": "MAT4" }
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": offsets[0], "byteLength": lens[0], "target": 34962 },
            { "buffer": 0, "byteOffset": offsets[1], "byteLength": lens[1], "target": 34963 },
            { "buffer": 0, "byteOffset": offsets[2], "byteLength": lens[2], "target": 34962 },
            { "buffer": 0, "byteOffset": offsets[3], "byteLength": lens[3], "target": 34962 },
            { "buffer": 0, "byteOffset": offsets[4], "byteLength": lens[4] }
        ],
        "buffers": [{ "byteLength": lens.iter().sum::<usize>() }]
    });
    let mut js = serde_json::to_vec(&gltf).unwrap();
    js.resize(js.len().div_ceil(4) * 4, b' ');
    for part in [&ibytes, &jbytes, &wbytes, &mbytes] {
        vbytes.extend_from_slice(part);
    }
    vbytes.resize(vbytes.len().div_ceil(4) * 4, 0);
    let total = 12 + 8 + js.len() + 8 + vbytes.len();
    let mut out = Vec::with_capacity(total);
    for w in [MAGIC, 2, total as u32, js.len() as u32, CHUNK_JSON] {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out.extend_from_slice(&js);
    for w in [vbytes.len() as u32, CHUNK_BIN] {
        out.extend_from_slice(&w.to_le_bytes());
    }
    out.extend_from_slice(&vbytes);
    out
}

#[derive(Debug, Clone, PartialEq)]
pub struct GltfMaterial {
    pub name: String,
    pub base_color_factor: [f32; 4],
    pub metallic_factor: f32,
    pub roughness_factor: f32,
    pub double_sided: bool,
}

impl Default for GltfMaterial {
    fn default() -> Self {
        Self {
            name: "Material".into(),
            base_color_factor: [0.85, 0.85, 0.85, 1.0],
            metallic_factor: 0.0,
            roughness_factor: 0.8,
            double_sided: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct GltfPrimitive {
    pub indices: Vec<u32>,
    pub material: Option<usize>,
    pub extras: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct GltfMesh {
    pub name: String,
    pub positions: Vec<[f32; 3]>,
    pub normals: Option<Vec<[f32; 3]>>,
    /// UV coordinates (`TEXCOORD_0`).
    pub uvs: Option<Vec<[f32; 2]>>,
    /// 2D pattern coordinates (`_PATTERN`).
    pub pattern: Option<Vec<[f32; 2]>>,
    pub primitives: Vec<GltfPrimitive>,
    pub extras: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct GltfScene {
    pub name: String,
    pub meshes: Vec<GltfMesh>,
    pub materials: Vec<GltfMaterial>,
}

/// Writes a full glTF 2.0 binary (`.glb`) scene with meshes, primitives, attributes, and materials.
pub fn write_scene(scene: &GltfScene, generator: &str) -> Vec<u8> {
    let mut bin = Vec::new();
    let mut buffer_views = Vec::new();
    let mut accessors = Vec::new();
    let mut meshes_json = Vec::new();
    let mut nodes_json = Vec::new();
    let mut scene_nodes = Vec::new();

    for (mesh_idx, mesh) in scene.meshes.iter().enumerate() {
        if mesh.positions.is_empty() {
            continue;
        }

        // 1. POSITION
        let pos_view_idx = buffer_views.len();
        let pos_bytes_start = bin.len();
        for p in &mesh.positions {
            for c in p {
                bin.extend_from_slice(&c.to_le_bytes());
            }
        }
        let pos_bytes_len = bin.len() - pos_bytes_start;
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": pos_bytes_start,
            "byteLength": pos_bytes_len,
            "target": 34962 // ARRAY_BUFFER
        }));

        let (mut lo_pos, mut hi_pos) = ([f32::MAX; 3], [f32::MIN; 3]);
        for p in &mesh.positions {
            for k in 0..3 {
                lo_pos[k] = lo_pos[k].min(p[k]);
                hi_pos[k] = hi_pos[k].max(p[k]);
            }
        }
        let pos_acc_idx = accessors.len();
        accessors.push(json!({
            "bufferView": pos_view_idx,
            "componentType": 5126, // FLOAT
            "count": mesh.positions.len(),
            "type": "VEC3",
            "min": lo_pos,
            "max": hi_pos
        }));

        // 2. NORMAL (optional)
        let nrm_acc_idx = if let Some(normals) = &mesh.normals {
            assert_eq!(
                normals.len(),
                mesh.positions.len(),
                "normals count must match positions"
            );
            let nrm_view_idx = buffer_views.len();
            let nrm_bytes_start = bin.len();
            for n in normals {
                for c in n {
                    bin.extend_from_slice(&c.to_le_bytes());
                }
            }
            let nrm_bytes_len = bin.len() - nrm_bytes_start;
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": nrm_bytes_start,
                "byteLength": nrm_bytes_len,
                "target": 34962
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": nrm_view_idx,
                "componentType": 5126,
                "count": normals.len(),
                "type": "VEC3"
            }));
            Some(acc_idx)
        } else {
            None
        };

        // 3. TEXCOORD_0 (optional)
        let uv_acc_idx = if let Some(uvs) = &mesh.uvs {
            assert_eq!(
                uvs.len(),
                mesh.positions.len(),
                "uvs count must match positions"
            );
            let uv_view_idx = buffer_views.len();
            let uv_bytes_start = bin.len();
            for uv in uvs {
                for c in uv {
                    bin.extend_from_slice(&c.to_le_bytes());
                }
            }
            let uv_bytes_len = bin.len() - uv_bytes_start;
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": uv_bytes_start,
                "byteLength": uv_bytes_len,
                "target": 34962
            }));
            let (mut lo_uv, mut hi_uv) = ([f32::MAX; 2], [f32::MIN; 2]);
            for uv in uvs {
                for k in 0..2 {
                    lo_uv[k] = lo_uv[k].min(uv[k]);
                    hi_uv[k] = hi_uv[k].max(uv[k]);
                }
            }
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": uv_view_idx,
                "componentType": 5126,
                "count": uvs.len(),
                "type": "VEC2",
                "min": lo_uv,
                "max": hi_uv
            }));
            Some(acc_idx)
        } else {
            None
        };

        // 4. _PATTERN (optional)
        let pat_acc_idx = if let Some(pattern) = &mesh.pattern {
            assert_eq!(
                pattern.len(),
                mesh.positions.len(),
                "pattern count must match positions"
            );
            let pat_view_idx = buffer_views.len();
            let pat_bytes_start = bin.len();
            for pt in pattern {
                for c in pt {
                    bin.extend_from_slice(&c.to_le_bytes());
                }
            }
            let pat_bytes_len = bin.len() - pat_bytes_start;
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": pat_bytes_start,
                "byteLength": pat_bytes_len,
                "target": 34962
            }));
            let (mut lo_pt, mut hi_pt) = ([f32::MAX; 2], [f32::MIN; 2]);
            for pt in pattern {
                for k in 0..2 {
                    lo_pt[k] = lo_pt[k].min(pt[k]);
                    hi_pt[k] = hi_pt[k].max(pt[k]);
                }
            }
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": pat_view_idx,
                "componentType": 5126,
                "count": pattern.len(),
                "type": "VEC2",
                "min": lo_pt,
                "max": hi_pt
            }));
            Some(acc_idx)
        } else {
            None
        };

        // Primitives
        let mut prims_json = Vec::new();
        for prim in &mesh.primitives {
            if prim.indices.is_empty() {
                continue;
            }
            let idx_view_idx = buffer_views.len();
            let idx_bytes_start = bin.len();
            for i in &prim.indices {
                bin.extend_from_slice(&i.to_le_bytes());
            }
            let idx_bytes_len = bin.len() - idx_bytes_start;
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": idx_bytes_start,
                "byteLength": idx_bytes_len,
                "target": 34963 // ELEMENT_ARRAY_BUFFER
            }));
            let idx_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": idx_view_idx,
                "componentType": 5125, // UNSIGNED_INT
                "count": prim.indices.len(),
                "type": "SCALAR"
            }));

            let mut attributes = serde_json::Map::new();
            attributes.insert("POSITION".into(), json!(pos_acc_idx));
            if let Some(nrm) = nrm_acc_idx {
                attributes.insert("NORMAL".into(), json!(nrm));
            }
            if let Some(uv) = uv_acc_idx {
                attributes.insert("TEXCOORD_0".into(), json!(uv));
            }
            if let Some(pat) = pat_acc_idx {
                attributes.insert("_PATTERN".into(), json!(pat));
            }

            let mut p_obj = json!({
                "attributes": attributes,
                "indices": idx_acc_idx,
            });
            if let Some(mat_idx) = prim.material {
                p_obj["material"] = json!(mat_idx);
            }
            if let Some(extras) = &prim.extras {
                p_obj["extras"] = extras.clone();
            }
            prims_json.push(p_obj);
        }

        let mut m_obj = json!({
            "name": mesh.name,
            "primitives": prims_json
        });
        if let Some(extras) = &mesh.extras {
            m_obj["extras"] = extras.clone();
        }
        meshes_json.push(m_obj);

        let node_idx = nodes_json.len();
        nodes_json.push(json!({
            "name": mesh.name,
            "mesh": mesh_idx
        }));
        scene_nodes.push(node_idx);
    }

    let materials_json: Vec<Value> = scene
        .materials
        .iter()
        .map(|m| {
            json!({
                "name": m.name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": m.base_color_factor,
                    "metallicFactor": m.metallic_factor,
                    "roughnessFactor": m.roughness_factor
                },
                "doubleSided": m.double_sided
            })
        })
        .collect();

    let scene_name = if scene.name.is_empty() {
        "Scene"
    } else {
        &scene.name
    };

    let mut gltf = json!({
        "asset": { "version": "2.0", "generator": generator },
        "scene": 0,
        "scenes": [{ "name": scene_name, "nodes": scene_nodes }],
        "nodes": nodes_json,
        "meshes": meshes_json,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{ "byteLength": bin.len() }]
    });

    if !materials_json.is_empty() {
        gltf["materials"] = Value::Array(materials_json);
    }

    let mut js = serde_json::to_vec(&gltf).unwrap();
    js.resize(js.len().div_ceil(4) * 4, b' ');
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
            Some("VEC4") => 4,
            Some("MAT4") => 16,
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
    let (mut joint_ids, mut weights) = (Vec::new(), Vec::new());
    let mut skinned = None;
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
        // Skin weights, the same for every primitive or for none.
        let has = !p["attributes"]["JOINTS_0"].is_null() && !p["attributes"]["WEIGHTS_0"].is_null();
        if *skinned.get_or_insert(has) != has {
            return Err("glb: only some primitives have skin weights".into());
        }
        if has {
            let (jd, js, jc, jt, jcomps) =
                accessor(num(&p["attributes"]["JOINTS_0"], "JOINTS_0")?)?;
            let wacc = num(&p["attributes"]["WEIGHTS_0"], "WEIGHTS_0")?;
            let normalized = g["accessors"][wacc]["normalized"]
                .as_bool()
                .unwrap_or(false);
            let (wd, ws, wc, wt, wcomps) = accessor(wacc)?;
            if jc != count || wc != count || jcomps != INFLUENCES || wcomps != INFLUENCES {
                return Err("glb: JOINTS_0 and WEIGHTS_0 must be VEC4, one per vertex".into());
            }
            for k in 0..count {
                let e = &jd[k * js..];
                joint_ids.push(match jt {
                    5121 => [0, 1, 2, 3].map(|c| e[c] as u16),
                    5123 => [0, 2, 4, 6].map(|o| u16::from_le_bytes([e[o], e[o + 1]])),
                    _ => return Err("glb: JOINTS_0 must be unsigned bytes or shorts".into()),
                });
                let e = &wd[k * ws..];
                weights.push(match (wt, normalized) {
                    (5126, _) => {
                        [0, 4, 8, 12].map(|o| f32::from_le_bytes(e[o..o + 4].try_into().unwrap()))
                    }
                    (5123, true) => {
                        [0, 2, 4, 6].map(|o| u16::from_le_bytes([e[o], e[o + 1]]) as f32 / 65535.0)
                    }
                    (5121, true) => [0, 1, 2, 3].map(|c| e[c] as f32 / 255.0),
                    _ => return Err("glb: WEIGHTS_0 must be floats or normalized integers".into()),
                });
            }
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
    if skinned == Some(true) {
        let joints = read_joints(&g, &accessor)?;
        let skin = Skin {
            joints,
            joint_ids,
            weights,
        };
        skin.check(mesh.positions.len())?;
        mesh.skin = Some(skin);
    }
    Ok(mesh)
}

/// An accessor's bytes: (data, element stride, count, component type, components).
type Accessed<'a> = (&'a [u8], usize, usize, u64, usize);

/// The skin's joints: each node's name, its parent among the joints and its rest position (the
/// translations added up from the root). Only translations are read: a joint with a rotation or a
/// scale, or inverse bind matrices that are not a shift by minus the rest position, is refused
/// (`skin.rs`: the rest pose is translation only).
fn read_joints<'a>(
    g: &Value,
    accessor: &dyn Fn(usize) -> Result<Accessed<'a>, String>,
) -> Result<Vec<Joint>, String> {
    let skin = g["skins"]
        .as_array()
        .and_then(|s| s.first())
        .ok_or("glb: weights but no skin")?;
    let ids: Vec<usize> = skin["joints"]
        .as_array()
        .ok_or("glb: the skin has no joints")?
        .iter()
        .map(|v| v.as_u64().map(|x| x as usize).ok_or("glb: bad joint node"))
        .collect::<Result<_, _>>()?;
    let nodes = g["nodes"].as_array().ok_or("glb: no nodes")?;
    let node = |i: usize| nodes.get(i).ok_or_else(|| format!("glb: no node {i}"));
    let mut joints: Vec<Joint> = Vec::with_capacity(ids.len());
    let mut local = Vec::with_capacity(ids.len());
    for &i in &ids {
        let n = node(i)?;
        let identity = |key: &str, id: &[f64]| {
            n[key].as_array().is_none_or(|a| {
                a.len() == id.len()
                    && a.iter()
                        .zip(id)
                        .all(|(x, i)| (x.as_f64().unwrap_or(f64::NAN) - i).abs() < 1e-6)
            })
        };
        if !n["matrix"].is_null()
            || !identity("rotation", &[0.0, 0.0, 0.0, 1.0])
            || !identity("scale", &[1.0, 1.0, 1.0])
        {
            return Err("glb: a joint with a rotation or scale at rest is not supported".into());
        }
        let t = n["translation"]
            .as_array()
            .map(|a| [0, 1, 2].map(|k| a.get(k).and_then(Value::as_f64).unwrap_or(0.0) as f32))
            .unwrap_or([0.0; 3]);
        local.push(t);
        joints.push(Joint {
            name: n["name"].as_str().unwrap_or("").to_string(),
            parent: None,
            rest: t,
        });
    }
    // Parents: the joint whose node lists this one as a child.
    for (k, &i) in ids.iter().enumerate() {
        let parent_node = nodes.iter().position(|n| {
            n["children"]
                .as_array()
                .is_some_and(|c| c.iter().any(|x| x.as_u64() == Some(i as u64)))
        });
        if let Some(pn) = parent_node {
            let p = ids
                .iter()
                .position(|&x| x == pn)
                .ok_or("glb: a joint's parent node is not a joint")?;
            joints[k].parent = Some(p);
        }
    }
    // Rest positions: the translations added up from the root.
    for k in 0..joints.len() {
        let (mut at, mut sum, mut steps) = (k, [0.0f32; 3], 0);
        loop {
            for c in 0..3 {
                sum[c] += local[at][c];
            }
            match joints[at].parent {
                Some(p) if steps <= joints.len() => (at, steps) = (p, steps + 1),
                Some(_) => return Err("glb: the joints' parents go in a circle".into()),
                None => break,
            }
        }
        joints[k].rest = sum;
    }
    // The inverse bind matrices must say the same: a shift by minus the rest position.
    if let Some(acc) = skin["inverseBindMatrices"].as_u64() {
        let (data, stride, count, ctype, comps) = accessor(acc as usize)?;
        if ctype != 5126 || comps != 16 || count != joints.len() {
            return Err("glb: inverseBindMatrices must be one float MAT4 per joint".into());
        }
        for (k, j) in joints.iter().enumerate() {
            let e = &data[k * stride..];
            let m: [f32; 16] = std::array::from_fn(|c| {
                f32::from_le_bytes(e[c * 4..c * 4 + 4].try_into().unwrap())
            });
            let want = [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -j.rest[0], -j.rest[1],
                -j.rest[2], 1.0,
            ];
            if m.iter().zip(want).any(|(a, b)| (a - b).abs() > 1e-4) {
                return Err(format!(
                    "glb: joint {} has a bind matrix other than a shift to its rest position",
                    j.name
                ));
            }
        }
    }
    Ok(joints)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let m = Mesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.5, -2.0]],
            indices: vec![0, 1, 2],
            skin: None,
        };
        let b = write(&m, "test");
        assert_eq!(b.len() % 4, 0);
        assert_eq!(read(&b).unwrap(), m);
        assert!(read(&b[..20]).is_err());
    }

    #[test]
    fn test_write_scene() {
        let scene = GltfScene {
            name: "TestScene".into(),
            materials: vec![
                GltfMaterial {
                    name: "Cotton".into(),
                    base_color_factor: [0.8, 0.8, 0.8, 1.0],
                    metallic_factor: 0.0,
                    roughness_factor: 0.8,
                    double_sided: true,
                },
                GltfMaterial {
                    name: "Denim".into(),
                    base_color_factor: [0.2, 0.3, 0.5, 1.0],
                    metallic_factor: 0.0,
                    roughness_factor: 0.8,
                    double_sided: true,
                },
            ],
            meshes: vec![
                GltfMesh {
                    name: "Garment".into(),
                    positions: vec![
                        [0.0, 1.0, 0.0],
                        [0.1, 1.0, 0.0],
                        [0.0, 1.1, 0.0],
                        [0.1, 1.1, 0.0],
                    ],
                    normals: Some(vec![
                        [0.0, 0.0, 1.0],
                        [0.0, 0.0, 1.0],
                        [0.0, 0.0, 1.0],
                        [0.0, 0.0, 1.0],
                    ]),
                    uvs: Some(vec![[0.0, 0.0], [0.1, 0.0], [0.0, 0.1], [0.1, 0.1]]),
                    pattern: Some(vec![[0.0, 0.0], [0.1, 0.0], [0.0, 0.1], [0.1, 0.1]]),
                    primitives: vec![
                        GltfPrimitive {
                            indices: vec![0, 1, 2],
                            material: Some(0),
                            extras: Some(json!({ "cut": "front" })),
                        },
                        GltfPrimitive {
                            indices: vec![1, 3, 2],
                            material: Some(1),
                            extras: Some(json!({ "cut": "back" })),
                        },
                    ],
                    extras: Some(json!({ "garment": "tshirt" })),
                },
                GltfMesh {
                    name: "Avatar".into(),
                    positions: vec![[0.0, 0.0, 0.0], [0.5, 0.0, 0.0], [0.0, 1.6, 0.0]],
                    normals: Some(vec![[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]]),
                    uvs: None,
                    pattern: None,
                    primitives: vec![GltfPrimitive {
                        indices: vec![0, 1, 2],
                        material: None,
                        extras: None,
                    }],
                    extras: None,
                },
            ],
        };

        let glb_bytes = write_scene(&scene, "Vitryne test");
        assert_eq!(glb_bytes.len() % 4, 0);

        // Verify with read() (which reads the first mesh; shared accessors are read per primitive)
        let m = read(&glb_bytes).unwrap();
        assert_eq!(m.positions.len(), 8); // 4 positions read for primitive 0 + 4 positions for primitive 1
        assert_eq!(m.indices.len(), 6); // 2 primitives combined (3 indices each)
        assert_eq!(m.indices, vec![0, 1, 2, 5, 7, 6]);
    }
}
