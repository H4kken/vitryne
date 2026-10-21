# Tools

Scripts around the engine. Run them from the repository root. Their output goes to `bench-out/`,
which git ignores.

| Path | What it does |
|---|---|
| [bench/run.sh](bench/run.sh) | Runs the drape or the 60 s random-drag benchmark over garments × sizes (× seeds), natively or in headless Chrome. One JSON per run, then a summary table. |
| [bench/summary.py](bench/summary.py) | Markdown tables for any drape or drag JSON (files or directories). `--group` sums drag runs per target × garment × size. |
| [bench/compare.py](bench/compare.py) | Two targets side by side, matched run by run: speed ratio, rest frame, penetration, self-intersections, final-shape difference, drag stability. |
| [bench/chrome-check.mjs](bench/chrome-check.mjs) | Drives the installed Chrome headless with its GPU, over CDP: loads a page, waits for `#status`, saves a screenshot and the page's JSON report. `run.sh` uses it. |
| [strain.py](bench/strain.py) | Edge-strain tables from drape and drag JSON (`--regions --groups --seams --hotspots`). |
| [format/validate.py](format/validate.py) | Checks a Vitryne file (`.vtry` zip or folder) against `docs/format/schema/` and the reference rules of [docs/FORMAT.md](../docs/FORMAT.md). Needs `pip install jsonschema`. |
| [format/build-examples.sh](format/build-examples.sh) | Regenerates `examples/*.vtry` (folder form) from the sample garments' sidecars with `vitryne convert`, writes the zips to `bench-out/examples/`, and validates both forms. Run it after changing the converter or a sidecar; `./check.sh` fails until you do. |
| [patterns/](patterns/) | Measures the avatar and drafts the sample garments with FreeSewing into DXF-AAMA (`cd tools/patterns && pnpm install && ./export-all.sh`). |

## Examples

```sh
# Drape matrix, native: 3 garments x {10k, 20k}, self-collision on
tools/bench/run.sh drape bench-out/drape/native

# The same in Chrome (serve the page first: cd app && pnpm run dev:app)
TARGET=chrome tools/bench/run.sh drape bench-out/drape/chrome
python3 tools/bench/compare.py bench-out/drape/native bench-out/drape/chrome

# Drag test, one garment, three seeds, with an extra engine flag
GARMENTS=trousers VERTS=10000 SEEDS="1 2 3" tools/bench/run.sh drag bench-out/drag/trousers --untangle-every 0
python3 tools/bench/summary.py bench-out/drag/trousers --group
```

`run.sh` reads its matrix from `GARMENTS`, `VERTS`, `SEEDS`, `SC` (self-collision, default on),
`TARGET` (`native` or `chrome`), `PORT` and `QUERY` (extra `bench.html` parameters); the header
of the script lists them. For a single run with every option, call the CLI directly:
`target/release/vitryne bench …` or `bench-drag …` (flags in
[crates/drape-native/src/main.rs](../crates/drape-native/src/main.rs)).

**Other browsers:** open `/bench.html` in the browser, press Run, then Copy JSON, and save it
to a file. `summary.py` and `compare.py` read that file as it is.

**Profiling:** add `--gpu-timestamps` to any native `vitryne` command, or `?gpu-timestamps=1` to a
web page URL, for per-pass GPU times. It's the only optional WebGPU feature Vitryne ever
requests, and only in that mode.
