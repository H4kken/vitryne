# Vitryne

Open-source garment design in the browser: a GPU cloth solver (Rust, WGSL, WebGPU) plus, planned,
a beginner-friendly editor. See [README.md](README.md) for what works today,
[PROGRESS.md](PROGRESS.md) for milestones and [CONTRIBUTING.md](CONTRIBUTING.md) for build and
check commands (`./check` runs the full build and tests).

## Patents: read before touching joins, placement, measuring or grading

CLO Virtual Fashion holds and enforces patents on free-sewing UIs, 2D pattern measuring and
automatic grading, and has pending applications on automatic sewing-line detection and ML
placement. Before designing or building any feature that joins pattern pieces, places pieces
around a body, measures a pattern, or resizes a garment, read
[docs/patents.md](docs/patents.md) and follow its design rules. Do not add such features
without checking them against that file, and say so when a request conflicts with it.
