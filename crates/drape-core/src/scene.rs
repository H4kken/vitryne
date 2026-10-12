// SPDX-License-Identifier: AGPL-3.0-or-later
//! The sheet test scene (a pinned cloth over a sphere), as a garment description, and the mesh
//! a collider is drawn with. Garments from patterns come from `drape-assets`.

use glam::Vec3;
use serde::Serialize;

use crate::{
    constraints::Material,
    engine::{GarmentDesc, SdfParams},
    mesh::ClothMesh,
    sim::SimSettings,
};

/// Static mesh drawn for the collider (sphere or avatar).
#[derive(Debug, Clone)]
pub struct RenderMesh {
    pub pos: Vec<Vec3>,
    pub nrm: Vec<Vec3>,
    pub idx: Vec<u32>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SheetScene {
    /// Vertices per side.
    pub grid: u32,
    /// Side length, m.
    pub size: f32,
    pub height: f32,
    pub sphere_center: [f32; 3],
    pub sphere_radius: f32,
    /// Initial pin distance as a fraction of the sheet width. At 1.0 the edge between the pins
    /// is exactly at rest length, so an inextensible edge can't sag and it vibrates like a taut
    /// string. Below 1.0 the sheet starts compressed in X (rest shape unchanged) and the edge
    /// hangs with slack.
    pub pin_spacing: f32,
    /// false: no pins, the sheet falls flat onto the sphere and folds around it (M4 self-
    /// collision test: the hanging skirt folds onto itself).
    pub pins: bool,
}

impl Default for SheetScene {
    /// 1 m sheet, 1 m up, pinned at the two corners of its -Z edge (0.9 m apart), starting 2 cm
    /// above a 30 cm sphere: the near half hangs from the pins onto the sphere, the far half
    /// drapes over it.
    fn default() -> Self {
        Self {
            grid: 100,
            size: 1.0,
            height: 1.0,
            sphere_center: [0.0, 0.68, 0.0],
            sphere_radius: 0.3,
            pin_spacing: 0.9,
            pins: true,
        }
    }
}

impl SheetScene {
    /// The sheet as a garment: no sewing, pinned at two corners, cotton.
    pub fn garment(&self) -> GarmentDesc {
        let mut mesh = ClothMesh::grid(self.grid, self.size, self.height);
        let n = self.grid;
        if self.pins {
            for p in &mut mesh.pos {
                p.x *= self.pin_spacing;
            }
            mesh.pinned[0] = true; // (-x, -z)
            mesh.pinned[(n - 1) as usize] = true; // (+x, -z)
        }
        GarmentDesc {
            name: "sheet".into(),
            description: serde_json::to_value(self).unwrap(),
            mesh,
            sew_pairs: Vec::new(),
            seams: Vec::new(),
            groups: Vec::new(),
            schedule: None,
            sdf: SdfParams::default(),
            camera: (Vec3::new(0.0, 0.6, 0.0), 2.6),
        }
    }

    pub fn fabric(&self) -> Material {
        Material::cotton()
    }

    pub fn sphere(&self) -> (Vec3, f32) {
        (Vec3::from(self.sphere_center), self.sphere_radius)
    }

    pub fn config() -> SimSettings {
        SimSettings::default()
    }
}

pub fn uv_sphere(center: Vec3, r: f32, rings: u32, segs: u32) -> RenderMesh {
    let (mut pos, mut nrm, mut idx) = (Vec::new(), Vec::new(), Vec::new());
    for i in 0..=rings {
        let th = std::f32::consts::PI * i as f32 / rings as f32;
        for j in 0..=segs {
            let ph = std::f32::consts::TAU * j as f32 / segs as f32;
            let d = Vec3::new(th.sin() * ph.cos(), th.cos(), th.sin() * ph.sin());
            pos.push(center + d * r);
            nrm.push(d);
        }
    }
    let w = segs + 1;
    for i in 0..rings {
        for j in 0..segs {
            let (a, b, c, d) = (
                i * w + j,
                i * w + j + 1,
                (i + 1) * w + j,
                (i + 1) * w + j + 1,
            );
            idx.extend_from_slice(&[a, b, c, b, d, c]);
        }
    }
    RenderMesh { pos, nrm, idx }
}
