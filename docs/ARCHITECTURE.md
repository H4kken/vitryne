# Architecture

How Vitryne is put together, and the rules that keep it that way. For the solver itself see
[ALGORITHMS.md](ALGORITHMS.md); for the file format, [FORMAT.md](FORMAT.md).

## Layout

| Part | What it is |
|---|---|
| `packages/vitryne-engine/solver` | The cloth solver and its public API (`Engine`, `Body`, `Garment`, `Simulation`). No rendering, no UI. |
| `packages/vitryne-engine/render` | Viewport rendering: cloth and body shading, the orbit camera, picking for cloth drags. |
| `packages/vitryne-engine/format` | The `.vtry` file family: types, reading and writing (zip or folder), validation, migrations. No engine dependency. |
| `packages/vitryne-engine/pattern` | DXF-AAMA import, meshing, placement; turns a `.vtry` into what the engine drapes. |
| `packages/vitryne-engine/cli` | The `vitryne` CLI and the native viewer. |
| `packages/vitryne-engine/wasm` | The wasm build for the browser: the editor worker's API (`VtryFile`, `PreparedScene`, `Viewport`) and the bench page's (`run_bench`, ...). |
| `packages/vitryne-web/` | The editor: TypeScript, React, Tailwind and shadcn/ui, built with Vite. `bench.html` is the engine benchmark page. |

## The editor

```
 UI thread (React)                                   engine worker (wasm)
 ┌──────────────────────────────┐   inputs           ┌──────────────────────────────┐
 │ DocumentStore                │ ─────────────────▶ │ Viewport: WebGPU device on   │
 │  the file's JSON, commands,  │   requests (id)    │ the OffscreenCanvas, the     │
 │  undo/redo                   │ ─────────────────▶ │ drape, picking               │
 │ panels: 2D pattern (SVG),    │ ◀───────────────── │ VtryFile: vitryne-format     │
 │  properties, toolbar         │   replies, events  │ (open, validate, save) and   │
 │ EngineSession: the worker,   │                    │ vitryne-pattern (mesh, place)│
 │  restarts                    │                    └──────────────────────────────┘
 │ useFiles: open, autosave     │
 └──────────────────────────────┘
```

**The engine runs in a Web Worker** and draws into an `OffscreenCanvas`, so the UI never
freezes while the cloth simulates. The worker also holds the file: the browser opens `.vtry`
and writes a project's parts with the same Rust code as the CLI. Frames come from `requestAnimationFrame` inside the
worker, or from ticks the UI sends where workers lack it.

### Routes

Each URL has its own screen (`packages/vitryne-web/src/router.tsx`, `packages/vitryne-web/src/routes/`):

| URL | Screen |
|---|---|
| `/` | The start screen. Arriving here (the back button) closes the open project, once its changes are saved or the person decided about them. |
| `/design/$id` | A cloud project: a loading screen until it is open, then the editor; an error page at that URL if it can't be opened (gone, another account's, offline). Never the start screen. |
| `/example/$name` | A bundled example not changed yet (`tshirt`, `trousers`, `hoodie`). Its first save moves the URL to `/design/$id`, replacing the history entry. |
| `/new` | An import, a project from scratch or a file from disk, until its first save gives it an id. |

The editor layout (`editor/layout/EditorLayout.tsx`) is the root route's component and stays
mounted across all of them: the 3D engine lives in it (an `OffscreenCanvas` can be handed to
the worker only once), and starting it early is what makes an example open fast. The routes
render into its outlet, over the editor, and get what they need from `EditorContext`. Opening
something navigates, and the route opens what its URL names; `useFollowOpen` moves the URL when
the open project changes from inside the editor (a save giving it an id, an import, closing).

### Files

