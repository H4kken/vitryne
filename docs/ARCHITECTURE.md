# Architecture

How Vitryne is put together, and the rules that keep it that way. For the solver itself see
[ALGORITHMS.md](ALGORITHMS.md); for the file format, [FORMAT.md](FORMAT.md).

## Layout

| Part | What it is |
|---|---|
| `crates/drape-core` | The cloth solver and its public API (`Engine`, `Body`, `Garment`, `Simulation`). No rendering, no UI. |
| `crates/drape-render` | Viewport rendering: cloth and body shading, the orbit camera, picking for cloth drags. |
| `crates/vitryne-format` | The `.vtry` file family: types, reading and writing (zip or folder), validation, migrations. No engine dependency. |
| `crates/drape-assets` | DXF-AAMA import, meshing, placement; turns a `.vtry` into what the engine drapes. |
| `crates/drape-native` | The `drape` CLI and the native viewer. |
| `crates/drape-web` | The wasm build for the browser: the editor worker's API (`VtryFile`, `PreparedScene`, `Viewport`) and the bench page's (`run_bench`, ...). |
| `app/` | The editor: TypeScript, React, Tailwind and shadcn/ui, built with Vite. `bench.html` is the engine benchmark page. |

## The editor

```
 UI thread (React)                                   engine worker (wasm)
 ┌──────────────────────────────┐   inputs           ┌──────────────────────────────┐
 │ DocumentStore                │ ─────────────────▶ │ Viewport: WebGPU device on   │
 │  the file's JSON, commands,  │   requests (id)    │ the OffscreenCanvas, the     │
 │  undo/redo                   │ ─────────────────▶ │ drape, picking               │
 │ panels: 2D pattern (SVG),    │ ◀───────────────── │ VtryFile: vitryne-format     │
 │  properties, toolbar         │   replies, events  │ (open, validate, save) and   │
 │ EngineSession: the worker,   │                    │ drape-assets (mesh, place)   │
 │  restarts                    │                    └──────────────────────────────┘
 │ ProjectStorage: open, save   │
 └──────────────────────────────┘
```

**The engine runs in a Web Worker** and draws into an `OffscreenCanvas`, so the UI never
freezes while the cloth simulates. The worker also holds the file: the browser opens and saves
`.vtry` with the same Rust code as the CLI. Frames come from `requestAnimationFrame` inside the
worker, or from ticks the UI sends where workers lack it.

### Look

The editor follows the "Vitryne editor concept" design canvas (claude.ai artifact
`Ci1MyouGsSDARsvNGrZ7WM`): a start screen (presets, import a pattern, open a project), then a top bar, an icon rail
that opens one panel at a time, and one canvas showing either the 3D drape or the flat pieces,
with a status pill, a hint, zoom and a floating tool bar. Its colours, radii and type are the
tokens in `app/src/index.css` (light only); the fonts, Bricolage Grotesque and DM Sans (OFL),
are bundled from `@fontsource`, never fetched from another site. The 3D scene's colours go to
the renderer as a `drape_render::Style`. The 3D tool bar has the concept's Select, Turn view
and Pinch fabric; the flat one its Select and Move. Parts of the concept that belong to later
milestones (fabric presets, colour and print, fit, export and share, editing points, drawing from
scratch) are not built yet.

### Worker protocol

`app/src/worker/protocol.ts` defines every message:

- **inputs** (UI → worker, no reply): the canvas, its size, pointer and wheel, play/pause/fast/
  reset, frame ticks;
- **requests** (UI → worker, one reply each, matched by id): `open`, `update`, `drape`,
  `save`. Requests run one at a time, in order, after the device is up;
- **events** (worker → UI): `ready`, `stats` (fps, vertices, sim time, GPU ms per frame),
  `progress` (an SDF bake), `crashed`.

Pointer input goes to the worker as it is: the worker picks against the cloth and decides
between dragging it and orbiting.

### Document model

