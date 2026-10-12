# Tools

Scripts around the engine. Run them from the repository root. Their output goes to `bench-out/`,
which git ignores.

| Path | What it does |
|---|---|
| [check_drapes.py](check_drapes.py) | The drape smoke test that `./check` runs |
| [bench/chrome-check.mjs](bench/chrome-check.mjs) | Drives the installed Chrome headless, with its GPU, over CDP: loads a page, waits for `#status`, saves a screenshot and the page's JSON report |
| [bench/s3/one.sh](bench/s3/one.sh), [run.sh](bench/s3/run.sh), [sweep.sh](bench/s3/sweep.sh) | The 60 s random-drag test: one run, the garments × sizes × seeds matrix, or one garment over 6 seeds (native) |
| [bench/s3/chrome.sh](bench/s3/chrome.sh) | The same drag test in headless Chrome (needs `npm run dev` in `web/`) |
| [bench/compare.py](bench/compare.py), [compare_m3.py](bench/compare_m3.py), [m4/compare_m4.py](bench/m4/compare_m4.py) | Native vs browser tables (speed, rest frame, shape parity) |
| [bench/m4/](bench/m4/), [s2/](bench/s2/), [s3/summary.py](bench/s3/summary.py) | One-line summaries of drape and drag JSON |
| [bench/m5/tables.py](bench/m5/tables.py), [s3/final_table.py](bench/s3/final_table.py) | The spike report tables |
| [patterns/](patterns/) | Measures the avatar and drafts the sample garments with FreeSewing into DXF-AAMA (`cd tools/patterns && npm install && ./export-all.sh`) |

The scripts named after a spike milestone (m3, m4, m5, s2, s3) read their inputs from
`bench-out/<milestone>/…`, with the same layout the spike used under `bench/`. For example, after
copying the spike's raw data to `bench-out/`, `python3 tools/bench/m5/tables.py` reproduces
[docs/history/m5-tables.md](../docs/history/m5-tables.md) exactly.

**Profiling:** add `--gpu-timestamps` to any native `drape` command, or `?gpu-timestamps=1` to a
web page URL, for per-pass GPU times. It's the only optional WebGPU feature Vitryne ever
requests, and only in that mode.
