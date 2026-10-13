# Asset licences

Vitryne's code is AGPL-3.0-or-later (see [../LICENSE](../LICENSE)). The assets in this folder keep
their own licences, listed here. Anything in `assets/` that isn't listed is Vitryne's own work
under the AGPL like the code.

| Path | What it is | Licence | Source and notice |
|---|---|---|---|
| `body/makehuman_body_m.obj` | MakeHuman base mesh (hm08), body group only, converted to metres | **CC0-1.0** | [MakeHuman](https://github.com/makehumancommunity/makehuman), `makehuman/data/3dobjs/base.obj`, released CC0 in 2020 by Data Collection AB, Joel Palmius and Jonas Hauquier. Details in [body/README.md](body/README.md). |
| `garments/tshirt/tshirt.dxf` | FreeSewing **Teagan** 4.10.2, drafted at the avatar's measurements | **MIT** | © Joost De Cock, [garments/LICENSE-FreeSewing](garments/LICENSE-FreeSewing) |
| `garments/trousers/trousers.dxf` | FreeSewing **Titan** 4.10.2, ankle length | **MIT** | © Joost De Cock, [garments/LICENSE-FreeSewing](garments/LICENSE-FreeSewing) |
| `garments/hoodie/hoodie.dxf` | FreeSewing **Hugo** 4.10.2 | **MIT** | © Joost De Cock, [garments/LICENSE-FreeSewing](garments/LICENSE-FreeSewing) |

**Vitryne's own files in this folder** (AGPL-3.0-or-later): the `garment.toml` sewing and
placement sidecars, `body/measurements.json` (measured on the CC0 mesh by
`tools/patterns/measure.py`), `body/convert.py`, and the READMEs.

**Generated, not in the repository:** the body SDFs (`target/sdf-cache/`, `app/public/sdf/`,
`app/public/bench-assets/`) are baked from the CC0 mesh at build time by `drape
export-app-assets` and `drape export-bench-assets`.

**Build-time dependencies, not in the repository:** `tools/patterns` drafts the DXFs with the
FreeSewing npm packages (MIT). Rust crates and npm packages are fetched by `cargo` and `pnpm`
under their own licences.

## Adding an asset

Add a row here in the same commit, with the licence, the source and any notice the licence
requires. Only add assets whose licence allows redistribution in an AGPL project (for example
CC0, CC-BY, MIT, Apache-2.0). Large binaries go through Git LFS (see
[../CONTRIBUTING.md](../CONTRIBUTING.md)).
