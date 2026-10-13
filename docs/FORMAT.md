# The Vitryne file format, version 1

**Status: approved design (MVP milestone M4, 2026-10-13), implemented in M5 by
[crates/vitryne-format](../crates/vitryne-format/) (reading, writing, validation, migrations) and
`drape-assets` (`project`: a file to the engine; `convert`: `garment.toml` + DXF to a file).**

A Vitryne file holds a garment project: pattern pieces, how they're sewn, where they start around
the body, the fabrics, the avatar and the simulation settings, plus optionally a cached drape so
the file opens without simulating. This document is the specification; the JSON Schemas in
[format/schema/](format/schema/) are its machine-readable part, and
[examples/](../examples/) holds three complete projects (T-shirt, trousers, hoodie).

Each section gives the rules, then **Why** for the choices that weren't obvious.

**Contents:** [Principles](#principles) · [Files and kinds](#files-and-kinds) ·
[Container](#container) · [Conventions](#conventions) · [Project](#project) ·
[Garment](#garment) · [Fabric](#fabric) · [Avatar](#avatar) ·
[Simulation settings](#simulation-settings) · [View](#view) ·
[Simulation cache](#simulation-cache) · [Versions and migrations](#versions-and-migrations) ·
[Extensions and future features](#extensions-and-future-features) · [Interop](#interop) ·
[From garment.toml](#from-garmenttoml) · [Cloud storage](#cloud-storage) ·
[In the engine](#in-the-engine) · [Decisions](#decisions)

## Principles

1. **The file is the design, not a dump of the engine.** It describes a garment the way a pattern
   maker would (pieces, notches, seams, grain, fabric properties in physical units), so it stays
   valid when the solver changes. Engine-specific tuning lives in one clearly fenced object.
2. **Old files always open.** Every format change comes with a migration, and the reader runs
   them in order.
3. **Nothing is lost.** A reader keeps what it doesn't understand (unknown fields, extensions,
   parts) and writes it back.
4. **Readable and diffable.** Structure is JSON, one entity per part, so a change to a fabric is a
   small diff in one file. Binary only where the data is large (meshes).
5. **Derived data is a cache.** A drape can always be thrown away and recomputed.
6. **Interop is not the format.** DXF-AAMA comes in and glTF/OBJ go out through converters; the
   format doesn't mirror either.

## Files and kinds

One container format, four kinds of file. The kind is in the manifest; the extension is only a hint
for people and operating systems.

| Kind | Extension | Media type | Holds |
|---|---|---|---|
| `project` | `.vtry` | `application/vnd.vitryne.project+zip` | `project.json`, its garments, fabrics and avatar, optional view and caches |
| `garment` | `.vtryg` | `application/vnd.vitryne.garment+zip` | one garment and the fabrics it uses (no avatar) |
| `fabric` | `.vtryf` | `application/vnd.vitryne.fabric+zip` | one or more fabrics (a fabric library) |
| `avatar` | `.vtrya` | `application/vnd.vitryne.avatar+zip` | one avatar |

**Why one format for all four:** one reader, one set of migrations, one extension mechanism, and
copying between kinds is copying parts. A garment file is a project minus the project root and
avatar. **Why separate extensions anyway:** distinct icons, double-click opens the right thing,
and an "import fabric" dialog can offer only `.vtryf`. **Why not `.vit`:** Valentina/Seamly2D,
open-source pattern software with the same audience, already uses `.vit` for measurement files.

**Sizes, for scale** (the T-shirt example): the garment part is 41 KB of JSON (6.6 KB deflated),
a fabric 0.5 KB, the avatar mesh 482 KB. A `.vtryf` or `.vtryg` is a few KB; a project is
dominated by its avatar.

## Container

A file is a **zip archive** (PKWARE APPNOTE; Deflate or Store; ZIP64 allowed; UTF-8 names; no
encryption):

```
mimetype                          the media type, ASCII, no newline
manifest.json                     kind, format version, list of parts
project.json                      kind project only
garments/<id>.json                one per garment
fabrics/<id>.json                 one per fabric
avatars/<id>/avatar.json          one per avatar, with its mesh:
avatars/<id>/body.glb
sources/<id>.<ext>                optional: imported originals (role source)
cache/<key>.glb                   optional: cached drapes (role cache)
view.json                         optional: camera
```

- **`mimetype` is the first entry, stored uncompressed, with no extra field**, so the media type
  sits at byte 38 of the file and identifies it without unzipping (the EPUB and ODF trick).
- **Every other file is listed in `manifest.json` `parts`** with its path and media type, and
  normally its `sha256`. Readers warn on a hash mismatch but still open the file, so hand edits
  work. Writers compute fresh hashes.
- **Entity parts live at fixed paths:** a garment with id X is `garments/X.json`. References in
  the JSON are ids; the path follows from the id.
- **Compression:** writers deflate JSON and store binaries (`.glb` is already compact, and stored
  entries can be read without inflating). `vitryne-format` writes fixed timestamps, so the same
  document always gives the same bytes.
- **Paths:** relative, `/`-separated, no `..`, case-sensitive.
- **Folder form:** the same layout unzipped, in a directory named like the file
  (`tshirt.vtry/`), is a valid file too. The repository keeps examples this way so their JSON is
  diffable; `tools/format/build-examples.sh` regenerates them and writes the zips.

**Why a zip of parts:** like `.docx` and `.3mf`, it is one file for users, and any tool can open
it. Per-part JSON gives small diffs and maps directly onto cloud object storage (each part a
content-addressed object, see [Cloud storage](#cloud-storage)). One big JSON file would carry
meshes as base64 (+33%) and rewrite everything on every save. SQLite isn't diffable or easy to
inspect.

### manifest.json

```json
{
  "format": "vitryne",
  "kind": "project",
  "formatVersion": 1,
  "minReaderVersion": 1,
  "generator": "vitryne 0.1.0 (web)",
  "parts": [
    { "path": "project.json", "mediaType": "application/json", "sha256": "6bb97a4a…" },
    { "path": "avatars/01a1…/body.glb", "mediaType": "model/gltf-binary", "sha256": "…" },
    { "path": "cache/sha256-4f2c….glb", "mediaType": "model/gltf-binary", "role": "cache" }
  ],
  "extensionsUsed": [],
  "extensionsRequired": []
}
```

`role` is `cache` for derived data that may be deleted at any time, `source` for kept originals.
See [Versions and migrations](#versions-and-migrations) and
[Extensions](#extensions-and-future-features) for the other fields.

## Conventions

### Units

| Quantity | Unit |
|---|---|
| **Every length in a JSON part, 2D or 3D** | **millimetre** |
| Angles | radian |
| Areal density | kg/m² |
| Stretch and shear stiffness | N/m |
| Bending rigidity | N·m |
| Friction | dimensionless |
| Binary parts (glTF) | metre (the glTF rule), declared by their media type |

The one exception is `simulation.engine` (see [Simulation settings](#simulation-settings)),
which uses the engine's own units.

**Why mm everywhere in JSON:** one rule to remember. Patterns are drafted and exchanged in mm and
`523.5` reads better than `0.5235`; the 3D numbers in JSON are few (placement, avatar regions)
and gain nothing from metres. The large 3D data is binary glTF, which must be metres and is
uploaded to the GPU as is. **Why physical units for fabric:** the same fabric must behave the same
at 5k and 20k vertices and in a future solver; per-edge spring constants are an engine detail.

### Coordinate systems

- **2D (pattern):** each piece has its own frame, x to the right, **+y towards the top of the
  garment** (the neck of a shirt, the waist of trousers), seen from the **right (outer) side** of
  the fabric. Outlines run **counter-clockwise**.
- **3D (avatar space):** right-handed, **+Y up, the avatar faces +Z, the wearer's left is +X**,
  feet at y = 0. The same axes as glTF.

### Identifiers

- Every entity, and every point or line something can refer to, has an **`id`: a UUID**
  (RFC 9562), lowercase and hyphenated, **unique within the file**. Writers create **version 7**
  (time-ordered); readers accept any version.
- **References are always ids, never array positions or names.** Names are labels for people.
- Copying an entity into a file that already has its id (pasting the same garment twice) gives
  the copy fresh ids, and updates the references inside it.

**Why UUIDs:** they survive edits, re-imports, copying between files and, later, merging edits
from several people, with no central counter. **Why version 7:** time-ordered keys index well in
Postgres (cloud storage). The cost: v7 reveals when an id was created. **The other cost:** a seam
is no longer `"front:3-5"` but two UUIDs, so the JSON is harder to read by hand. Nodes carry names
for that, and tools print them (the example's seams are readable through the node names).

### Numbers and JSON

- JSON is UTF-8, no BOM, numbers are IEEE doubles. Writers round lengths to 0.001 mm and keep
  other values at full precision.
- Writers emit **camelCase** names, and indent JSON (2 spaces, `[x, y]` pairs on one line) so
  that diffs are line-based. Readers don't care about formatting.

## Project

`project.json`, kind `project` only ([schema](format/schema/project.schema.json)):

```json
{
  "id": "01a13cdb-cc01-7c75-b193-e1f5e9b453f4",
  "name": "T-shirt (Teagan)",
  "garments": ["01a13cdb-cc02-7918-aa9f-9eb6980dd3b8"],
  "avatar": "01a13cdb-cc04-728e-9afd-3f992133737d",
  "fabrics": ["01a13cdb-cc03-713c-9796-120438b8ba92"],
  "simulation": { "targetVertices": 10000 }
}
```

- `garments` is in **layering order**, closest to the body first. The MVP drapes one garment;
  the order is defined now so outfits need no format change.
- `fabrics` lists every fabric part, used or not: the project's own fabric library.
- `avatar` is the avatar every garment is draped on.

## Garment

`garments/<id>.json` ([schema](format/schema/garment.schema.json)). The entity tree:

```
garment ── fabric (default for its cuts)
 ├─ pieces[]
 │   ├─ outline[]: nodes (corner | notch | point), each with the edge to the next
 │   ├─ lines[]:   internal lines, open paths of nodes
 │   ├─ folds[]:   fold lines, between two outline nodes
 │   ├─ grain
 │   └─ cuts[]:    each copy cut from fabric: mirrored?, fabric?, placement, layout
 ├─ seams[]:       side a and side b, each a chain of runs (cut, from node, to node)
 ├─ simulation:    overrides of the project's settings
 ├─ sources[]:     imported originals
 └─ attribution
```

### Pieces and outlines

A **piece** is a pattern piece as drafted. Its **outline is the sewing line** (seam allowance
zero), as a closed loop of **nodes** in counter-clockwise order. Each node has an `id`, a
`type`, an optional `name`, a `position`, and the **`edge` from it to the next node**:

```json
{
  "id": "01a13cdb-cc06-7bbe-9365-6ac1ac56bab7",
  "type": "corner",
  "name": "hem, left side",
  "position": [242.283, -485.3],
  "edge": { "type": "polyline", "points": [[242.307, -464.868], [242.376, -445.055], …] }
}
```

- **Node types:** `corner` (the outline turns), `notch` (an alignment notch), `point` (anything
  else worth naming: fold ends, where an internal line meets the outline, a point added so a seam
  can start or end there).
- **Edges:** v1 has `polyline` only: the points strictly between the node and the next one, empty
  for a straight edge. The edge from a node is identified by that node's id.
- An edge between two nodes is the unit the rest of the format refers to. Points without ids
  inside an edge are geometry only.

**Why nodes with edges, not a flat list of points with ids:** only the points that matter
(corners, notches) need identity. Giving all 700 points of a T-shirt an id would triple the file
and make diffs noisy. **Why each node owns its outgoing edge:** no parallel arrays to keep in
step. **Why the sewing line, not the cut line:** sewing, placement and simulation all happen on
the sewing line. Seam allowance is for cutting and goes in an extension (planned
`VTRY_seam_allowance`, per edge).

### Internal lines

`lines[]` are open paths inside the piece (pocket placement, darts, stitching lines): `id`,
`name`, and `nodes` in order, each with the edge to the next **except the last**. They're meshed
as creases and can be sewn (the hoodie's pocket is sewn onto one).

### Cut on the fold

**A cut-on-fold piece is stored unfolded**: the outline is the whole piece as cut from the
fabric, and **`folds[]`** records each fold line as the straight line between two outline nodes
(for the T-shirt front, centre front hem to centre front neck).

**Why unfolded (option A):** what's stored is what's cut, meshed and simulated, and every point a
seam may use exists in the file. The half-piece form can always be rebuilt from the outline and the
fold, but the half-piece form can't represent an asymmetric piece. Keeping halves symmetric while
editing, and re-folding for DXF export, need the fold, which is why it's a real entity rather
than a note. Symmetric editing will be an addition (a `symmetric` flag on a fold, plus paired
nodes), not a breaking change.

### Grain line

`grain: {from, to}` is the grain line as drawn; its direction is the fabric's **warp** (the
direction `fabric.stretch.warp` applies to). Absent means +y.

### Cuts

A piece is cut one or more times. Each **cut** is one copy in the garment:

```json
"cuts": [
  { "id": "01a13cdb-cc26-…", "name": "right sleeve",
    "placement": { "type": "wrap", "region": "upper-arm-right", "angle": 0.0, "radius": 60.0, "top": -40.0 } },
  { "id": "01a13cdb-cc27-…", "name": "left sleeve", "mirrored": true,
    "placement": { "type": "wrap", "region": "upper-arm-left", "angle": 0.0, "radius": 60.0, "top": -40.0 } }
]
```

- `mirrored`: the mirror image (x → −x in the piece frame), the other one of a left/right pair.
- `fabric`: overrides the garment's fabric for this cut.
- `placement`: where it starts before sewing (below).
- `layout`: where it sits in the 2D pattern view. Display only. The cut's points (after
  mirroring) are turned by `rotation` (radians, counter-clockwise) about the piece's origin, then
  moved by `position` (mm). Without one, the app lays cuts out as it likes.

**Seams and placement refer to cuts; geometry belongs to the piece.** Both cuts share the piece's
node ids, and directions are always in the piece frame, including for a mirrored cut.

**Why pieces and cuts:** editing the sleeve changes both sleeves, as it does on paper. The
alternative, one piece per copy, would duplicate geometry and let left and right drift apart.

### Placement

Where a cut starts, before sewing pulls it into place. Two types in v1:

**`wrap`**: rolled onto a cylinder around one of the avatar's [regions](#regions).

| Field | Meaning |
|---|---|
| `region` | region name, e.g. `torso`, `upper-arm-left` |
| `angle` | where the piece's centre goes around the axis, radians from the region's zero direction; increasing towards `axis × zero` |
| `radius` | cylinder radius, mm |
| `top` | where the piece's top edge goes along the axis, mm from the region's origin (torso: height above the floor; limbs: negative is down the limb) |
| `rotation` | optional: in-plane rotation of the piece before wrapping, radians counter-clockwise, after mirroring |
| `tube` | optional, for long sleeves: below the piece's widest row the radius follows the pattern (`tube` × width / 2π); above it, it rises linearly to `radius` at the top edge |

The maths: transform the piece's points (mirror, then rotate) and take its **anchor**, the
centre of its bounding box in x and the top in y. A point p goes to
`region.at(along = top + (p − anchor).y)` + `r · (cos θ · e0 + sin θ · e1)`, with
θ = `angle + (p − anchor).x / r`, where `e0` is the region's zero direction and `e1 = axis × e0`
at that point of the axis. The reference implementation is `drape-assets` `garment.rs`
(`Frame::place` and `tube_profile`); v1 is defined to match it.

**`follow`**: on top of another cut, like a pocket on a front: the same region, anchor, top and
tube as the followed cut, at its radius plus `lift` (mm), at its angle unless `angle` is given.
The followed cut must not follow this one, directly or indirectly.

The editor's placement gizmo adjusts these fields themselves (around, along, away from the
axis, turn): no other placement data was needed.

**Why regions by name:** a garment file has to fit any avatar. Garments say "torso" and
"upper-arm-left", and each avatar defines where those are. The region coordinates used to be
hard-coded in Rust for one avatar; they move into the avatar. **Patents:** placement is data the
user sets. Under [PATENTS.md](PATENTS.md) rule 3, auto-join must not use it as an input, and that
is an app rule, not a format rule.

### Seams

A seam sews **side `a`** to **side `b`**. Each side is a chain of **runs**, and **the start of
`a` meets the start of `b`**, the end of `a` the end of `b`:

```json
{
  "id": "01a13cdb-cc2d-77a1-8042-7453fa1f0bc1",
  "name": "right side seam",
  "a": [{ "cut": "<front>",  "from": "<underarm, right>", "to": "<hem, right side>", "direction": "ccw" }],
  "b": [{ "cut": "<back>",   "from": "<underarm, right>", "to": "<hem, right side>", "direction": "cw" }]
}
```

- **A run** is a stretch of one cut's outline between two of its nodes: `cut`, `from`, `to`, and
  `direction`, `ccw` (the outline's order) or `cw`, in the piece frame. On an internal line, give
  `line` (its id) instead of `direction`; the run goes from `from` to `to` along the line.
- **A side may chain several runs**, across cuts (the hoodie's hood neckline runs along the
  front, the top of a raglan sleeve and the back).
- **`pairing`:** `nodes` (the default): if both sides pass through the same number of nodes, the
  nodes meet (notches line up) and each stretch between them is matched by length; otherwise the
  sides are matched by length overall. `length`: always matched by length along the whole
  chain (needed when sides have different notches, like the hood's crown seams).
- **Run ends are nodes, always.** A seam that ends partway along an edge needs a `point` node
  there. That's how the T-shirt sleeve's cap top (no notch in the pattern) works: a named point
  at half the length between the two cap notches.
- **The format doesn't restrict which nodes a seam may use** (whole edges, notch to notch, or any
  two points). The patent-driven interaction rules in [PATENTS.md](PATENTS.md) constrain how
  the editor lets people create seams, not what a file may contain.

**Why "starts meet" instead of the sidecar's `reverse` flag:** one rule, no flag. To reverse a
side, write its runs the other way.

### Garment simulation overrides and sources

- `simulation`: overrides the project's `targetVertices` and `engine`, plus
  **`collisionBounds`** `{min, max}` (mm, avatar space): the box the cloth can reach, where the
  body's collision field is built. Optional; when absent the engine derives one (see
  [In the engine](#in-the-engine)).
- `sources[]`: imported originals (`id`, `type` such as `dxf-aama`, `fileName`, optional `part`
  if the original is kept in the container with role `source`). Pieces point back with
  `source: {source, piece}`. For reference and re-import only: nothing is read from a source when
  opening a file. **Originals stay in the user's own project and are left out of shared copies:**
  the app keeps an imported DXF as a `source` part of the project (on the user's disk or in their
  cloud storage), and drops `source` parts by default when exporting or sharing a `.vtry` or
  `.vtryg`, unless the user opts in ("include original files"). The `sources[]` entries stay, so
  the record of what a garment came from survives without its contents.

  **Why:** a kept original allows re-importing with a better importer (arcs are chords today),
  updating from a changed source, and reproducing import bugs, at a small cost in a project
  (20–40 KB next to a 482 KB avatar). But a DXF from professional software can hold more than
  the user means to share (other sizes, grade rules, other pieces, author or company names), and
  it would make a shared garment file 3–6 times larger.
- `attribution`: title, creator, SPDX licence, source URL. Kept wherever the garment is copied,
  because licences like MIT (FreeSewing) require the notice to travel with the work.

## Fabric

`fabrics/<id>.json` ([schema](format/schema/fabric.schema.json)). The physical behaviour only:

```json
{
  "id": "01a13cdb-cc03-713c-9796-120438b8ba92",
  "name": "Cotton jersey (placeholder)",
  "category": "knit",
  "density": 0.15,
  "stretch": { "warp": 11547.005383792517, "weft": 11547.005383792517, "shear": 4330.127018922194 },
  "bending": { "warp": 5e-06, "weft": 5e-06 },
  "friction": 0.3,
  "notes": "The engine's spike-1 placeholder (Material::cotton), not calibrated. …"
}
```

| Field | Meaning | Unit |
|---|---|---|
| `category` | `woven`, `knit` or `nonwoven` (quality targets differ: p99 strain 3% woven, 8% knit) | |
| `density` | areal density | kg/m² |
| `thickness` | optional; not used by the v1 engine (collision thickness is a simulation setting) | mm |
| `stretch.warp`, `.weft` | tensile stiffness along the grain and across it: force per unit width per unit strain | N/m |
| `stretch.shear` | in-plane shear stiffness | N/m |
| `bending.warp`, `.weft`, `.bias` | bending rigidity per unit width (bias optional, defaults to the mean) | N·m |
| `friction` | Coulomb coefficient against the body | |
| `notes` | where the values come from, or that they are placeholders | |
| `attribution`, `libraryRef` | for fabrics from a library | |

**Why these quantities:** they're the ones fabric testing reports (tensile, shear and bending
tests, like KES-F or FAST), and the ones published presets (M9, `docs/FABRICS.md`) will cite.
They're independent of mesh resolution and of the solver. Anisotropy (warp ≠ weft) is in the
format from the start, even though the v1 engine is isotropic (see [In the engine](#in-the-engine)).
**Why appearance isn't here:** colour and texture change per colourway while the physics stays
the same. They'll be a separate entity (see [Extensions](#extensions-and-future-features)).

## Avatar

`avatars/<id>/avatar.json` plus its mesh `avatars/<id>/body.glb`
([schema](format/schema/avatar.schema.json)). **The avatar is embedded in every project**, so a
project opens on its own; content hashes let the app (and cloud storage) recognise and share an
avatar used by many projects.

```json
{
  "id": "01a13cdb-cc04-728e-9afd-3f992133737d",
  "name": "MakeHuman base (male, A-pose)",
  "attribution": { "title": "MakeHuman base mesh (hm08)", "creator": "…", "license": "CC0-1.0", "source": "…" },
  "mesh": "avatars/01a13cdb-cc04-728e-9afd-3f992133737d/body.glb",
  "pose": "A",
  "regions": {
    "torso": { "type": "axis", "origin": [0.0, 0.0, 30.0], "axis": [0, 1, 0], "zero": [0, 0, 1] },
    "arm-left": { "type": "path", "points": [[182.0, 1360.0, 6.0], [297.0, 1179.0, 12.0], …], "zero": [0, 1, 0] },
    …
  }
}
```

- **Mesh:** glTF 2.0 binary, one mesh, triangles, metres, in avatar space (+Y up, facing +Z, feet
  at y = 0). The collision field (SDF) is never stored; the engine bakes or caches it.
- **`measurements`:** optional, mm, informational in v1.

**Why glTF:** standard, compact, in metres, and it already has skins, morph targets and
animations for poses later. OBJ has none of those.

### Regions

A region is a frame to wrap pieces around: `zero` is the direction of angle 0 around it.

- `axis`: a straight line through `origin` along `axis` (pointing towards the top of the pieces).
- `path`: a centreline through `points` (the first is the origin), a Catmull-Rom curve that
  carries on straight past the last point; along the first segment's direction above the origin.
  `zero` is carried along the curve (parallel transport).

**Region vocabulary.** Garments refer to these names; an avatar defines the ones it supports.
"Left" is always the wearer's left (+X).

| Region | What | angle 0 | Sidecar frame |
|---|---|---|---|
| `torso` | vertical axis through the body; `top` = height above the floor | front | `torso` |
| `head` | vertical axis through the head | front | `head` |
| `head-over` | left-right axis through the head centre, for strips over the top of the head | top | `head_over` |
| `upper-arm-left`, `-right` | straight, from the shoulder joint along the upper arm | top of the arm | `arm_l`, `arm_r` |
| `arm-left`, `-right` | the arm's centreline, bent at the elbow, to the wrist | top of the arm | `bentarm_l`, `bentarm_r` |
| `arm-straight-left`, `-right` | straight, from the shoulder joint towards the wrist | top of the arm | `longarm_l`, `longarm_r` |
| `leg-left`, `-right` | axis through the leg, from the floor | front | `leg_l`, `leg_r` |

New region names are additions, not format changes. A file using a region its avatar doesn't
have still opens; the app reports the cut as unplaced.

## Simulation settings

In `project.json` `simulation`, overridable per garment:

- **`targetVertices`**: the mesh resolution, about this many cloth vertices per garment.
- **`engine`**: **sparse** engine tuning, only the values that differ from the engine's defaults,
  keyed by the engine's own setting names (`drape-core` `SimSettings`, e.g.
  `{"substeps": 30, "self_collision": false}`). **This object uses the engine's units (SI,
  metres) and naming, the one exception to the format's conventions.** Unknown keys are kept
  and ignored (with a warning). Three keys aren't `SimSettings` fields: `schedule` (the
  garment's sewing and gravity ramp, `drape-core` `Schedule`), and `sdf_cell`, `sdf_band` (the
  collision field's cell size and band, m). The garment's values win over the project's.

**Why sparse:** a file that doesn't override a value gets the engine's improvements to that
value, and the file states only what the author chose. Reproducing an exact drape is the cache's
job (its key includes the engine version). **Why a fenced engine namespace:** the solver's
30-odd tunables change with the engine; putting them in the format proper would mean a format
version per solver change. Anything users set through the UI (resolution today; quality presets
later) gets a format-level name.

## View

`view.json`, optional: `camera` (`target` in mm, `distance` in mm, optional `yaw`/`pitch` in
radians). It never affects the drape and isn't part of the cache key
([schema](format/schema/view.schema.json)).

## Simulation cache

A cached drape lets a file open showing the drape without simulating. **It's always optional and
always safe to delete.** Readers that can't use it ignore it.

- **One entry per drape of the project** (all garments, since outer layers depend on inner
  ones): the part `cache/<key>.glb`, role `cache`, where `<key>` is `sha256-` plus the hex key.
- **The key** is the SHA-256 of the canonical JSON (RFC 8785, JCS) of everything the drape
  depends on:

  ```json
  {
    "keyVersion": 1,
    "engine": { "name": "drape-core", "version": "0.1.0" },
    "garments": [ <each garment part, in layering order> ],
    "fabrics": [ <each fabric used, by id order> ],
    "avatar": { "mesh": "<sha256 of body.glb>", "regions": { … } },
    "simulation": <the resolved settings: engine defaults, then project, then garment overrides>
  }
  ```

  A file opens with its cache only if the recomputed key matches. Renaming a piece changes the
  key too; v1 accepts that to keep the rule simple (a recompute is the only cost), and a later
  `keyVersion` can leave out display-only fields.
- **The cache part is a glTF 2.0 binary**, in metres: one glTF mesh per garment, one primitive
  per cut, with `POSITION` (the draped positions), `_PATTERN` (VEC2 float, the vertex's pattern
  position in its cut's frame, metres), and triangle indices. `asset.extras.vitryne` holds
  `{key, keyVersion, engine, frames, atRest}`; each mesh's `extras.garment` and each primitive's
  `extras.cut` hold ids.
- **To resume simulating** from a cache (drag after opening), the engine re-meshes the garment
  and uses the cached positions only if the mesh matches `_PATTERN` exactly. Otherwise it shows
  the cache and re-drapes.

**Why glTF for the cache:** it is the export format (M10) and viewable in any glTF viewer. The
same code writes both. **Why the engine version is in the key:** GPU solvers aren't bit-exact and
a solver change alters drapes. A stale cache shows a drape the current engine wouldn't
produce.

## Versions and migrations

- **`formatVersion`** (integer) is the version the file was written in. **Every change to the
  format increments it**, additive or not, and comes with a migration (possibly a no-op).
- **`minReaderVersion`** is the oldest reader that can open and save the file correctly. It moves
  only on a **breaking** change (removed or reinterpreted data); for an additive change (a new
  optional field that older readers can ignore safely) it stays.
- **A reader**:
  - **older file** (`formatVersion` below its own): applies the migrations from
    `formatVersion` to its own, in order, on the raw JSON of all parts, before parsing into types.
    Saving writes its own version.
  - **newer file it can still read** (`minReaderVersion` ≤ its version < `formatVersion`): opens
    it, keeps unknown members, extensions and parts, and saves it with the file's
    `formatVersion` and `minReaderVersion` unchanged.
  - **file too new** (its version < `minReaderVersion`): refuses with "made with a newer Vitryne",
    and may offer read-only viewing.
- **Migrations are pure JSON-to-JSON functions**, one per version step, never deleted. The test
  suite keeps a fixture file for every past version and checks it migrates and opens.
- **A rule for future additive features:** if a new field's meaning depends on other data
  (e.g. per-size node offsets), it must stay valid when an older app edits that data, or the
  change has to be breaking, or it goes in a required extension.

**Why an integer and not semver:** "can I read this?" is answered by `minReaderVersion`, so a
single counter is enough. **Why migrate raw JSON:** the typed structures only ever exist for the
current version, so old type definitions don't pile up in the code.

## Extensions and future features

- **Unknown members are kept.** A reader preserves any JSON member it doesn't know (at any level)
  and any part it doesn't know, and writes them back. Writers never invent members outside
  extensions. The schemas are strict (they reject unknown members) because they check what a
  v1 *writer* produces; readers are lenient.
- **`extensions`**: every object may carry `extensions: {"NAME": {…}}`, glTF style. Names are
  `VTRY_…` (official), `EXT_…` (shared by several vendors) or a vendor prefix. The manifest lists
  every name in `extensionsUsed`, and in **`extensionsRequired`** those without which the file
  would be misread; a reader that lacks a required extension refuses the file. Official
  extensions can later move into the core format through a migration.
- **`extras`**: free-form application data on any object, never interpreted.

How the planned features fit, without breaking v1 files:

| Feature | How it's added |
|---|---|
| **Sizes and grading** | Per-size offsets of outline **nodes** (by id), the way grade rules work in industry formats. The ids are why nodes exist. A `sizes` list on the garment plus per-node deltas. (Watch [PATENTS.md](PATENTS.md) rule 6 for automatic grading.) |
| **Colourways and textures** | A new `appearances/<id>.json` entity (colour, texture parts, print scale), and `colourways` on the garment mapping cuts to appearances. Physics stays in fabrics, so nothing existing changes. |
| **Multi-garment outfits** | Already there: `project.garments` is in layering order. Per-garment visibility or grouping are additions. |
| **Avatars from measurements** | `avatar.source = {generator, measurements}`, with `body.glb` as the generated (and regenerable) mesh. |
| **Animations and poses** | glTF skins and animations in `body.glb`; a project-level `pose` reference. The cache key gains the pose. |
| **Collaboration** | Stable ids per entity are what operation-based sync needs; per-entity parts let edits travel as small objects. Metadata (authors, comments) goes on entities in `extras` or an extension. The file stays a snapshot. |
| **Seam allowance, curved edges** | `VTRY_seam_allowance` per edge; new `edge.type` values (`arc`, `cubic`), which a reader that doesn't know them must refuse, so they go in `extensionsRequired` until they're core. |

## Interop

Converters, not the format:

- **In: DXF-AAMA** (M5 converter; M7 in the editor, where each cut is placed as the user
  chooses and seams come from a `garment.toml` if one is given). Each DXF piece becomes a piece; boundary
  (or sew line, layer 14) → outline in mm, CCW; turn points → `corner` nodes; notches → `notch`
  nodes; mirror line → unfolded outline plus a `fold` between two `point` nodes; grain line →
  `grain`; internal lines → `lines` (both ends and every turn over 15° become nodes). DXF
  quantity gives the default number of cuts. Arcs are imported as chords (as today). Anything
  ignored is reported at import and not stored. The original may be kept as a `source` part.
  The importer puts every point on the format's 0.001 mm grid, so an imported piece is exactly
  the piece a saved file holds.
- **Out: glTF 2.0 and OBJ** (M10): the draped mesh in metres, UVs from pattern coordinates (the
  `_PATTERN` data of the cache), one material per fabric.
- **Out: DXF-AAMA** (later): re-folds pieces along their `folds` when the halves are still
  symmetric, writes notches and grain; seam allowance once that extension exists.

## From garment.toml

`drape convert <garment.toml> <out.vtry>` (`drape-assets` `convert`) turns a sidecar plus its
DXF into a project with the test avatar. The three samples in [examples/](../examples/) are its
output (`tools/format/build-examples.sh`), and `./check.sh` fails if they drift from it. Ids are
version 7 from a fixed time and the garment's name, so converting again gives the same file.
Only the DXF pieces the sidecar uses become pieces (the hoodie's waistband, cuffs, binding and
pocket facing are left out); `--include-dxf` keeps the DXF as a `source` part.

| `garment.toml` | Vitryne file |
|---|---|
| `name` | `garment.name` |
| `dxf`, `units_m` | imported once into pieces (mm); recorded in `garment.sources[]`; the DXF may be kept as a `source` part |
| `[sdf]` `min`, `max` | `garment.simulation.collisionBounds`, in mm; without `[sdf]`, the engine's default box (`SdfParams::default`), written out so the drape doesn't change |
| `[sdf]` `cell`, `band` | dropped when they equal the engine defaults (4 mm, 120 mm: true for all three samples), else `garment.simulation.engine` `sdf_cell`, `sdf_band` (m) |
| `schedule` | `garment.simulation.engine.schedule` (no sample sets it) |
| `title`, `[attribution]` | `garment.name` (default: `name`), `garment.attribution` |
| `[fabric]` `name`, `category`, `notes` | the fabric's (default: a knit placeholder named after the garment) |
| `[names]` `front = [...]`, `"sleeve:3+0.5" = "..."`, `"front:L0" = [...]` | node names: landmarks in order, a fractional point, an internal line's landmarks |
| `label` on `[[piece]]`, `[[seam]]` | the cut's and the seam's name (default: `name`) |
| `[material]` (or the default `Material::cotton`) | a fabric part: `density` as is; `stretch.warp` = `weft` = 2k/√3 and `shear` = 3/8 of that, from `stretch_k` (see below); `bending.warp` = `weft` = `bend_kb`; `friction` = 0.3 (the engine's current value); `category` by sample (T-shirt and hoodie `knit`, trousers `woven`) |
| `camera = [x, y, z, d]` | `view.json` camera: `target` = (x, y, z) in mm, `distance` = d in mm (the default camera when absent) |
| `[[piece]]` with the same `dxf` | one **piece**, with one **cut** per `[[piece]]` entry (`name` → cut name) |
| `mirror` | `cut.mirrored` |
| `rotate` (degrees) | `cut.placement.rotation` (radians) |
| `place.frame` | `placement.type = "wrap"`, `region` by the table in [Regions](#regions) |
| `place.angle`, `radius`, `top`, `tube` | `angle` in radians; `radius`, `top` in mm; `tube` as is |
| `place.lift` without `like` | added to `radius` |
| `place.like = "x"`, `lift` | `placement.type = "follow"`, `cut` = x's cut id, `lift` in mm |
| DXF landmarks (numbered per piece) | outline **nodes**: Turn → `corner`, Notch → `notch`, FoldEnd and LineEnd → `point`; names from the sidecar's comments |
| fractional landmark `3+0.5` | a `point` node inserted at half the length from node 3 to node 4 |
| `L0:2-3` (internal line, landmarks) | a `lines[]` entry; its landmarks become its nodes |
| `[[seam]]` `name`, `a`, `b` | `seam.name`, `a`, `b` as chains of runs |
| `"front:3-5"` | run `{cut, from: node 3, to: node 5, direction: "ccw"}` |
| `"!front:3-5"` | run `{cut, from: node 5, to: node 3, direction: "cw"}` |
| `"front:L0:2-3"` | run `{cut, line, from: node 2, to: node 3}` |
| `reverse = true` | side `b` written the other way: its runs in reverse order, each with `from`/`to` swapped and the direction flipped |
| `by_length = true` | `pairing = "length"` |

**The stretch conversion.** The engine's `stretch_k` is the stiffness of each mesh edge. For a
mesh of equilateral triangles, springs of stiffness k act like a membrane with tensile stiffness
Y = 2k/√3 and Poisson's ratio 1/3, so shear stiffness Y / (2(1 + ν)) = 3Y/8, whatever the edge
length. The engine converts back with k = (√3/2) · Y. The cotton placeholder's k = 10⁴ N/m becomes
Y = 11,547 N/m; the trousers' k = 10⁶ N/m becomes 1.155 × 10⁶ N/m. These are the same
placeholders under a physical name, not calibrated values (M9 does that).

**The T-shirt, worked through:** 3 pieces (front and back cut on the fold, unfolded with 12 nodes
each; sleeve with 6 nodes plus the cap-top `point`), 4 cuts (the left sleeve mirrored),
10 seams. The sidecar's `side_r` (`a = "front:10-11"`, `b = "back:1-2"`, `reverse = true`)
becomes side a "front, underarm right → hem right side, ccw", side b "back, underarm right → hem
right side, cw". See [the example](../examples/tshirt.vtry/). (The M4 example was written by a
script by hand and had one seam wrong: its "left armhole, back" ran counter-clockwise from the
underarm to the shoulder tip, the long way round the back. The converter writes what the sidecar
says, shoulder tip to underarm.)

## Cloud storage

The format is the same on disk and in the cloud. The planned hosted instance (and any self-hosted
one) stores a file as **its manifest plus content-addressed parts**: each part is an object keyed
by its SHA-256. That gives, for free:

- **Deduplication:** an avatar used by a thousand projects is stored once.
- **Small uploads:** saving after a fabric change uploads one small JSON part and a new manifest.
- **Downloads are exports:** a `.vtry` is the manifest and its parts, zipped.

Local mode (no backend configured) makes no network calls; the app reads and writes files on the
user's disk. How accounts and storage work is an app concern (M6 onward), not a format one.

## In the engine

What reading a file into the engine takes (`drape-assets` `project`, done in M5):

1. **Fabric from physical values.** `Material` is built from the fabric: k = (√3/2) · mean(warp,
   weft), `bend_kb` = mean(warp, weft), and the friction setting from `friction`. The engine
   stays isotropic until M9; shear is ignored, and opening warns if warp ≠ weft.
2. **Region frames from the avatar.** Frames are built from `avatar.regions` (mm → m). The test
   avatar's regions are in `assets/body/avatar.json`, which the `garment.toml` path uses too
   (`Frame::named` is gone). A garment file (no avatar) is placed on the test avatar.
3. **One fabric per garment.** The engine takes one `Material` per garment; a garment whose cuts
   use different fabrics is refused with a clear message until it doesn't.
4. **Collision bounds.** From `collisionBounds` when present; otherwise the placed garment's
   bounding box plus 150 mm on every side (not below the floor). The samples carry theirs.
5. **Identical drapes.** Each cut is a panel (pieces in order, then their cuts), its outline
   split into edges at every node, so a `.vtry` and the `garment.toml` it came from give the
   same engine garment, bit for bit (`drape-assets` test `project_matches_sidecar`), and drape
   the same (`drape regress` and `drape regress --toml` share one set of goldens). Two things
   made that exact: the importer's 0.001 mm grid (above), and the mesher listing triangles in a
   canonical order (it used to follow the triangulation library's internal order, which
   sub-micrometre input changes can reorder, and triangle order is constraint order).
6. **The avatar mesh** comes from the file's `body.glb`; the drape cache isn't implemented yet
   (cache parts are kept and written back unread).

## Decisions

Approved on 2026-10-13 (M4 review). This design commits to:

1. **Zip of JSON parts plus glTF**, one entity per part, `mimetype` first; also valid as a folder.
2. **Four kinds, one format:** `.vtry`, `.vtryg`, `.vtryf`, `.vtrya`, told apart by
   `manifest.kind`.
3. **mm for every length in JSON**, radians, SI for physics; glTF parts in metres; the engine
   tuning object is the single exception.
4. **UUIDv7 ids** on entities and on the nodes things refer to; references never use indices or
   names.
5. **Nodes plus edges** for outlines: only corners, notches and named points have ids.
6. **Cut-on-fold stored unfolded**, with folds as entities.
7. **Pieces and cuts:** geometry once, copies (mirrored or not) as cuts.
8. **Placement by named body region**, the regions defined by the avatar.
9. **Seams as two chains of runs, starts meeting**, any two nodes allowed.
10. **Fabric in physical units**, anisotropic from the start; appearance kept separate.
11. **The avatar embedded** in every project.
12. **Sparse simulation settings**, with engine tuning fenced off.
13. **A glTF drape cache keyed by a SHA-256 of all inputs plus the engine version.**
14. **`formatVersion` + `minReaderVersion`**, migrations on raw JSON, unknown data preserved,
    glTF-style extensions.
15. **Imported originals** stay in the user's own project and are left out of shared copies
    unless the user opts in.

Settled in the review, to revisit later:

- **The avatar is embedded in every project.** Fine for now; a reference to a shared avatar can
  be added later (a new avatar `source`, with the embedded mesh as its cache).
- **The schema ids use `vitryne.app` URLs.** They're names, not downloads; nothing has to be
  hosted. Publishing the schemas there later would give editors autocompletion. Changing the
  domain later means new `$id`s in a new schema version, not a format change.
- **Node names on a fresh DXF import:** the converter writes the sidecars' names; a fresh import
  has none, so seams would show as "corner 3". Names generated from position ("hem, left side")
  come later, in M7 or M8.
