// SPDX-License-Identifier: AGPL-3.0-or-later
// What the 3D view does besides draping: placing pieces (the Select tool in 3D; the cloth waits
// where it starts), the seams drawn on the cloth while sewing in the flat view, a click picking
// a cut of the drape shown, and the selected cut's handles.

import { useEffect } from "react";
import { findCut } from "@/document/commands";
import type { Garment } from "@/format/schema.gen";

import type { PointerTool } from "@/worker/protocol";
import type { EngineSession, EngineState } from "@/worker/session";
import type { Selection } from "@/pattern/panel/types";

export function useDrapeControls(o: {
  session: EngineSession;
  engine: EngineState;
  garment: Garment | undefined;
  /** The 3D view shows and its tool is `tool`, with a document open. */
  show3d: boolean;
  tool: PointerTool;
  empty: boolean;
  /** The flat view shows the sew tool. */
  sewing: boolean;
  selection: Selection;
  select: (s: Selection) => void;
}) {
  const { session, engine, garment, selection, select } = o;
  // Placing pieces: the Select tool in 3D. The cloth waits where it starts.
  const placing = o.show3d && o.tool === "select" && !o.empty;
  useEffect(() => {
    if (session.state.controls.placing !== placing)
      session.setControls({ placing });
  }, [placing, session]);

  // All the seams are drawn on the cloth while sewing in the flat view.
  const showSeams = o.sewing;
  useEffect(() => {
    if (session.state.controls.seams !== showSeams)
      session.setControls({ seams: showSeams });
  }, [showSeams, session]);

  // A click with Select in 3D picks a cut of the drape shown.
  const drapeCuts = engine.drape?.info.cuts;
  useEffect(
    () =>
      session.onPicked((i) => {
        const id = i >= 0 ? drapeCuts?.[i] : undefined;
        const f = id && garment ? findCut(garment, id) : undefined;
        select(
          f ? { kind: "cut", pieceId: f.piece.id, cutId: f.cut.id } : null,
        );
      }),
    [session, drapeCuts, garment, select],
  );

  // The selected cut's handles, while placing (and while it is in the drape shown).
  const gizmoIndex =
    placing && selection ? (drapeCuts?.indexOf(selection.cutId) ?? -1) : -1;
  useEffect(() => {
    session.showGizmo(gizmoIndex >= 0 ? gizmoIndex : null);
  }, [session, gizmoIndex]);

  return { placing, gizmoIndex };
}
