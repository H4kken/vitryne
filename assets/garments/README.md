# Test garments (spike 2)

| Garment | Source design | Pieces used | Files |
|---|---|---|---|
| T-shirt | FreeSewing **Teagan** 4.10.2 | front, back (cut on fold), sleeve ×2 | `tshirt/` |
| Straight trousers | FreeSewing **Titan** 4.10.2 (trouser block), `lengthBonus` −6% (ankle length) | front ×2, back ×2 | `trousers/` |
| Hoodie | FreeSewing **Hugo** 4.10.2 | front, back (on fold), raglan sleeve ×2, kangaroo pocket, hood side ×2, hood centre | `hoodie/` |

- **Licence:** FreeSewing is MIT, © Joost De Cock ([LICENSE-FreeSewing](LICENSE-FreeSewing)).
  The DXF files are drafts of those designs, so they carry the same notice.
- **Measurements:** taken on the test avatar by `tools/patterns/measure.py` →
  [../body/measurements.json](../body/measurements.json).
- **DXF:** DXF-AAMA (ASTM D6673) written by `tools/patterns/export-aama.mjs` (FreeSewing core →
  R12 blocks; layers 1 boundary, 2 turn points, 4 notches, 6 mirror line, 7 grain, 8 internal).
  Seam allowance 0, so the boundary is the sewing line.
- **Sidecar:** each `garment.toml` says which pieces are cut, where they start around the avatar,
  and which landmark runs are sewn (DXF carries no sewing information). Draw the landmark
  numbers with `vitryne garment-svg out.svg --garment <dir>/garment.toml`. Its `title`,
  `[attribution]`, `[fabric]`, `[names]` and `label`s only name things in the project file.
- **Project files:** `vitryne convert` turns each sidecar into `assets/examples/<garment>.vtry`
  (`tools/format/build-examples.sh` does all three); the drapes, benchmarks and goldens use those.
- **Regenerate:** `cd tools/patterns && pnpm install && ./export-all.sh`.
- **Not used:** Hugo's rib waistband, cuffs and neck binding (folded rib knit), and the pocket facing.
