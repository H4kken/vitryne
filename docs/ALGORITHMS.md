# Algorithms

Every solver component, where it is implemented, and the published method it follows. Rule 5 of
the plan: published methods only, cited here and in a comment where they are implemented.
"Own" marks a design decision of ours that no paper prescribes, with the reasoning, so it can
be checked against the literature before the public announcement.

All of it runs on the GPU as WebGPU core compute (no optional features, no float atomics), one
set of WGSL shaders for native and browser. Settings are the fields of `SimSettings`
(`packages/vitryne-engine/solver/src/sim.rs`); the numbers behind the defaults are in
[PROGRESS.md](PROGRESS.md).

## The step

One frame is `substeps` (20) small steps of `h = frame_dt / substeps` (1/1200 s). Each step, in
order (`Solver`, `packages/vitryne-engine/solver/src/sim.rs`):

```
predict -> [long range] -> stretch (x stretch_iterations) -> [long range, slot 1/2]
        -> sew -> bend -> hash rebuild (every self_rebuild_every) -> body contact
        -> self-collision repulsion -> untangling -> update velocity
```

## Core solver

| Component | Where | Method |
|---|---|---|
| Position-based dynamics with compliance | `sim.wgsl` | **XPBD**, Macklin, Müller & Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics", MIG 2016. Compliance is physical (1/stiffness), so results don't depend on the step count. |
| Small steps | `sim.wgsl`, `SimSettings::substeps` | Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke & Müller, "Small Steps in Physics Simulation", SCA 2019: many substeps with one solve each instead of few steps with many iterations. The Lagrange multiplier starts at 0 every substep and is never stored. |
| Stretch | `solve_stretch`, `constraints.rs` | One XPBD distance constraint per mesh edge, compliance `1 / stretch_k`. `stretch_iterations` (3) Gauss-Seidel sweeps per substep. |
| Stretch damping | `solve_stretch` | Rayleigh stiffness-proportional damping of the constraint, Macklin et al. 2016 eq. 26: `gamma = beta / h` with `beta = stretch_damping`. (An earlier shader had `gamma = alpha * beta / h`, which made soft fabrics viscous; see docs/PROGRESS.md, Fabric stretch.) |
| Bending | `solve_bend`, `constraints.rs` | **Isometric bending**: Bergou, Wardetzky, Harmon, Zorin & Grinspun, "A Quadratic Bending Model for Inextensible Surfaces", SGP 2006, with the cotangent weights of Wardetzky, Bergou, Harmon, Zorin & Grinspun, "Discrete Quadratic Curvature Energies", CAGD 2007. The curvature vector `C = sum k_i x_i` over an edge stencil is linear in the positions, zero when flat, so the XPBD update is closed-form with no singularity at flat (dihedral angles have one). Energy `3 kb / (A0 + A1) \|C\|^2`; compliance `(A0 + A1) / (6 kb)`. |
| Parallel Gauss-Seidel | `constraints.rs` (`color`) | Greedy graph colouring of the constraints; one dispatch per colour, so no two threads in a dispatch touch the same vertex and nothing needs atomics. Fratarcangeli & Pellacini, "Scalable Partitioning for Parallel Position Based Dynamics", Eurographics 2015; Fratarcangeli, Tibaldo & Pellacini, "Vivace", SIGGRAPH Asia 2016. 9 stretch and 18 bend colours on the garment meshes. |
| Sewing | `solve_sew` | **Own.** Zero-rest-length XPBD distance constraints between the two sides of a seam, with compliance ramped log-linearly from soft to stiff and a per-substep correction cap while the seams close (`Schedule`), so the pieces are drawn together instead of snapping. Gravity is off and ramps in afterwards. Nothing in the literature we know prescribes the ramp. |
| Gravity, damping, air drag | `predict` | Explicit gravity; linear damping `1 - damping * h`; quadratic air drag `k = 0.5 rho Cd / areal density`, applied semi-implicitly so it is stable at any speed (negligible at drape speeds, calms whipping free edges). Isotropic, which overestimates drag within the cloth plane. |

## Body contact

| Component | Where | Method |
|---|---|---|
| Signed distance to the body | `body.rs` (`BodyQuery`) | BVH over the triangles; sign from angle-weighted pseudo-normals, Bærentzen & Aanæs, "Signed Distance Computation Using the Angle Weighted Pseudonormal", IEEE TVCG 2005. Used for the bake and for the benchmark's exact penetration check. |
| SDF | `body.rs` (`Sdf`), `sdf.wgsl` | Narrow-band grid (4 mm cells, 12 cm band, over a per-garment box) sampled with hand-written trilinear interpolation (core WebGPU has no filtered 3D float textures). Bands cover the torso interior, so a deep penetration still has a gradient pointing out. |
| Projection | `collide_sdf` in `sim.wgsl` | Push the vertex out along the SDF gradient to `thickness` (2 mm). Position-level Coulomb friction against the motion over the substep, limited by the cone (`friction * depth`). |
| Inelastic contact | `contact()` in `sim.wgsl` | **Own.** The push-out also shifts `prev`, so a 6 mm projection does not turn into a 7 m/s kick. |
| Velocity filter | `update_velocity` | Contact may stop a vertex but not speed it up by more than `contact_max_accel * h`: in creases, stretch pulls a vertex into the body and the projection pushes it back along the normal, not back along the pull; the sideways remainder was becoming velocity (docs/history/PROGRESS.md S3). The optional velocity-level friction (`contact_vfriction`) uses the normal impulse of the contact, after Bridson, Fedkiw & Anderson, "Robust Treatment of Collisions, Contact and Friction for Cloth Animation", SIGGRAPH 2002, sec. 7.2. |

