// SPDX-License-Identifier: AGPL-3.0-or-later
// Where each cut is drawn: its layout, or laid out automatically (kept while outlines are
// edited and drawn pieces come or go), with an outline being dragged and cuts being moved shown
// as the pointer has them.

import { useMemo, useState } from "react";
import type { Garment, OutlineNode, Piece } from "@/format/schema.gen";
import { apply, bounds, layoutCuts, type Transform } from "../geometry";

export function useCutLayout(o: {
  garment: Garment | undefined;
  /** An outline being dragged. */
  shape: { pieceId: string; outline: OutlineNode[] } | null;
  /** Cuts being dragged or turned. */
  live: ReadonlyMap<string, Transform> | null;
}) {
  const { garment, shape, live } = o;
  const shown = useMemo(
    () =>
      garment && shape
        ? {
            ...garment,
            pieces: garment.pieces.map((p) =>
              p.id === shape.pieceId
                ? { ...p, outline: shape.outline as Piece["outline"] }
                : p,
            ),
          }
        : garment,
    [garment, shape],
  );
  // Cuts without a layout stay where they were first put while outlines are edited and cuts
  // with a layout (a drawn piece) come or go; laid out again when one without a layout comes.
  const unplaced = (garment?.pieces ?? []).flatMap((p) =>
    p.cuts.filter((c) => !c.layout?.position).map((c) => c.id),
  );
  const [autos, setAutos] = useState<{
    garment: string | undefined;
    t: ReadonlyMap<string, Transform>;
  } | null>(null);
  const kept =
    autos?.garment === garment?.id && unplaced.every((id) => autos?.t.has(id));
  const keep = kept ? autos?.t : undefined;
  const layout = useMemo(
    () => layoutCuts(shown, undefined, keep),
    [shown, keep],
  );
  if (!kept)
    setAutos({
      garment: garment?.id,
      t: new Map(
        layout.cuts
          .filter((v) => !v.cut.layout?.position)
          .map((v) => [v.cut.id, v.t]),
      ),
    });
  const cuts = layout.cuts.map((v) => {
    const t = live?.get(v.cut.id);
    if (!t) return v;
    return { ...v, t, box: bounds(v.pts.map((p) => apply(t, p))) };
  });
  return { layout, cuts };
}
