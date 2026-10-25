# Changelog

What changes for people who use or self-host Vitryne, one section per release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (0.x: anything may change between minor versions).
Add a line under **Unreleased** with your pull request when it changes what people see; a
release renames that section ([docs/MAINTAINING.md](docs/MAINTAINING.md#releasing)).

## [Unreleased]

### Added

- Dark mode in the editor: pick Light, Dark or System from the new appearance menu in the top bar
  and on the start screen (the choice is kept in this browser).

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

[0.2.0]: https://github.com/H4kken/vitryne/releases/tag/v0.2.0
[0.1.1]: https://github.com/H4kken/vitryne/releases/tag/v0.1.1
[0.1.0]: https://github.com/H4kken/vitryne/releases/tag/v0.1.0
