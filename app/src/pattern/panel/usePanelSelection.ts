// SPDX-License-Identifier: AGPL-3.0-or-later
// What the select tool works with: the cut under the pointer, the picked cuts (the selection
// first), the free whole edge under the pointer for the sew tool, and the turn handle above a
// lone pick.

import {
  type CutView,
  inside,
  distToPolyline,
  type P,
  runPoints,
  unapply,
} from "../geometry";
import { type CutEdge } from "@/sewing/api";
import type { FlatTool, SewingState } from "./types";
import { EDGE_PICK_PX, HANDLE_PX } from "./constants";
import type { Selection } from "@/pattern/panel/types";

export function usePanelSelection(o: {
  cuts: CutView[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: FlatTool;
  /** The point tool is on (no turn handle then). */
  points: boolean;
  mmPerPx: number;
  sewing: SewingState | undefined;
}) {
  const { cuts, selection, onSelect, tool, points, mmPerPx, sewing } = o;
  /** The free whole edge nearest to `p`, if the pointer is on one. */
  const edgeHit = (p: P): CutEdge | null => {
    if (!sewing) return null;
    let best: { e: CutEdge; d: number } | null = null;
    for (const v of cuts) {
      const q = unapply(v.t, p);
      const local: P = v.cut.mirrored ? [-q[0], q[1]] : q;
      for (const e of sewing.edges) {
        if (e.cut !== v.cut.id || e.sewn) continue;
        const d = distToPolyline(local, runPoints(v.piece, e.from, e.to, true));
        if (d <= EDGE_PICK_PX * mmPerPx && (!best || d < best.d))
          best = { e, d };
      }
    }
    return best?.e ?? null;
  };

  const hitCut = (p: P) =>
    [...cuts].reverse().find((v) => inside(unapply(v.t, p), v.pts)) ?? null;
  const selected = selection
    ? cuts.find((v) => v.cut.id === selection.cutId)
    : undefined;
  /** Every picked cut: the selection and those picked with it. */
  const inGroup = new Set(
    selection ? [selection.cutId, ...(selection.also ?? [])] : [],
  );
  // The selection first: it stays the one the properties show.
  const group = cuts
    .filter((v) => inGroup.has(v.cut.id))
    .sort((a, b) => +(b === selected) - +(a === selected));
  // The turn handle, above the selection's top middle (pattern coordinates, y up); none
  // while editing points.
  const handle: P | null =
    selected &&
    group.length === 1 &&
    !points &&
    tool !== "draw" &&
    tool !== "shape" &&
    tool !== "marks"
      ? [
          (selected.box.minX + selected.box.maxX) / 2,
          selected.box.maxY + HANDLE_PX * mmPerPx,
        ]
      : null;
  const select = (v: CutView | null) =>
    onSelect(v ? { kind: "cut", pieceId: v.piece.id, cutId: v.cut.id } : null);
  /** Picks `views`, the first being the one the properties show. */
  const selectAll = (views: readonly CutView[]) => {
    const [first, ...rest] = views;
    onSelect(
      first
        ? {
            kind: "cut",
            pieceId: first.piece.id,
            cutId: first.cut.id,
            ...(rest.length ? { also: rest.map((v) => v.cut.id) } : {}),
          }
        : null,
    );
  };
  return {
    edgeHit,
    hitCut,
    selected,
    inGroup,
    group,
    handle,
    select,
    selectAll,
  };
}
