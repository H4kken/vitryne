//! Test scenes shared by the native viewer, the bench and (M3) the web build.

use glam::{Vec3, Vec4};
use serde::Serialize;

use crate::{
    constraints::{Constraints, Material},
    mesh::ClothMesh,
    sim::{self, SimConfig},
};

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
}

impl Default for SheetScene {
    /// 1 m sheet, 1 m up, pinned at the two corners of its -Z edge (0.9 m apart), starting 2 cm
    /// above a 30 cm sphere: the near half hangs from the pins onto the sphere, the far half
    /// drapes over it.
    fn default() -> Self {
        Self { grid: 100, size: 1.0, height: 1.0, sphere_center: [0.0, 0.68, 0.0], sphere_radius: 0.3, pin_spacing: 0.9 }
    }
}

pub struct Built {
    pub mesh: ClothMesh,
    pub constraints: Constraints,
    pub material: Material,
    pub sphere: Vec4,
}

impl SheetScene {
    pub fn build(&self) -> Built {
        let mut mesh = ClothMesh::grid(self.grid, self.size, self.height);
        let n = self.grid;
        for p in &mut mesh.pos {
            p.x *= self.pin_spacing;
        }
        mesh.pinned[0] = true; // (-x, -z)
        mesh.pinned[(n - 1) as usize] = true; // (+x, -z)
        let material = Material::cotton();
        let constraints = Constraints::build(&mesh, &material);
        Built { mesh, constraints, material, sphere: sim::sphere(Vec3::from(self.sphere_center), self.sphere_radius) }
    }

    pub fn config() -> SimConfig {
        SimConfig::default()
    }
}