The UI holds the project as **the file's own JSON**: the entities exactly as Rust's
`vitryne_format::Entities` gives them, typed by `app/src/format/schema.gen.ts`. Those types and
the validators beside them are generated from `docs/format/schema/` by
`app/scripts/gen-format.mjs`, and `./check` fails if they are stale. Members the editor doesn't
know (a newer file's) stay in the JSON, so they survive by construction; Rust keeps their exact
number spelling across a round trip through JavaScript (`1.0` stays `1.0`).

The worker holds everything that isn't an entity: the binary parts (the avatar mesh), the
manifest, the versions.

**TypeScript does only cheap, simple geometry**: outlines, lengths, bounding boxes, drawing.
Anything algorithmic (import, meshing, placement, seam suggestions, measuring) stays in Rust and
is asked of the worker. One implementation of each algorithm, shared with the CLI and tested
there.

### Commands and the guardrails

Every change is a command (`app/src/document/commands.ts`), and commands are the only way the
document changes. What keeps the document from silently going wrong:

1. **Frozen.** In development and tests the document is deep-frozen; an accidental mutation
   throws.
2. **Exact.** A command records each entity it changes, before and after. Applying and reverting
   swap them, so undo restores the identical JSON (key order included), and a command refuses to
   run from a state it doesn't expect.
3. **Checked before it applies.** A command's builder runs the precompiled JSON Schema validator
   on what it produces; an invalid value (a negative weight, a fractional vertex count) never
   becomes a command, and the reason is shown. These validators let unknown members through;
   Rust keeps those.
4. **Rust has the last word.** Each new state goes to the worker, which validates the whole
   document in Rust (references, ids, physical ranges: the same checks as opening a file). A
   refusal rolls the document back to the last state Rust accepted and says why. One request is
   in flight at a time; the newest state wins.
5. **Saves are verified twice.** A save waits until Rust confirmed every edit; Rust writes the
   file, reads it back and writes it again (the bytes must match); the storage writes it, reads
   it back from disk and compares, and only then is the save reported.
6. **Revisions.** Every state has a revision; drapes are asked for and reported by revision, and
   a result older than the newest asked for is dropped.
7. **Restarts lose nothing.** A Rust panic, a lost GPU device or a worker error restarts the
   worker on a new canvas; the session reopens the file and sends the last accepted JSON (the
   document lives in the UI). Edits made meanwhile are kept and sent again. After three crashes
   in a minute the engine stops restarting and says so; the document can still be saved.
8. **Unsaved work.** A dialog before opening another file, the browser's leave-page prompt, and
   a recovery copy in IndexedDB (never sent anywhere) offered on the next start.

Tests (`app/src/**/*.test.ts`, `pnpm run check`): every command applies, is accepted by Rust (the
worker's wasm built for Node) and reverts to the identical document; the store's undo,
coalescing, rollback, restart and debounce; and fast-check sessions of random edits, undos and
redos on the three examples, with Rust holding the UI's document after every step and undo-all
saving the original bytes.

### Speed

- The UI never waits on the worker: commands apply at once, Rust confirms after.
- A slider drag is one command per movement but one undo step (`coalesce` within a gesture).
- Re-drapes are debounced (250 ms) and only follow changes that affect the drape (a fabric
  value, the mesh resolution; not a name).
- The body (mesh and SDF) is kept while its SDF key is unchanged, so a fabric edit only rebuilds
  the garment.

### Import and placement (M7)

**Import.** A DXF-AAMA file (picked, or dropped on the start screen or the canvas) is read in
the worker (`drape_assets::import`, the same importer as `drape convert`). The import dialog
shows its pieces with a thumbnail, what was left out of the file (layers the importer doesn't
use, blocks with no outline, entity types it doesn't read, arcs taken as chords, pieces a
sidecar doesn't use), and asks where each piece goes: one place, a pair of places (two cuts,
the second mirrored: arms, legs front or back, hood sides, body sides), on top of another piece
(a pocket: `follow`, 12 mm off it), or left out. Each piece comes with a suggestion **from its
name only** ("sleeve" → arms, "front" cut twice → legs, "hoodSide" → hood sides, facings,
bindings, cuffs and bands get none), which the user sees and can change: no learned placement
(PATENTS.md, rule 4). A `garment.toml` given with the DXF supplies the cuts, names and seams
(`drape convert`'s path); only its placements are replaced by the user's choices. The pieces
become a new project (the test avatar, a placeholder jersey, self-collision on, the import
collision box) or are added to the open project's garment as one undoable edit.

**Placement is a wrap, chosen from a list and then adjusted.** Every place is a region of the
avatar and an angle (`BodyPlace`). The starting wrap (`placement::auto_wrap`) is worked out from
the piece and the body, never stored rules per garment:

- **radius:** the piece's own circumference with 15% ease: a front or back is half a cylinder
  (`1.15 × width / π`), a sleeve a whole one (a tube that follows the sleeve's width,
  `tube = 1.15`); never closer than 2 cm to the body where it is measured (the shoulder joints
  for the torso, the head above the chin for hoods);
- **top:** where that kind of piece starts, from the avatar's height and the usual body
  proportions: the base of the neck (0.86 × height) for the torso, the waist (0.65) for legs,
  3 cm above the head for hoods, the shoulder joint for sleeves, centred for a strip over the
  head.

For the three samples these land within a few cm of the hand-tuned sidecars (PROGRESS.md, M7).
Then the user adjusts: in the Pieces panel (the place, around, height, distance from the body,
turn, mirror image, "fit to the body again"), or **with the 3D gizmo**. The gizmo is ours: the
placement is cylinder coordinates, so its four handles each change one of them: an arrow up and
down the region's axis (`top`), an arc around the body (`angle`), an arrow away from it
(`radius`), and a ring to turn the piece (`rotation`). The worker sends where the handles are on
screen and how far each one's point moves per unit of what it changes; the UI turns a drag into
those units. Dragging shows the piece moving at once (`Placer`, below); letting go is one edit.
Nothing new in the format: the gizmo edits the wrap's own fields.

**Placing mode.** With Select in 3D, the drape waits at the start state (`Viewport::set_placing`):
what's shown is where pieces start, so their handles sit on them. A click picks a cut (the
worker picks a vertex and names its panel); any other tool, or Play, drapes from there.

**Preview without meshing again.** `ProjectGarment::build_with_placer` keeps the meshed
pattern's coordinates and panels (`Placer`). Moving a cut re-places every vertex
(`placement::resolve_all` and `positions`, about 10k points, under a millisecond) and writes
them as the start state (`Simulation::place_at`). A move gives exactly the positions a full
rebuild would (tested bit for bit); a turn turns the meshed piece, where a rebuild meshes the
turned pattern (the same place on the body to well under 1 mm, other triangles). The edit then
re-drapes as any edit does, after 250 ms.

**Collision box.** The body's SDF is baked over the garment's `collisionBounds`; a box that
followed the pieces would change its key, and bake again, on every move. So an imported garment
gets one fixed box (the body's own, with room behind the back and above the head; bundled with
the app for the test avatar), and moving a cut asks Rust (`rewrap`) whether the garment's box
still covers it with 5 cm to spare, growing it only when it doesn't.

**The flat view** draws every cut (a mirrored cut mirrored) where `cut.layout` puts it, else side
by side in rows. Select picks a cut and turns it by a round handle above it (Shift: 15° steps);
Move drags cuts. One drag is one edit (`Arrange the pieces`); the layout is display only.

**Patents.** No sewing is derived from placement, and no learned placement (PATENTS.md, rules 3
and 4): suggestions come from names, every one shown to the user; the wrap is geometry from the
piece and the avatar's own regions.

### Drape and body SDF

`VtryFile.prepare` meshes and places the project's first garment (CPU, tens of ms) and names
the body's SDF by `SdfParams::cache_key` (a hash of the body mesh and the SDF box and
resolution). The worker looks for that SDF:

1. bundled with the app (`drape export-app-assets` writes the examples' SDFs and the import
   box's, so opening an example or importing a pattern never bakes);
2. this browser's cache (origin private file system);
3. else it bakes it (single-threaded wasm, seconds, with progress) and caches it. A damaged
   cached SDF is dropped and baked again.

The native CLI uses the same key for its cache in `target/sdf-cache/`.

### Storage

`app/src/storage/storage.ts` defines `ProjectStorage`; the editor uses nothing else to open or
save, so a cloud storage (M12) can sit beside the local one. The local one uses the File System
Access API where the browser has it (save in place, folder projects through a directory
picker) and a file input and a download elsewhere. Folder projects are written like
`container::write_dir`: parts, then the manifest, then removal of the parts that are gone.

## Checking the editor in a browser

`./check` covers the Rust, the TypeScript and the guardrails, but not a real browser with a GPU.
Before a milestone, open the app (`cd app && pnpm run dev`) in Chrome and Safari: open each
example, drag the cloth, edit a fabric value and undo it, save (unedited, and after edits undone:
the file must be byte-identical to the example), and reload with unsaved changes to see the
recovery offer.
