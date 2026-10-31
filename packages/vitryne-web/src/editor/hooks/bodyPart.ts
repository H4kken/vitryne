// SPDX-License-Identifier: AGPL-3.0-or-later
// Which part of the body a point of the avatar is on, for dropping a piece on the 3D view. A
// position only: nothing here reads a piece or its seams (packages/vitryne-docs/content/docs/developers/patents.md,
// rule 3). The avatar faces +Z with the wearer's left at +X, Y up (file-format.md).

import type { Avatar } from "@/format/schema.gen";
import { zoneKey } from "@/editor/dialogs/bodyZones";

type V = readonly [number, number, number];

/** How close to an arm's centreline a point counts as the arm, mm. */
const ARM_REACH = 85;
/** Heights as fractions of the body's height: the crotch (legs below) and the neck's base (the head above). */
const CROTCH = 0.47;
const NECK = 0.86;
const DEFAULT_HEIGHT = 1750;

function segmentDistance(p: V, a: V, b: V): number {
  const [abx, aby, abz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [apx, apy, apz] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  const t = Math.max(
    0,
    Math.min(1, (apx * abx + apy * aby + apz * abz) / len2),
  );
  return Math.hypot(apx - t * abx, apy - t * aby, apz - t * abz);
}

/**
 * The zone key (`front:torso`, `back:leg-left`, `front:arm-right`, ...) of `point` (metres), or
 * null on the head or off the zones. `avatar` gives the arms' centrelines and the height.
 */
export function bodyPart(
  point: readonly [number, number, number],
  avatar: Avatar | undefined,
): string | null {
  const p: V = [point[0] * 1000, point[1] * 1000, point[2] * 1000];
  const height = avatar?.measurements?.height ?? DEFAULT_HEIGHT;
  for (const side of ["left", "right"] as const) {
    const pts = avatar?.regions[`arm-${side}`]?.points;
    if (!pts) continue;
    for (let k = 0; k + 1 < pts.length; k++)
      if (segmentDistance(p, pts[k] as V, pts[k + 1] as V) < ARM_REACH)
        return zoneKey("front", side === "left" ? "arm-left" : "arm-right");
  }
  if (p[1] > NECK * height) return null;
  const side = p[0] >= 0 ? "left" : "right";
  if (p[1] < CROTCH * height)
    return zoneKey(
      p[2] >= 0 ? "front" : "back",
      side === "left" ? "leg-left" : "leg-right",
    );
  return zoneKey(p[2] >= 30 ? "front" : "back", "torso");
}
