// SPDX-License-Identifier: AGPL-3.0-or-later
// The cut that makes a piece symmetric: another cut of the same piece, the mirror image of one
// it has (so "cut twice, one mirrored", file-format.md, Pieces and cuts). It shares the piece's
// outline, so editing the piece changes both; it takes the source cut's fabric and look, and
// sits beside it in the flat view. Where it goes on the body is the caller's to say.

import type { Cut, Piece, Placement } from "@/format/schema.gen";
import { outlineBox } from "@/pattern/draw";

/** The gap between a cut and its copy in the flat view, mm (a new pair's, in `newPiece`). */
const GAP = 80;

export function mirrorCut(
  piece: Piece,
  source: Cut,
  o: {
    id: string;
    placement: Placement;
    /** `unplaced`: waits under "Not placed" until the person puts it on the body. */
    state?: "unplaced";
  },
): Cut {
  const mirrored = !source.mirrored;
  let layout: Cut["layout"];
  if (source.layout?.position) {
    // A cut's box in its frame: an unmirrored one extends right of its position, a mirrored one left.
    const w = outlineBox(piece.outline).maxX;
    const [x, y] = source.layout.position;
    layout = { position: [source.mirrored ? x + GAP : x + 2 * w + GAP, y] };
  }
  return {
    id: o.id,
    ...(mirrored ? { mirrored: true } : {}),
    ...(source.fabric ? { fabric: source.fabric } : {}),
    ...(source.appearance ? { appearance: source.appearance } : {}),
    placement: o.placement,
    ...(o.state ? { state: o.state } : {}),
    ...(layout ? { layout } : {}),
  };
}
