# Bundled bodies

Six bodies to drape on, each a project file's avatar part (`avatar.json` and `body.glb`; see
[File format](../../packages/vitryne-docs/content/docs/developers/file-format.md), Avatar):
female and male, each slim, average and fuller. They sit beside the first avatar in
[../body/](../body/README.md), which the example projects and the golden drapes still use. The
editor's Avatar panel offers all seven (`vitryne export-app-assets` copies them to `bodies/`).

| Folder | Height | Chest | Waist | Hips |
|---|---|---|---|---|
| `female-slim` | 1590 | 819 | 605 | 757 |
| `female-average` | 1590 | 845 | 652 | 761 |
| `female-full` | 1590 | 892 | 695 | 800 |
| `male-slim` | 1730 | 977 | 704 | 815 |
| `male-average` | 1730 | 982 | 747 | 827 |
| `male-full` | 1730 | 999 | 836 | 933 |

Millimetres; the full set (25 measures) is in each `avatar.json`. "Hips" is FreeSewing's, at the
hip bones.

**How they are made.** `tools/avatar/build_bodies.py` takes MakeHuman's base mesh, adds the
macro targets for the sliders in its `BODIES` table (gender 0 or 1, weight 0.1, 0.5 or 0.9, the
rest at MakeHuman's defaults: age 25, average muscle and height, the three ethnicities equal),
cuts the `body` group in metres with the feet at y = 0 exactly as `../body/convert.py` does, and
derives the measurements and regions (`tools/avatar/derive.py`). The regions come from the
skeleton's joints, which follow each body because targets move the helper vertices they are
made from. The files are reproducible: the same MakeHuman checkout gives the same bytes.

    python3 tools/avatar/build_bodies.py --makehuman <checkout of makehumancommunity/makehuman>

**Checked** (by hand with `vitryne bench` and `frames`, not part of `make check`): each body
swapped into the T-shirt and trousers projects, 400 frames. All twelve run with 0 mm penetration
except the female-average T-shirt (2.3 mm); only three reach rest in that time (the garments
settle in 180 to 310 frames on the first avatar). Four were looked at (both genders, T-shirt and
trousers): the pieces are placed and hang sensibly. The garments are drafted for the first
avatar and don't resize, so a T-shirt cut for an 849 mm chest sits differently on a 982 mm one,
and its sleeves crumple on the female body.

**Skin.** Each `body.glb` also carries a skeleton of 22 joints and weights (`tools/avatar/rig.py`:
MakeHuman's default rig, its weights remapped onto the body's vertices, folded from 139 weighted
bones into 22, four joints per vertex at most). The mesh is the same as without it, so the
collision field's key does not change. Tests (`vitryne-format`, `skin.rs`) read all six, check the
weights, and pose an arm: the hand turns rigidly about the shoulder and the far side stays put.

**Licence:** CC0, MakeHuman's own ([assets/LICENSES.md](../LICENSES.md)).
