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

Tests (`app/src/**/*.test.ts`, `npm run check`): every command applies, is accepted by Rust (the
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

### Drape and body SDF

`VtryFile.prepare` meshes and places the project's first garment (CPU, tens of ms) and names
the body's SDF by `SdfParams::cache_key` (a hash of the body mesh and the SDF box and
resolution). The worker looks for that SDF:

1. bundled with the app (`drape export-app-assets` writes the examples' SDFs, so opening an
   example never bakes);
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
Before a milestone, open the app (`cd app && npm run dev`) in Chrome and Safari: open each
example, drag the cloth, edit a fabric value and undo it, save (unedited, and after edits undone:
the file must be byte-identical to the example), and reload with unsaved changes to see the
recovery offer.
