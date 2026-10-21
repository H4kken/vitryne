// SPDX-License-Identifier: AGPL-3.0-or-later
// Standard fabric presets (M9, docs/FABRICS.md): 5 physical presets calibrated against
// textile mechanics literature (KES-F / FAST data).

import type { Fabric } from "./schema.gen";

export const ID_COTTON_JERSEY = "01a13cdb-cc03-7001-8000-000000000001";
export const ID_DENIM = "01a13cdb-cc03-7001-8000-000000000002";
export const ID_POPLIN = "01a13cdb-cc03-7001-8000-000000000003";
export const ID_FLEECE = "01a13cdb-cc03-7001-8000-000000000004";
export const ID_WOOL_SUITING = "01a13cdb-cc03-7001-8000-000000000005";

export const COTTON_JERSEY: Fabric = {
  id: ID_COTTON_JERSEY,
  name: "Cotton jersey",
  category: "knit",
  density: 0.15,
  thickness: 0.45,
  stretch: {
    warp: 14_000,
    weft: 9_000,
    shear: 3_500,
  },
  bending: {
    warp: 6.0e-6,
    weft: 4.0e-6,
  },
  friction: 0.3,
  notes:
    "100% cotton single jersey knit, 150 g/m², typical everyday T-shirt. Soft, compliant drape following body contours. Kawabata (1980) Table 2.2; Miguel et al. (2012).",
};

export const DENIM: Fabric = {
  id: ID_DENIM,
  name: "Denim",
  category: "woven",
  density: 0.42,
  thickness: 0.85,
  stretch: {
    warp: 1_400_000,
    weft: 1_000_000,
    shear: 400_000,
  },
  bending: {
    warp: 1.4e-4,
    weft: 1.0e-4,
  },
  friction: 0.42,
  notes:
    "Heavy 3/1 right-hand twill cotton denim, 420 g/m² (12.5 oz), 5-pocket jeans weight. Stiff, holds shape away from the body in sturdy folds. Kawabata (1980); Breen et al. (1994).",
};

export const POPLIN: Fabric = {
  id: ID_POPLIN,
  name: "Poplin (shirting)",
  category: "woven",
  density: 0.125,
  thickness: 0.22,
  stretch: {
    warp: 1_100_000,
    weft: 800_000,
    shear: 300_000,
  },
  bending: {
    warp: 1.8e-5,
    weft: 1.2e-5,
  },
  friction: 0.25,
  notes:
    "Lightweight combed cotton plain-weave poplin shirting, 125 g/m² (3.7 oz). Crisp hand, fine sharp folds and ripples. Wang et al. (2011) Table 2; FAST-2 standards.",
};

export const FLEECE: Fabric = {
  id: ID_FLEECE,
  name: "Fleece",
  category: "knit",
  density: 0.28,
  thickness: 2.2,
  stretch: {
    warp: 28_000,
    weft: 18_000,
    shear: 7_500,
  },
  bending: {
    warp: 7.5e-5,
    weft: 5.5e-5,
  },
  friction: 0.38,
  notes:
    "Double-faced brushed polyester knit fleece, 280 g/m². Lofty and thick (2.2 mm), with rounded, bulky folds and moderate knit give. Kawabata (1980); FAST-1.",
};

export const WOOL_SUITING: Fabric = {
  id: ID_WOOL_SUITING,
  name: "Wool suiting",
  category: "woven",
  density: 0.25,
  thickness: 0.48,
  stretch: {
    warp: 850_000,
    weft: 650_000,
    shear: 200_000,
  },
  bending: {
    warp: 3.2e-5,
    weft: 2.4e-5,
  },
  friction: 0.32,
  notes:
    "Worsted wool 2/2 twill tailored suiting, 250 g/m² (7.5 oz). Resilient, fluid drape, holding clean creases without limp sagging. Kawabata (1980) Table 2.1; Minami et al. (2002).",
};

export const FABRIC_PRESETS: readonly Fabric[] = [
  COTTON_JERSEY,
  DENIM,
  POPLIN,
  FLEECE,
  WOOL_SUITING,
] as const;

export function findPreset(idOrName: string): Fabric | undefined {
  return FABRIC_PRESETS.find(
    (p) => p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase(),
  );
}

/** Returns the preset matching the given fabric values closely, if any. */
export function matchingPreset(f: Fabric): Fabric | undefined {
  return FABRIC_PRESETS.find((p) => {
    return (
      p.category === f.category &&
      Math.abs(p.density - f.density) < 1e-4 &&
      Math.abs(p.stretch.warp - f.stretch.warp) < 1e-2 &&
      Math.abs(p.stretch.weft - f.stretch.weft) < 1e-2 &&
      Math.abs(p.bending.warp - f.bending.warp) < 1e-8 &&
      Math.abs(p.bending.weft - f.bending.weft) < 1e-8
    );
  });
}