React code is one component per `.tsx` file and one hook per `useX.ts` file, each named after
what it exports (`StatusPill.tsx`, `useSewing.ts`); `react/no-multi-comp` in `pnpm run check`
keeps it so (shadcn's `components/ui/` aside). A helper only its file uses stays in that file;
one used by several gets its own (`cutLabel.ts`). A hook's result goes to components whole
(`view={view}`), and they destructure it. Logic modules (`document/commands.ts`,
`pattern/geometry.ts`, `cloud/projects.ts`, the worker) stay grouped by topic. No barrel
`index.ts`: imports name the file. The editor's folders: `editor/layout/` (the frame and its
parts), `editor/hooks/`, `editor/dialogs/`, `editor/start/`, `editor/viewport/`,
`editor/icons/`; the flat view is `pattern/panel/` (the panel, one hook per tool, the pointer's
handlers, the drawing components).

### Look

The editor follows the "Vitryne editor concept" design canvas (claude.ai artifact
`Ci1MyouGsSDARsvNGrZ7WM`): a start screen like a design tool's home (a Create row: import a file and the
examples; then the person's projects as cards with a thumbnail of the drape), then a top bar, an icon rail
that opens one panel at a time, and one canvas showing either the 3D drape or the flat pieces,
with a status pill, a hint, zoom and a floating tool bar. Its colours, radii and type are the
tokens in `packages/vitryne-web/src/index.css` (light only); the fonts, Bricolage Grotesque and DM Sans (OFL),
are bundled from `@fontsource`, never fetched from another site. The 3D scene's colours go to
the renderer as a `vitryne_render::Style`; a garment or piece with a colour (an appearance,
FORMAT.md) overrides the cloth colour per panel (`Renderer::set_panel_colors`). Colour edits
don't re-drape: after every document update the worker calls `Viewport::set_looks`, which
recolours the drape shown and its export materials. The 3D tool bar has the concept's Select,
Turn view and Pinch fabric; the flat one its Select and Move, then the pattern tools (M14,
below) and Sew. Parts of the concept that belong to later milestones (print, fit, share) are not
built yet.

### Worker protocol

