// SPDX-License-Identifier: AGPL-3.0-or-later
// The pen: the points of the piece being drawn, where the next one would go (snapped to the
// grid, 15° steps and the piece's own points), closing it, the edge being drawn with its length
// and angle, and its keys (Escape drops the piece, Enter closes it, Delete takes the last point
// back). Another tool or garment drops the piece.

import { useEffect, useRef, useState } from "react";
import type { OutlineNode, Vec2 } from "@/format/schema.gen";
import {
  framed,
  type PenPoint,
  penOutline,
  penProblem,
  snapPoint,
  snapStep,
} from "../draw";
import { type P } from "../geometry";
import { NODE_PICK_PX } from "./constants";
import { penPath } from "./penPath";

export function usePen(o: {
  /** The pen is on. */
  drawing: boolean;
  garmentId: string | undefined;
  mmPerPx: number;
  toPattern: (e: { clientX: number; clientY: number }) => P;
  onDrawn: ((outline: OutlineNode[], origin: Vec2) => void) | undefined;
}) {
  const { drawing, garmentId, mmPerPx, toPattern, onDrawn } = o;
  const [pen, setPen] = useState<{
    points: PenPoint[];
    /** Where the next point would go (snapped), and its handle while it is dragged. */
    cursor: P | null;
    handle: P | null;
    problem: string | null;
  }>({ points: [], cursor: null, handle: null, problem: null });
  const penRef = useRef(pen);
  useEffect(() => {
    penRef.current = pen;
  });
  // Another tool, or another garment: the piece being drawn is dropped.
  const penKey = `${drawing}:${garmentId}`;
  const [penFor, setPenFor] = useState(penKey);
  if (penFor !== penKey) {
    setPenFor(penKey);
    setPen({ points: [], cursor: null, handle: null, problem: null });
  }
  /** Where the pen puts a point for this pointer event. */
  const penAt = (e: {
    clientX: number;
    clientY: number;
    shiftKey: boolean;
    altKey: boolean;
  }): P => {
    const raw = toPattern(e);
    const pts = pen.points.map((x) => x.at);
    return snapPoint(raw, {
      step: e.altKey ? 0 : snapStep(mmPerPx),
      near: e.altKey ? 0 : NODE_PICK_PX * mmPerPx,
      own: e.altKey ? [] : pts,
      from: e.shiftKey ? pts.at(-1) : undefined,
    });
  };
  const isFirst = (p: P) => {
    const first = pen.points[0];
    return (
      pen.points.length >= 3 &&
      !!first &&
      Math.hypot(p[0] - first.at[0], p[1] - first.at[1]) <= 1e-6
    );
  };
  /** The pen's piece closed: handed on if it can be a piece, else it says why. */
  const closePen = (points: PenPoint[]) => {
    const problem = penProblem(points);
    if (problem) {
      setPen((x) => ({ ...x, points, problem, handle: null }));
      return;
    }
    const { outline, origin } = framed(
      penOutline(points, () => crypto.randomUUID()),
    );
    setPen({ points: [], cursor: null, handle: null, problem: null });
    onDrawn?.(outline, origin);
  };
  const closeRef = useRef(closePen);
  useEffect(() => {
    closeRef.current = closePen;
  });
  useEffect(() => {
    if (!drawing) return;
    const down = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      const now = penRef.current;
      if (e.key === "Escape")
        setPen({ points: [], cursor: null, handle: null, problem: null });
      else if (e.key === "Enter" && now.points.length >= 3) {
        e.preventDefault();
        closeRef.current(now.points);
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        now.points.length
      ) {
        e.preventDefault();
        setPen((x) => ({ ...x, points: x.points.slice(0, -1), problem: null }));
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [drawing]);

  /** The edge being drawn: from the last point to the pointer (to the first one when closing). */
  const lastPen = pen.points.at(-1);
  const liveEnd: PenPoint | null =
    lastPen && pen.cursor
      ? {
          at: pen.cursor,
          out:
            pen.handle ??
            (isFirst(pen.cursor) ? pen.points[0]?.out : undefined),
        }
      : null;
  const liveEdge =
    lastPen && liveEnd ? penPath([lastPen, liveEnd], false) : null;
  let liveLength = 0;
  liveEdge?.forEach((q, i) => {
    const prev = liveEdge[i - 1];
    if (prev) liveLength += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
  });
  const liveAngle =
    lastPen && pen.cursor
      ? (Math.atan2(
          pen.cursor[1] - lastPen.at[1],
          pen.cursor[0] - lastPen.at[0],
        ) *
          180) /
          Math.PI || 0
      : 0;
  return {
    pen,
    setPen,
    penAt,
    isFirst,
    closePen,
    lastPen,
    liveEnd,
    liveEdge,
    liveLength,
    liveAngle,
  };
}
