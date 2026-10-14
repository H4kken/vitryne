// SPDX-License-Identifier: AGPL-3.0-or-later
//! glTF 2.0 (.glb) and Wavefront OBJ (.obj + .mtl) export for draped garments (M10).
//!
//! Includes:
//! - Positions, normals, and 2D pattern coordinates as UVs (`TEXCOORD_0` and `_PATTERN`)
//! - One material per fabric (base color, roughness, double-sided cloth)
//! - Optional avatar mesh as a separate node/object
//! - Exact metre scale and +Y up, +Z facing orientation (standard glTF / OBJ convention).

use std::collections::BTreeMap;
use std::ops::Range;

use drape_core::{
    body::BodyMesh,
    engine::{Body, GarmentDesc},
};
use glam::{Vec2, Vec3};
use serde_json::json;
use vitryne_format::{
    Fabric,
    glb::{self, GltfMaterial, GltfMesh, GltfPrimitive, GltfScene},
};

/// Plausible PBR material properties for a fabric.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportFabric {
    pub name: String,
    pub color: [f32; 4],
    pub roughness: f32,
}

impl ExportFabric {
    pub fn new(name: impl Into<String>, color: [f32; 4], roughness: f32) -> Self {
        Self {
            name: name.into(),
            color,
            roughness,
        }
    }

    pub fn default_cloth(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            color: [0.86, 0.86, 0.84, 1.0],
            roughness: 0.85,
        }
    }
}

impl From<&Fabric> for ExportFabric {
    fn from(f: &Fabric) -> Self {
        Self {
            name: f.name.clone(),
            color: fabric_color(f),
            roughness: fabric_roughness(f),
        }
    }
}

/// Data of one panel/cut for export.
#[derive(Debug, Clone)]
pub struct PanelExportData<'a> {
    pub name: &'a str,
    pub tri_range: Range<usize>,
    pub fabric: ExportFabric,
}

/// Draped garment data ready for export.
#[derive(Debug, Clone)]
pub struct GarmentExportData<'a> {
    pub name: &'a str,
    pub positions: &'a [Vec3],
    pub normals: &'a [Vec3],
    pub uvs: &'a [Vec2],
    pub tris: &'a [[u32; 3]],
    pub panels: Vec<PanelExportData<'a>>,
}

/// Optional avatar data for export.
#[derive(Debug, Clone)]
pub struct AvatarExportData<'a> {
    pub name: &'a str,
    pub positions: &'a [Vec3],
    pub normals: &'a [Vec3],
    pub tris: &'a [[u32; 3]],
}

/// Output of an OBJ export: .obj text and accompanying .mtl text.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjExport {
    pub obj: String,
    pub mtl: String,
}

impl<'a> GarmentExportData<'a> {
    /// Builds export data from a `GarmentDesc`, simulation positions, and panel fabrics.
    pub fn new(
        desc: &'a GarmentDesc,
        positions: &'a [Vec3],
        normals: &'a [Vec3],
        uvs: &'a [Vec2],
        fabrics: &[ExportFabric],
    ) -> Self {
        let default_fabric = fabrics
            .first()
            .cloned()
            .unwrap_or_else(|| ExportFabric::default_cloth(&desc.name));
        let mut panels = Vec::new();
        for (k, (name, v_range)) in desc.groups.iter().enumerate() {
            let fabric = fabrics
                .get(k)
                .cloned()
                .unwrap_or_else(|| default_fabric.clone());
            let tri_start = desc
                .mesh
                .tris
                .iter()
                .position(|t| v_range.contains(&t[0]))
                .unwrap_or(0);
            let tri_end = desc
                .mesh
                .tris
                .iter()
                .rposition(|t| v_range.contains(&t[0]))
                .map(|i| i + 1)
                .unwrap_or(tri_start);
            panels.push(PanelExportData {
                name: name.as_str(),
                tri_range: tri_start..tri_end,
                fabric,
            });
        }

        Self {
            name: &desc.name,
            positions,
            normals,
            uvs,
            tris: &desc.mesh.tris,
            panels,
        }
    }
}

