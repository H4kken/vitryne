// SPDX-License-Identifier: AGPL-3.0-or-later
// The point tool: the picked point or edge (while its cut and node are still there), its
// curve handles, what is under the pointer, adding and removing points, and its keys (Escape
// unpicks, Delete removes the picked point).

import { useEffect, useRef, useState } from "react";
import { type Command, insertNode, removeNode } from "@/document/commands";
import type { Entities } from "@/document/entities";
import { edgePoints } from "../edit";
import { type CutView, distToPolyline, type P } from "../geometry";
import type { PointPick } from "./types";
import { EDGE_PICK_PX, NODE_PICK_PX } from "./constants";
import { pickHandles } from "./pickHandles";
import { toPiece } from "./toPiece";

export function usePointTool(o: {
  cuts: CutView[];
  /** The point tool is on. */
  points: boolean;
  mmPerPx: number;
  edit: (build: (e: Entities, garmentId: string) => Command) => void;
}) {
  const { cuts, points, mmPerPx, edit } = o;
  const [pick, setPick] = useState<PointPick>(null);
  const pickView =
    points && pick ? cuts.find((v) => v.cut.id === pick.cutId) : undefined;
  const pickK =
    pickView && pick
      ? pickView.piece.outline.findIndex((n) => n.id === pick.nodeId)
      : -1;
  const picked =
    pickView && pick && pickK >= 0
      ? { kind: pick.kind, k: pickK, v: pickView }
      : null;
  const handles = picked ? pickHandles(picked.v.piece.outline, picked) : [];
  const pickAt = (kind: "node" | "edge", v: CutView, nodeId: string) =>
    setPick({ kind, pieceId: v.piece.id, cutId: v.cut.id, nodeId });

  /** What the point tool has under the pointer: a handle of the pick, a node, or an edge. */
  const pointHit = (
    p: P,
  ):
    | { kind: "control"; v: CutView; k: number; which: 0 | 1 }
    | { kind: "node" | "edge"; v: CutView; k: number }
    | null => {
    const near = NODE_PICK_PX * mmPerPx;
    if (picked) {
      const q = toPiece(picked.v, p);
      for (const h of handles) {
        const n = picked.v.piece.outline[h.k];
        if (n?.edge.type !== "cubic") continue;
        const c = n.edge.controls[h.which];
        if (Math.hypot(q[0] - c[0], q[1] - c[1]) <= near)
          return { kind: "control", v: picked.v, k: h.k, which: h.which };
      }
    }
    // The topmost cut with a node near, then the topmost with an edge near.
    const top = [...cuts].reverse();
    for (const v of top) {
      const q = toPiece(v, p);
      let best: { k: number; d: number } | null = null;
      for (const [k, n] of v.piece.outline.entries()) {
        const d = Math.hypot(q[0] - n.position[0], q[1] - n.position[1]);
        if (d <= near && (!best || d < best.d)) best = { k, d };
      }
      if (best) return { kind: "node", v, k: best.k };
    }
    for (const v of top) {
      const q = toPiece(v, p);
      let best: { k: number; d: number } | null = null;
      for (const k of v.piece.outline.keys()) {
        const d = distToPolyline(q, edgePoints(v.piece.outline, k));
        if (d <= EDGE_PICK_PX * mmPerPx && (!best || d < best.d))
          best = { k, d };
      }
      if (best) return { kind: "edge", v, k: best.k };
    }
    return null;
  };

  /** A new point on the edge from node `k` of `v`'s piece, near `at` (piece frame), picked. */
  const insertAt = (v: CutView, k: number, at: P) => {
    const node = v.piece.outline[k];
    if (!node) return;
    const id = crypto.randomUUID();
    edit((e, g) => insertNode(e, g, v.piece.id, node.id, [at[0], at[1]], id));
    pickAt("node", v, id);
  };

  const removePicked = () => {
    const node = picked?.v.piece.outline[picked.k];
    if (!picked || picked.kind !== "node" || !node) return;
    const pieceId = picked.v.piece.id;
    edit((e, g) => removeNode(e, g, pieceId, node.id));
    setPick(null);
  };
  const removeRef = useRef(removePicked);
  useEffect(() => {
    removeRef.current = removePicked;
  });
  useEffect(() => {
    if (!points) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      if (e.key === "Escape") setPick(null);
      else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [points]);
  return {
    pick,
    setPick,
    picked,
    handles,
    pickAt,
    pointHit,
    insertAt,
    removePicked,
  };
}
