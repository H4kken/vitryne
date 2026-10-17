// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a cut can start on the body, in plain words (docs/ARCHITECTURE.md, Placement). The
// names are Rust's `placement::BodyPlace` and `import::Pair`; Rust works out each wrap.

import type { Placement } from "@/format/schema.gen";

export const PLACES = {
  "body-front": { label: "Body, front", region: "torso", angle: 0 },
  "body-back": { label: "Body, back", region: "torso", angle: Math.PI },
  "body-left": {
    label: "Body, left side",
    region: "torso",
    angle: Math.PI / 2,
  },
  "body-right": {
    label: "Body, right side",
    region: "torso",
    angle: -Math.PI / 2,
  },
  "arm-right": { label: "Right arm", region: "arm-right", angle: 0 },
  "arm-left": { label: "Left arm", region: "arm-left", angle: 0 },
  "leg-right-front": {
    label: "Right leg, front",
    region: "leg-right",
    angle: 0,
  },
  "leg-right-back": {
    label: "Right leg, back",
    region: "leg-right",
    angle: Math.PI,
  },
  "leg-left-front": { label: "Left leg, front", region: "leg-left", angle: 0 },
  "leg-left-back": {
    label: "Left leg, back",
    region: "leg-left",
    angle: Math.PI,
  },
  "head-right": {
    label: "Head, right side",
    region: "head",
    angle: -Math.PI / 2,
  },
  "head-left": { label: "Head, left side", region: "head", angle: Math.PI / 2 },
  "over-head": { label: "Over the head", region: "head-over", angle: 0 },
} as const;

export type Place = keyof typeof PLACES;

/** Two cuts at once: the first on the wearer's right, the second (mirrored) on the left. */
export const PAIRS = {
  arms: { label: "Arms, right and left", places: ["arm-right", "arm-left"] },
  "legs-front": {
    label: "Legs, front, right and left",
    places: ["leg-right-front", "leg-left-front"],
  },
  "legs-back": {
    label: "Legs, back, right and left",
    places: ["leg-right-back", "leg-left-back"],
  },
  "head-sides": {
    label: "Hood sides, right and left",
    places: ["head-right", "head-left"],
  },
  "body-sides": {
    label: "Body sides, right and left",
    places: ["body-right", "body-left"],
  },
} as const satisfies Record<string, { label: string; places: [Place, Place] }>;

export type Pair = keyof typeof PAIRS;

/** The difference between two angles, radians, in 0..π. */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/**
 * The place a wrap is at or nearest to (its region, the closest angle), or null for a
 * region the list doesn't name (straight arms, ...) or a cut placed on another.
 */
export function placeOf(p: Placement): Place | null {
  if (p.type !== "wrap") return null;
  let best: [Place, number] | null = null;
  for (const [k, v] of Object.entries(PLACES) as [
    Place,
    (typeof PLACES)[Place],
  ][]) {
    if (v.region !== p.region) continue;
    const gap = angleGap(v.angle, p.angle ?? 0);
    if (!best || gap < best[1]) best = [k, gap];
  }
  return best?.[0] ?? null;
}

export const degrees = (radians: number) => (radians * 180) / Math.PI;
export const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Rounds what a handle or a field produces to what is worth storing: 0.1 mm, 0.0001 rad. */
export function tidy(p: Placement): Placement {
  if (p.type !== "wrap") return p;
  const mm = (x: number | undefined) =>
    x === undefined ? undefined : Math.round(x * 10) / 10;
  const rad = (x: number | undefined) =>
    x === undefined ? undefined : Math.round(x * 1e4) / 1e4;
  const out: Placement = {
    ...p,
    angle: rad(p.angle),
    radius: mm(p.radius),
    top: mm(p.top),
  };
  if (p.rotation !== undefined) {
    const r = Math.round(p.rotation * 1e4) / 1e4;
    if (r === 0) delete out.rotation;
    else out.rotation = r;
  }
  return out;
}