impl<'a> AvatarExportData<'a> {
    /// Builds avatar export data from a `Body` collider.
    pub fn from_body(body: &'a Body, tris_storage: &'a mut Vec<[u32; 3]>) -> Self {
        tris_storage.clear();
        tris_storage.extend_from_slice(body.render.idx.as_chunks::<3>().0);
        Self {
            name: &body.name,
            positions: &body.render.pos,
            normals: &body.render.nrm,
            tris: tris_storage,
        }
    }

    /// Builds avatar export data from a `BodyMesh`.
    pub fn from_body_mesh(
        name: &'a str,
        mesh: &'a BodyMesh,
        normals_storage: &'a mut Vec<Vec3>,
    ) -> Self {
        *normals_storage = mesh.vertex_normals();
        Self {
            name,
            positions: &mesh.pos,
            normals: normals_storage,
            tris: &mesh.tris,
        }
    }
}

/// Plausible PBR base color for a fabric (sRGB floats 0..1).
pub fn fabric_color(fabric: &Fabric) -> [f32; 4] {
    let lower = fabric.name.to_lowercase();
    if lower.contains("denim") {
        [0.18, 0.28, 0.44, 1.0] // Indigo twill
    } else if lower.contains("cotton") || lower.contains("jersey") {
        [0.86, 0.86, 0.84, 1.0] // Soft heather off-white
    } else if lower.contains("poplin") || lower.contains("shirting") {
        [0.92, 0.94, 0.97, 1.0] // Crisp light shirting
    } else if lower.contains("fleece") {
        [0.78, 0.72, 0.70, 1.0] // Heather rose fleece
    } else if lower.contains("wool") || lower.contains("suit") {
        [0.22, 0.22, 0.25, 1.0] // Charcoal suiting
    } else {
        match fabric.category {
            vitryne_format::Category::Knit => [0.75, 0.82, 0.76, 1.0], // Sage knit
            vitryne_format::Category::Woven => [0.82, 0.80, 0.78, 1.0], // Neutral woven
            _ => [0.80, 0.80, 0.80, 1.0],
        }
    }
}

/// Plausible roughness factor for fabric.
pub fn fabric_roughness(fabric: &Fabric) -> f32 {
    let lower = fabric.name.to_lowercase();
    if lower.contains("fleece") {
        0.95
    } else if lower.contains("cotton") || lower.contains("jersey") {
        0.85
    } else if lower.contains("poplin") {
        0.75
    } else {
        0.80
    }
}

/// Exports draped garment (and optional avatar) to a glTF 2.0 binary (`.glb`).
pub fn export_glb(
    garment: &GarmentExportData,
    avatar: Option<&AvatarExportData>,
) -> Result<Vec<u8>, String> {
    // 1. Collect unique fabrics and assign material indices
    let mut fabric_indices: BTreeMap<String, usize> = BTreeMap::new();
    let mut materials: Vec<GltfMaterial> = Vec::new();

    for panel in &garment.panels {
        let f = &panel.fabric;
        if !fabric_indices.contains_key(&f.name) {
            let idx = materials.len();
            materials.push(GltfMaterial {
                name: f.name.clone(),
                base_color_factor: f.color,
                metallic_factor: 0.0,
                roughness_factor: f.roughness,
                double_sided: true,
            });
            fabric_indices.insert(f.name.clone(), idx);
        }
    }

    let avatar_mat_idx = if avatar.is_some() {
        let idx = materials.len();
        materials.push(GltfMaterial {
            name: "Avatar".into(),
            base_color_factor: [0.85, 0.82, 0.78, 1.0],
            metallic_factor: 0.0,
            roughness_factor: 0.6,
            double_sided: false,
        });
        Some(idx)
    } else {
        None
    };

    // 2. Build garment mesh and primitives
    let garment_positions: Vec<[f32; 3]> = garment.positions.iter().map(|p| p.to_array()).collect();
    let garment_normals: Vec<[f32; 3]> = garment.normals.iter().map(|n| n.to_array()).collect();
    let garment_uvs: Vec<[f32; 2]> = garment.uvs.iter().map(|uv| uv.to_array()).collect();

    let mut primitives = Vec::new();
    for panel in &garment.panels {
        let mut indices = Vec::new();
        let range = panel.tri_range.clone();
        for t in &garment.tris[range] {
            indices.extend_from_slice(t);
        }
        let mat_idx = fabric_indices.get(&panel.fabric.name).copied();
        primitives.push(GltfPrimitive {
            indices,
            material: mat_idx,
            extras: Some(json!({ "cut": panel.name })),
        });
    }

    let mut meshes = vec![GltfMesh {
        name: garment.name.to_string(),
        positions: garment_positions,
        normals: Some(garment_normals),
        uvs: Some(garment_uvs.clone()),
        pattern: Some(garment_uvs),
        primitives,
        extras: Some(json!({ "garment": garment.name })),
    }];

    // 3. Optional avatar mesh
    if let Some(av) = avatar {
        let av_positions: Vec<[f32; 3]> = av.positions.iter().map(|p| p.to_array()).collect();
        let av_normals: Vec<[f32; 3]> = av.normals.iter().map(|n| n.to_array()).collect();
        let mut av_indices = Vec::new();
        for t in av.tris {
            av_indices.extend_from_slice(t);
        }
        meshes.push(GltfMesh {
            name: av.name.to_string(),
            positions: av_positions,
            normals: Some(av_normals),
            uvs: None,
            pattern: None,
            primitives: vec![GltfPrimitive {
                indices: av_indices,
                material: avatar_mat_idx,
                extras: None,
            }],
            extras: None,
        });
    }

    let scene = GltfScene {
        name: garment.name.to_string(),
        meshes,
        materials,
    };

    Ok(glb::write_scene(&scene, "Vitryne"))
}