`packages/vitryne-web/src/worker/protocol.ts` defines every message:

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
`vitryne_format::Entities` gives them, typed by `packages/vitryne-web/src/format/schema.gen.ts`. Those types and
the validators beside them are generated from `docs/format/schema/` by
`packages/vitryne-web/scripts/gen-format.mjs`, and `./check` fails if they are stale. Members the editor doesn't
know (a newer file's) stay in the JSON, so they survive by construction; Rust keeps their exact
number spelling across a round trip through JavaScript (`1.0` stays `1.0`).

The worker holds everything that isn't an entity: the binary parts (the avatar mesh), the
manifest, the versions.

**TypeScript does only cheap, simple geometry**: outlines, lengths, bounding boxes, drawing.
Anything algorithmic (import, meshing, placement, seam suggestions, measuring) stays in Rust and
is asked of the worker. One implementation of each algorithm, shared with the CLI and tested
there.

### Commands and the guardrails

Every change is a command (`packages/vitryne-web/src/document/commands.ts`), and commands are the only way the
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

Tests (`packages/vitryne-web/src/**/*.test.ts`, `pnpm run check`): every command applies, is accepted by Rust (the
worker's wasm built for Node) and reverts to the identical document; the store's undo,
coalescing, rollback, restart and debounce; and fast-check sessions of random edits, undos and
redos on the three examples (one run with the settings commands, one adding the pattern tools'),
with Rust holding the UI's document after every step and undo-all saving the original bytes.

### Speed

- The UI never waits on the worker: commands apply at once, Rust confirms after.
- A slider drag is one command per movement but one undo step (`coalesce` within a gesture).
- Re-drapes are debounced (250 ms) and only follow changes that affect the drape (a fabric
  value, the mesh resolution; not a name).
- The body (mesh and SDF) is kept while its SDF key is unchanged, so a fabric edit only rebuilds
  the garment.

### Import and placement (M7)

**Import.** A DXF-AAMA file (picked, or dropped on the start screen or the canvas) is read in
the worker (`vitryne_pattern::import`, the same importer as `vitryne convert`). The import dialog
shows its pieces with a thumbnail, what was left out of the file (layers the importer doesn't
use, blocks with no outline, entity types it doesn't read, arcs taken as chords, pieces a
sidecar doesn't use), and asks where each piece goes: one place, a pair of places (two cuts,
the second mirrored: arms, legs front or back, hood sides, body sides), on top of another piece
(a pocket: `follow`, 12 mm off it), or left out. Each piece comes with a suggestion **from its
name only** ("sleeve" → arms, "front" cut twice → legs, "hoodSide" → hood sides, facings,
bindings, cuffs and bands get none), which the user sees and can change: no learned placement
(PATENTS.md, rule 4). A `garment.toml` given with the DXF supplies the cuts, names and seams
(`vitryne convert`'s path); only its placements are replaced by the user's choices. The pieces
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

For the three samples these land within a few cm of the hand-tuned sidecars (docs/PROGRESS.md, M7).
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

**Patents** (other companies' claims we design around, docs/PATENTS.md; its rules override the
plan). No sewing is derived from placement, and no learned placement (PATENTS.md, rules 3
and 4): suggestions come from names, every one shown to the user; the wrap is geometry from the
piece and the avatar's own regions.

### Sewing (M8)

Sewing is the part of the editor most constrained by [PATENTS.md](PATENTS.md) (patents held by
other companies; we avoid the designs they claim, and its rules override the plan where the two
differ). The design, and why:

- **The unit is a whole edge**: the stretch of a cut's outline between two of its corners
  (corners, fold ends; notches and `point` nodes lie inside an edge and are not its ends). There
  is no way to pick a part of an edge. `seams::join_chains` in Rust refuses anything that isn't
  a whole edge, so the guardrail is not only the UI's (rule 1).
- **Two ways to make a seam, both whole edges.** (1) *Suggestions*: `seams::propose` pairs free
  edges from piece geometry only (`suggest.rs`): lengths, notch counts and where they sit,
  whether an edge bends the opposite way, which side of its piece it is on, whether it ends on
  the piece's middle line (a centre hem or neck: probably free). No placement, no body place, no
  piece name, no outline graph, no learning (rules 3 and 4). The user sews or skips each. A side
  may be a run of up to three edges of one piece, and one side may be two such runs from two
  pieces (a sleeve cap against the front's and back's armholes), paired by length. (2) *Picking*:
  the flat view's Sew tool; click an edge, then the edge it is sewn to (rule 2). Shift-click
  adds edges to a side. Nothing is measured, snapped or coloured while picking.
- **A length difference is shown only for a seam that exists**, as a sentence in the seam list
  ("Side two is 8% longer than side one"), never while picking and never in a colour that
  changes with the difference. This is the "passive" case PATENTS.md marks for counsel's review.
- **Where the logic lives.** `packages/vitryne-engine/pattern/src/suggest.rs` (edges, scoring) and
  `seams.rs` (the project's cuts and node ids, proposals, `join_chains`, per-seam length
  differences); the worker calls `sewing_edges`, `suggest_seams`, `join_edges` and
  `seam_differences`; `document/commands.ts` has `addSeam`, `removeSeam`, `reverseSeam` (so
  undo, validation and recovery work as for every edit); `sewing/` has the seams section of
  the Pieces panel (the sewn list, each seam's page, suggestions); the flat view
  (`pattern/panel/`) draws each seam in a colour on its edges and hosts the Sew tool;
  the 3D view draws the seams on the cloth (`drape-render/shaders/seams.wgsl`, screen-space
  quads between consecutive paired cloth vertices) while the Sew tool is on, and a seam hovered
  or open in the list alone (`Viewport::set_seam_highlight`).
- **Cuts, and which way a run goes.** A piece with two cuts (sleeves) is sewn once per cut:
  free is judged per cut, so sewing one sleeve leaves the other offered. Which cut meets which
  side of the partner follows the cut's mirror flag and the edge's side of its piece in the
  piece's own drawing frame (the unmirrored cut meets the partner's left-in-the-drawing side).
  It is a convention, not derived from where a cut is placed; a pattern drafted the other way
  round needs "Flip direction" or a mirrored cut. Run directions: two outlines meet running
  opposite ways, unless exactly one cut is mirrored. A chain connects through a shared corner on
  one cut, else over the junction at the higher end of each piece (the shoulder of a garment
  drawn upright), and is paired by length, so a wrong junction still sews; "Flip direction"
  reverses side two.
- **Limits.** Geometry alone cannot tell the hoodie's cuff, waistband and neck binding apart
  (near-equal lengths): they, the pocket's internal line and the hood neck chain over three cuts
  are picked by hand. `vitryne frames --seams` renders the seams natively.

### Pattern tools (M14)

The flat view's tool bar draws and edits pieces: **Edit points**, **Draw a piece** (the pen),
**Add a shape** (rectangle, ellipse, tube with typed sizes) and **Lines, notches, folds and
grain**. The start screen's *Start from scratch* opens an empty project (Rust
`import::empty_project`: the test avatar, cotton jersey, a garment with no pieces) on the flat
view.

- **Curves are in the file.** An edge is a `polyline` or, with the `VTRY_curves` extension, a
  `cubic` (one Bézier segment; a smooth curve is several, joined at `point` nodes). The
  extension is listed only when a file has a curve, so the examples' bytes don't change and
  older readers refuse curved files cleanly. Rust flattens a cubic in one place
  (`vitryne_format::Edge::interior`: fixed 0.1 mm tolerance, snapped to the 0.001 mm grid, so a
  file flattens the same everywhere); meshing, seams, suggestions and DXF export (AAMA has no
  curves) all go through it. The validator refuses a self-crossing or clockwise outline and a
  fold that leaves its piece; a line that leaves its piece is a warning (a sloppy DXF still
  opens).
- **Every edit is a command** (`document/commands.ts`): `moveNodes`, `insertNode`, `removeNode`,
  `setNodeType`, `setEdge`, `addPiece`, `addLine`, `removeLine`, `addFold`, `removeFold`,
  `setGrain`. A drag is one command at the end of the gesture (one undo step, one re-drape).
  Removing a node or a line takes the seams and folds that need it in the same command, and the
  editor says what went (a command's `note`).
- **The UI refuses before Rust has to.** `pattern/edit.ts` ports Rust's outline check
  (`check_outline_shape`) and the fold and line checks, so a drag that would cross the outline
  or push a fold out shows red and never becomes a command; Rust still validates every state.
  `pattern/edit.ts` also splits curves exactly (de Casteljau) and joins edges; `pattern/draw.ts`
  has the pen's paths, the ready shapes and the snapping. The bars over the flat view
  (`PointBar`, `DrawBar`, `MarkBar`) show and take lengths and angles.
- **Where a new piece goes** is the import dialog's body places, once or as a pair
  (`NewPieceDialog`); Rust wraps it there (`VtryFile.place_piece`: `rewrap` per cut and the
  collision box it needs) and `addPiece` adds it as one undo step. Body places start at the
  neck; a bottom is lowered with the placement's Height.
- **Patents** ([PATENTS.md](PATENTS.md)). Lengths and angles are shown and typed for one edge
  of the piece being edited or drawn, never across pieces. The pen snaps to the grid, to 15°
  steps and to the drawn piece's own points only: nothing snaps to another piece's edge length.
  An edited edge keeps its whole-edge seams. Drawn pieces have no named corners, so the seam
  list describes their edges by where they sit in their own piece ("Front: the right side").
- **Tests.** Each command applies, is accepted by Rust and reverts to the identical JSON
  (`document/outline.test.ts`, `draw.test.ts`, `marks.test.ts`); the fast-check sessions mix
  them with the settings edits. `document/skirt.test.ts` builds a skirt from a blank project
  with the same commands (two rectangles, lowered to the hips, the side seams from the
  suggestions) and checks it is `packages/vitryne-engine/tests/skirt.vtry`, which `vitryne regress` drapes as
  a golden case.

### Pattern export (M13)

**Export… → Pattern (.dxf)** writes the garment's pieces as DXF-AAMA
(`vitryne_pattern::aama_export`, the same code as `vitryne export x.vtry --out x.dxf`). It works on
the worker's document, so it needs no drape and no account. The file has the shape the importer
reads, so importing it gives the same pieces back (`tests/aama_round_trip.rs`). The parts that
take care:

- **Cut on the fold.** A piece with one fold is written as the half from the fold's first node,
  with a mirror line, only if the other half mirrors it within 0.01 mm: its vertices, node
  types and internal lines, in the order the importer recreates them. Otherwise the piece is
  written unfolded and the dialog says why.
- **Landmark order.** Each outline starts at its first node, counter-clockwise, so the importer
  numbers the landmarks as the file did and the sample `garment.toml`s still apply.
- **What DXF-AAMA can't hold** is listed in the dialog: no seam allowance (outlines are sewing
  lines until `VTRY_seam_allowance` exists), mid-edge `point` nodes that are neither fold ends
  nor internal-line ends (written as plain outline vertices), seams, placement and physics.

### Drape and body SDF

`VtryFile.prepare` meshes and places the project's first garment (CPU, tens of ms) and names
the body's SDF by `SdfParams::cache_key` (a hash of the body mesh and the SDF box and
resolution). The worker looks for that SDF:

1. bundled with the app (`vitryne export-app-assets` writes the examples' SDFs and the import
   box's, so opening an example or importing a pattern never bakes);
2. this browser's cache (origin private file system);
3. else it bakes it (single-threaded wasm, seconds, with progress) and caches it. A damaged
   cached SDF is dropped and baked again.

The native CLI uses the same key for its cache in `packages/vitryne-engine/target/sdf-cache/`.

### Storage

Projects live in the backend ([CLOUD.md](CLOUD.md), `packages/vitryne-web/src/cloud/`) and save by themselves;
nothing is written to disk. A project is a `FileRef` with a `cloud` field (id, revision, the part
hashes the backend holds). `useFiles` saves it by asking the worker for the folder form, and
`cloud/projects.ts` turns that into content-addressed parts and a row. Only a document Rust
validated is saved, and a save counts once the backend has every part and the row. `projects.ts`
talks to a `CloudBackend` interface (`backend.ts`), so its tests run on an in-memory backend and
the real Rust validation.

- **Autosave** (`cloud/autosave.ts`): about 2 s after the last confirmed edit, and when the tab
  is hidden; one save at a time; network failures retried with a growing delay; a conflict, a
  refusal that needs an account, or a quota stops it until the person decides. The scheduling is
  a plain class with fake-timer tests; `useFiles` connects it to the store and the worker.
- **One tab per project** (`cloud/lock.ts`, Web Locks): a second tab asks before taking a project
  over. Another browser is caught by the revision check.
- **The recovery copy** (`storage/recovery.ts`, IndexedDB) keeps what hasn't reached the backend.
  A copy whose tab is still open isn't offered; at start a copy nobody saved over since is put
  back and saved, otherwise offered.
- **Files from disk**: one file input (*Import a file*, ⌘O, or a drop) takes a DXF pattern, which
  goes to the import dialog, or a `.vtry` file, which opens as a new project. A project folder
  opens the same way where the browser has a directory picker (`storage/storage.ts`, `DiskFiles`).
  *Export… → Project (.vtry)* writes the open project as one file.

## Checking the editor in a browser

`./check` covers the Rust, the TypeScript and the guardrails, but not a real browser with a GPU.
Before a milestone, open the app (`cd packages/vitryne-web && pnpm run dev`) in Chrome and Safari: open each
example, drag the cloth, edit a fabric value and undo it, see it saved, go offline and edit (the
title says the changes are kept in this browser), close the tab, and reopen it online: the
changes are put back and saved.
`packages/vitryne-cloud/tests/browser.mjs` drives most of this in Chrome.
