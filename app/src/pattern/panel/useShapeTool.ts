// SPDX-License-Identifier: AGPL-3.0-or-later
// The shape tool: a ready shape dragged out on the pen's grid (Shift: as wide as high), or a
// click for its starting sizes.

import { useState } from "react";
import type { Vec2 } from "@/format/schema.gen";
import {
  type ShapeKind,
  SHAPE_START,
  shapeFromDrag,
  shapeProblem,
  snapStep,
} from "../draw";
import { type P, roundMm } from "../geometry";

export function useShapeTool(o: {
  shapeKind: ShapeKind;
  mmPerPx: number;
  /** The shape tool is on and dragging this box. */
  box: { from: P; to: P } | null;
}) {
  const { shapeKind, mmPerPx, box } = o;
  /** Shift held while dragging a shape out: as wide as high. */
  const [even, setEven] = useState(false);
  /** Where a shape's corner goes for the pointer at `p`: on the grid the pen snaps to. */
  const shapeAt = (p: P): P => {
    const step = snapStep(mmPerPx);
    return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
  };
  /**
   * The shape a drag from `from` to `to` makes: its sizes, and where its bottom left goes (it
   * fills the box from where the drag started). No `to`: a click, the starting sizes centred
   * there.
   */
  const shapeDrop = (from: P, to: P | null, square: boolean) => {
    const size = to
      ? shapeFromDrag(
          shapeKind,
          Math.abs(to[0] - from[0]),
          Math.abs(to[1] - from[1]),
          square,
        )
      : SHAPE_START[shapeKind];
    const origin: Vec2 = to
      ? [
          roundMm(to[0] < from[0] ? from[0] - size.width : from[0]),
          roundMm(to[1] < from[1] ? from[1] - size.height : from[1]),
        ]
      : [roundMm(from[0] - size.width / 2), roundMm(from[1] - size.height / 2)];
    return { size, origin, problem: shapeProblem(shapeKind, size) };
  };
  const shapePreview = box ? shapeDrop(box.from, box.to, even) : null;
  return { setEven, shapeAt, shapeDrop, shapePreview };
}