## Cloth self-collision

| Component | Where | Method |
|---|---|---|
| Neighbour search | `selfcol.rs`, `hashgrid.wgsl` | Uniform spatial hash built by counting sort (count, scan, scatter), as in Green, "Particle Simulation using CUDA", NVIDIA 2010; hashing of cells after Teschner, Heidelberger, Müller, Pomerantes & Gross, "Optimized Spatial Hashing for Collision Detection of Deformable Objects", VMV 2003. The per-vertex neighbour list covers `radius + margin`, so it stays valid for `self_rebuild_every` substeps (4). |
| Repulsion | `sc_collide` in `selfcol.wgsl` | **Own**, Jacobi gather: each vertex averages the push-outs of its listed neighbours closer than `radius` (0.75 mean edges), with friction between layers; pairs closer than 2 radii along the rest mesh or across a seam never repel (they are close because the cloth is connected). The push is elastic up to `self_max_push_speed` and inelastic beyond. |
| Untangling | `untangle.rs`, `untangle.wgsl` | **Intersection contour minimization**: Volino & Magnenat-Thalmann, "Resolving Surface Collisions through Intersection Contour Minimization", SIGGRAPH 2006; same goal as Baraff, Witkin & Kass, "Untangling Cloth", SIGGRAPH 2003, but local, so it needs no flood fill. Full detection every `untangle_check_every` substeps, gated passes around known crossings every `untangle_every`. Edge-triangle tests: Möller & Trumbore, "Fast, Minimum Storage Ray-Triangle Intersection", JGT 1997. Corrections are fixed-point integer atomics. |
| Intersection count | `selfcheck.rs` | CPU exact count (benchmark and regression metric only), grid over triangle bounds and Möller-Trumbore. |

## Stretch control

| Component | Where | Method |
|---|---|---|
| Long-range limits | `longrange.rs`, `longrange.wgsl` | Unilateral distance constraints `\|x_i - x_j\| <= (1 + slack) d_ij` between vertices 4, 16 and 64 edges apart in a panel, and 2 to 16 edges apart across a closed seam. Müller, "Hierarchical Position Based Dynamics", VRIPHYS 2008, and Kim, Chentanez & Müller, "Long Range Attachments - A Method to Simulate Inextensible Clothing in Computer Games", SCA 2012. Differences: applied between fine-mesh vertices, with no coarse meshes; rest distances are straight segments in the flat pattern (geodesic, since the segment lies inside the panel), across seams the shortest path through the seam; solved as Jacobi with constraint averaging (ω = 0.5) in two dispatches whatever their number. Cross-seam pairs switch on when the seams have closed (`Schedule::sew_ramp_s`). |
| Strain limiting | `limit_stretch` in `sim.wgsl` | Provot, "Deformation Constraints in a Mass-Spring Model to Describe Rigid Cloth Behavior", Graphics Interface 1995. **Off by default**: when measured, it made speeds jump and stopped the cloth coming to rest. Kept as an option. |

## Interaction

| Component | Where | Method |
|---|---|---|
| Mouse drag | `begin_drag` and `apply_drag` | **Own.** A small graph-connected patch (at most 32 vertices within `drag_radius`) is attached to a moving target by zero-length XPBD attachments, applied before the body contact so contact still wins. Total stiffness `drag_stiffness` is fixed (not per vertex), the target stops at the body surface, and the attachment fades out over `drag_release_frames`. |

## Assets

| Component | Where | Method |
|---|---|---|
| Pattern meshing | `drape-assets/src/meshing.rs` | Boundary resampled at the target edge length with the same segment count on both sides of each seam; interior an equilateral lattice joined to the boundary by a constrained Delaunay triangulation (the `spade` crate; Chew, "Constrained Delaunay Triangulations", SoCG 1987). **Own** in the combination. |
| Placement | `drape-assets/src/garment.rs` | **Own.** Each piece is wrapped on a cylinder around a body frame (torso, arms, legs) at a given radius and height; the sewing then closes the rest. |

## Reproducing the spike's numbers

The defaults have changed on purpose since, so the benchmarks of the spike differ from today's. The engine
configured as in the spike reproduces them: `--stretch-iterations 1 --long-range 0 --long-range-cross 0`
and `stretch_damping = 1e-5 * compliance / h^2` (1.44e-3 s for the jersey garments, 1.44e-5 s
for the twill trousers), which is the old damping expressed in the corrected formula. Measured
on the Apple M2, native, 10k and 20k vertices, self-collision on: same rest frames (231 / 292
T-shirt, 302 / 569 trousers, none for the hoodie), same persistent intersections, penetration
0.00 mm, frame times within 6% (the trousers 3-6% faster), final shape within 0.00-0.02 mm
mean difference (hoodie 20k: 0.22 mm mean, 2 mm max).
