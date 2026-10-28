// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Cut, Piece } from "@/format/schema.gen";
import { flipLayouts } from "./flip";
import { apply, bounds, type CutView, cutOutline } from "./geometry";

const node = (id: string, position: [number, number]) => ({
  id,
  type: "corner" as const,
  position,
  edge: { type: "polyline" as const, points: [] },
});
const piece = {
  id: "p",
  name: "p",
  outline: [node("a", [0, 0]), node("b", [100, 0]), node("c", [30, 80])],
  cuts: [],
} as unknown as Piece;

function view(cut: Cut, t: CutView["t"]): CutView {
  const pts = cutOutline(piece, cut);
  return { piece, cut, pts, t, box: bounds(pts.map((p) => apply(t, p))) };
}
const world = (v: CutView) => v.pts.map((p) => apply(v.t, p));

describe("flipLayouts", () => {
  for (const mirrored of [false, true])
    for (const axis of ["horizontal", "vertical"] as const)
      it(`reflects a ${mirrored ? "mirrored " : ""}cut ${axis}ly about its box`, () => {
        const cut = { id: "c", placement: {}, mirrored } as unknown as Cut;
        const v = view(cut, { x: 40, y: -25, rot: 0.7 });
        const l = flipLayouts([v], axis)["c"]!;
        const after = view(
          { ...cut, mirrored: !mirrored },
          { x: l.position[0], y: l.position[1], rot: l.rotation },
        );
        const cx = (v.box.minX + v.box.maxX) / 2;
        const cy = (v.box.minY + v.box.maxY) / 2;
        const want = world(v).map(([x, y]) =>
          axis === "horizontal" ? [2 * cx - x, y] : [x, 2 * cy - y],
        );
        world(after).forEach(([x, y], k) => {
          expect(x).toBeCloseTo(want[k]![0]!, 3);
          expect(y).toBeCloseTo(want[k]![1]!, 3);
        });
      });
});
