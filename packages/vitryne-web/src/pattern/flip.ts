// SPDX-License-Identifier: AGPL-3.0-or-later
// Flipping cuts in the flat view: each becomes the mirror image of what it is (its `mirrored` flips)
// and its layout changes so that the picture is the reflection of the old one about the middle
// of the cuts' joint box. With world = R(rot) * M(local) + position and M = x -> -x when mirrored:
// a left-right reflection is R(-rot) with M toggled, an up-down one is R(pi - rot) with M toggled.

import type { Layout } from "@/document/commands";
import type { CutView } from "./geometry";

export type FlipAxis = "horizontal" | "vertical";

/** The cuts' new layouts, by cut id (each cut's `mirrored` is to be toggled too). */
export function flipLayouts(
  views: readonly CutView[],
  axis: FlipAxis,
): Record<string, Layout> {
  const cx =
    (Math.min(...views.map((v) => v.box.minX)) +
      Math.max(...views.map((v) => v.box.maxX))) /
    2;
  const cy =
    (Math.min(...views.map((v) => v.box.minY)) +
      Math.max(...views.map((v) => v.box.maxY))) /
    2;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return Object.fromEntries(
    views.map((v) => {
      const horizontal = axis === "horizontal";
      const position: [number, number] = horizontal
        ? [round(2 * cx - v.t.x), round(v.t.y)]
        : [round(v.t.x), round(2 * cy - v.t.y)];
      const rotation =
        Math.round(wrap((horizontal ? 0 : Math.PI) - v.t.rot) * 1e6) / 1e6;
      return [v.cut.id, { position, rotation }];
    }),
  );
}
