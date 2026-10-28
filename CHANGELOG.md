# Changelog

What changes for people who use or self-host Vitryne, one section per release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (0.x: anything may change between minor versions).
Add a line under **Unreleased** with your pull request when it changes what people see; a
release renames that section ([docs/MAINTAINING.md](docs/MAINTAINING.md#releasing)).

## [Unreleased]

### Changed

- The side panel opens over the canvas, as in Figma, instead of squeezing the views.

### Added

- Right-click menus in the flat and 3D views: on a piece, move it outwards or inwards, copy it or
  delete it; on empty canvas, paste, fit the pieces in view, draw a piece, import a pattern, or
  restart the drape.
- Flip pieces horizontally or vertically in the flat view (Shift-H, Shift-V, the right-click
  menu, or the Flip buttons in a piece's panel, which replace the Mirror image switch); a flipped piece is the mirror image, in 3D too.
- Copy, paste and duplicate pieces with ⌘C, ⌘V and ⌘D (Ctrl on Windows and Linux) or from the menu.

## [0.3.0] - 2026-10-28

### Added

- Layers and Seams: a **Pieces | Layers | Seams** switch at the top of the Pieces panel. Seams
  moves the list of seams and their suggestions out of the bottom of the pieces list.
  Layers lists the pieces outermost first, like layers in Figma, beside a rail that says which
  way is outside: drag a piece, or use its up and down arrows (or Alt + arrow keys), to change
  what is outside what. A piece placed on another is nested under it and moves with it. Each
  shows how far out it starts, and the selected one can start further out. Fit to the body again
  keeps that distance.
- Sewing is easier to read: hovering a suggested seam picks its edges out in the flat view; the
  Sew tool highlights the free edge under the pointer and a header at the top of the flat view
  shows its length (the first edge stays there while you point at the second); the dot in the
  middle of a piece's 3D handles drags it freely over the body.
- Keys for the flat view's tools: V Select, A Edit points, P Draw a piece, M Lines, notches, folds
  and grain, S Sew two edges; hints show ⇧ ⌥ ⌘ on a Mac. The marks tool's hint sits above its
  buttons.
- The 3D view: Cmd (Ctrl) + drag turns the view and Option (Alt) + drag slides it, with any tool;
  two fingers up and down on a trackpad zoom; selecting a piece picks it out in 3D. The Turn view
  tool is gone (with Pinch fabric, dragging empty space no longer turns the view: hold Cmd).
- Dark mode in the editor: pick Light, Dark or System from the new appearance menu in the top bar
  and on the start screen (the choice is kept in this browser).
- Import Valentina patterns (`.val`) with their measurements (`.vit`, or a `.vst` size chart and
  a size): drop them on the editor or use **Import a file**; the dialog asks for the measurements
  file the pattern names. Curves stay curves. Also `vitryne convert pattern.val out.vtry
  --measurements m.vit [--size 176,100]`.

### Changed

- Project file format version 4: every garment lists its pieces' layer order (`stack`, closest
  to the body first) and a piece can sit further out (`offset`), the base for a Layers panel.
  Older files open and are migrated; files with garments saved by this version need this version
  or newer (a fabric or avatar file still opens in older ones).
- Pieces that overlap on the body start apart: the one higher in the layer order starts further
  out than the ones under it (a gap that follows the mesh, at least 12 mm), plus its own offset,
  so alternative versions of a piece or layers of clothing no longer start inside each other.
  The sample garments start as before.
- The 3D view starts on Select, and Select only picks a piece while the drape is live; paused, it
  shows the handles to move the piece. Pinch fabric works only while the drape is live (pressing
  it on the cloth while paused flashes Play), and Space or Play never changes the tool. Keys `1`
  and `2` pick Select and Pinch fabric (by key position, so they work on any keyboard layout).
  Pausing no longer puts the cloth back, and R always restarts from the placement.
- Start screen: **Import a file** is a slim row above the examples, dragging a file over the
  window shows a full-screen drop zone, and **Start from scratch** has a larger Lucide icon.

- Import dialog: **Import as it is** for a piece no body place fits. It starts as a nearly flat
  sheet in front of the chest, to move by hand.

### Fixed

- Dragging a point so the outline folds back on itself now shows red and is refused, instead of
  being accepted and then failing to save.
- Importing a Valentina pattern whose outline has a hairpin stub (an edge out and back along a
  curve) no longer stops the 3D engine: the stub is closed, and an outline that still folds back
  on itself is refused with a message.
- The import dialog's measurements box follows the dark theme, and its place list no longer
  offers a piece that already sits on this one (two pieces on each other made the project
  invalid: "its placement follows itself").
- The "where it goes" list scrolls normally instead of jumping back up.

## [0.2.0] - 2026-10-23

### Added

- A documentation website (`packages/vitryne-docs`, Astro + Fumadocs): getting started and
  requirements, and the developer docs, with search.
- The editor links to the documentation: _Docs_ on the start screen, _Documentation_ in the help
  menu, and _How it works_ on an empty pattern.
- `make stack`: the editor built from the checkout and a local Supabase, all in Docker, for
  contributors (`packages/vitryne-cloud/dev/`); `make stack-test` runs the backend tests on it.

## [0.1.1] - 2026-10-22

### Changed

- Self-hosting: `docker-compose.yml` is one port (`HTTP_PORT`) and the Supabase settings, and
  refuses to start without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. HTTPS comes from a proxy
  in front (`SITE_ADDRESS`, `HTTPS_PORT` and the `caddy-data` volume are gone). The privacy page's
  operator details (`OPERATOR_*`) are no longer set from the compose file.

## [0.1.0] - 2026-10-21

The first public beta.

### Added

- The editor, in the browser (WebGPU): start from an example, import a DXF-AAMA pattern, or
  draw one (pen, ready shapes, curved edges, edited points, notches, folds and grain lines).
- Sewing by whole edges, with suggestions from the pattern's geometry and two-click picking.
- Placement around the avatar: body places, automatic wrap, a 3D gizmo, then pinch and pull the
  cloth.
- A GPU cloth solver with self-collision, the same in the browser and natively.
- Five fabric presets, for the whole garment or per piece.
- Export to glTF 2.0 and OBJ, with the pattern as UVs and a material per fabric.
- Projects in the cloud, saved as you work: try it without an account (one draft), or keep every
  project and export with a free account. No telemetry.
- Self-hosting: one container (`ghcr.io/h4kken/vitryne-web`) and a Supabase project
  ([docs/CLOUD.md](docs/CLOUD.md)).
- The `vitryne` command line: viewer, benchmarks, `.vtry` conversion, DXF-AAMA export.

[0.3.0]: https://github.com/H4kken/vitryne/releases/tag/v0.3.0
[0.2.0]: https://github.com/H4kken/vitryne/releases/tag/v0.2.0
[0.1.1]: https://github.com/H4kken/vitryne/releases/tag/v0.1.1
[0.1.0]: https://github.com/H4kken/vitryne/releases/tag/v0.1.0