/// Exports draped garment (and optional avatar) to Wavefront OBJ format (.obj and .mtl).
pub fn export_obj(
    garment: &GarmentExportData,
    avatar: Option<&AvatarExportData>,
    mtl_filename: Option<&str>,
) -> ObjExport {
    let mtl_name = mtl_filename.unwrap_or("garment.mtl");
    let mut obj = String::new();
    let mut mtl = String::new();

    // MTL header
    mtl.push_str("# Vitryne Material Library (M10)\n");
    mtl.push_str("# Units: metres\n\n");

    // Collect unique fabrics for MTL
    let mut written_materials = BTreeMap::new();
    for panel in &garment.panels {
        let f = &panel.fabric;
        if written_materials.insert(&f.name, f).is_none() {
            let c = f.color;
            mtl.push_str(&format!("newmtl {}\n", f.name));
            mtl.push_str("Ka 0.200000 0.200000 0.200000\n");
            mtl.push_str(&format!("Kd {:.6} {:.6} {:.6}\n", c[0], c[1], c[2]));
            mtl.push_str("Ks 0.050000 0.050000 0.050000\n");
            mtl.push_str("Ns 10.000000\n");
            mtl.push_str("d 1.000000\n");
            mtl.push_str("illum 2\n\n");
        }
    }

    if avatar.is_some() {
        mtl.push_str("newmtl Avatar\n");
        mtl.push_str("Ka 0.200000 0.200000 0.200000\n");
        mtl.push_str("Kd 0.850000 0.820000 0.780000\n");
        mtl.push_str("Ks 0.100000 0.100000 0.100000\n");
        mtl.push_str("Ns 20.000000\n");
        mtl.push_str("d 1.000000\n");
        mtl.push_str("illum 2\n\n");
    }

    // OBJ header
    obj.push_str("# Vitryne 3D Export (M10)\n");
    obj.push_str("# Units: metres, Y up, facing +Z\n");
    obj.push_str(&format!("mtllib {mtl_name}\n\n"));

    // Garment object
    obj.push_str(&format!("o {}\n", garment.name));

    // Garment vertices
    for p in garment.positions {
        obj.push_str(&format!("v {:.6} {:.6} {:.6}\n", p.x, p.y, p.z));
    }
    obj.push('\n');

    // Garment UVs (pattern coordinates in metres)
    for uv in garment.uvs {
        obj.push_str(&format!("vt {:.6} {:.6}\n", uv.x, uv.y));
    }
    obj.push('\n');

    // Garment normals
    for n in garment.normals {
        obj.push_str(&format!("vn {:.6} {:.6} {:.6}\n", n.x, n.y, n.z));
    }
    obj.push('\n');

    // Garment faces grouped by panel
    for panel in &garment.panels {
        obj.push_str(&format!("g {}\n", panel.name));
        obj.push_str(&format!("usemtl {}\n", panel.fabric.name));
        obj.push_str("s 1\n");
        let range = panel.tri_range.clone();
        for t in &garment.tris[range] {
            // OBJ indices are 1-based: v/vt/vn
            let a = t[0] + 1;
            let b = t[1] + 1;
            let c = t[2] + 1;
            obj.push_str(&format!("f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}\n"));
        }
        obj.push('\n');
    }

    // Avatar object (if included)
    if let Some(av) = avatar {
        let v_base = garment.positions.len() as u32;
        let n_base = garment.normals.len() as u32;

        obj.push_str(&format!("o {}\n", av.name));
        for p in av.positions {
            obj.push_str(&format!("v {:.6} {:.6} {:.6}\n", p.x, p.y, p.z));
        }
        obj.push('\n');

        for n in av.normals {
            obj.push_str(&format!("vn {:.6} {:.6} {:.6}\n", n.x, n.y, n.z));
        }
        obj.push('\n');

        obj.push_str(&format!("g {}\n", av.name));
        obj.push_str("usemtl Avatar\n");
        obj.push_str("s 1\n");

        for t in av.tris {
            // Avatar faces have no UVs: v//vn
            let a_v = v_base + t[0] + 1;
            let b_v = v_base + t[1] + 1;
            let c_v = v_base + t[2] + 1;
            let a_n = n_base + t[0] + 1;
            let b_n = n_base + t[1] + 1;
            let c_n = n_base + t[2] + 1;
            obj.push_str(&format!("f {a_v}//{a_n} {b_v}//{b_n} {c_v}//{c_n}\n"));
        }
        obj.push('\n');
    }

    ObjExport { obj, mtl }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vitryne_format::presets;

    #[test]
    fn test_export_roundtrip() {
        let fabric_cotton = ExportFabric::from(&presets::cotton_jersey());
        let fabric_denim = ExportFabric::from(&presets::denim());

        let positions = vec![
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.2, 1.0, 0.0),
            Vec3::new(0.0, 1.4, 0.0),
            Vec3::new(0.2, 1.4, 0.0),
        ];
        let normals = vec![
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 0.0, 1.0),
        ];
        let uvs = vec![
            Vec2::new(0.0, 0.0),
            Vec2::new(0.2, 0.0),
            Vec2::new(0.0, 0.4),
            Vec2::new(0.2, 0.4),
        ];
        let tris = vec![[0, 1, 2], [1, 3, 2]];

        let garment = GarmentExportData {
            name: "TestTshirt",
            positions: &positions,
            normals: &normals,
            uvs: &uvs,
            tris: &tris,
            panels: vec![
                PanelExportData {
                    name: "front",
                    tri_range: 0..1,
                    fabric: fabric_cotton,
                },
                PanelExportData {
                    name: "back",
                    tri_range: 1..2,
                    fabric: fabric_denim,
                },
            ],
        };

        let av_pos = vec![
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(0.4, 0.0, 0.0),
            Vec3::new(0.0, 1.6, 0.0),
        ];
        let av_norm = vec![
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 0.0, 1.0),
        ];
        let av_tris = vec![[0, 1, 2]];
        let avatar = AvatarExportData {
            name: "TestAvatar",
            positions: &av_pos,
            normals: &av_norm,
            tris: &av_tris,
        };

        // 1. glb export
        let glb_bytes = export_glb(&garment, Some(&avatar)).unwrap();
        assert_eq!(glb_bytes.len() % 4, 0);

        // 2. obj export
        let obj_export = export_obj(&garment, Some(&avatar), Some("test.mtl"));
        assert!(obj_export.obj.contains("mtllib test.mtl"));
        assert!(obj_export.obj.contains("o TestTshirt"));
        assert!(obj_export.obj.contains("o TestAvatar"));
        assert!(obj_export.obj.contains("usemtl Cotton jersey"));
        assert!(obj_export.obj.contains("usemtl Denim"));
        assert!(obj_export.obj.contains("usemtl Avatar"));
        assert!(obj_export.mtl.contains("newmtl Cotton jersey"));
        assert!(obj_export.mtl.contains("newmtl Denim"));
        assert!(obj_export.mtl.contains("newmtl Avatar"));
    }
}
