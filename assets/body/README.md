# Test avatar

`makehuman_body_m.obj`: the MakeHuman base mesh (hm08), `body` group only (helpers, joints,
eyelashes etc. removed), quads split into triangles, converted to metres with the feet at y = 0.
Y up, facing +Z, A-pose. 13,380 vertices, 26,756 triangles, 1.67 m tall.

- Source: <https://github.com/makehumancommunity/makehuman>, `makehuman/data/3dobjs/base.obj`
- License: **CC0**. The file header says it was explicitly released as CC0 in September 2020 by
  its copyright holders (Data Collection AB, Joel Palmius, Jonas Hauquier).
- Regenerate: `python3 assets/body/convert.py base.obj assets/body/makehuman_body_m.obj`

`avatar.json`: this avatar as a project file's avatar entity (docs/FORMAT.md, Avatar): name,
attribution, and the **regions** garments are wrapped around (torso, arms, legs, head; mm),
measured on this mesh. `drape convert` copies it into every project with the mesh as `body.glb`,
and the `garment.toml` path places pieces with the same regions.

Measured on this mesh (used to size and place the T-shirt):
chest ≈ 0.80–0.85 m around, waist ≈ 0.66 m (y ≈ 1.10), hips ≈ 0.95 m (y ≈ 0.80),
shoulder top ≈ (±0.15, 1.39, 0.01), upper arm from ≈ (±0.18, 1.36, 0.01) along
≈ (±0.54, −0.84, 0.06), radius ≈ 4 cm, elbow at y ≈ 1.13.
