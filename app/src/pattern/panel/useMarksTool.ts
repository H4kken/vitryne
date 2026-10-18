// SPDX-License-Identifier: AGPL-3.0-or-later
// The marks tool: internal lines (drawn like the pen, inside one piece, snapping to its own
// points), notches (a click on the outline), folds (two outline points) and the grain line (a
// drag); a click on a line, fold or grain line picks it to delete or reset. Its keys: Escape
// drops what is half done, Enter finishes a line, Delete takes a line's last point back or
// removes the pick. Another tool, kind or garment drops what was half done.

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  addFold,
  addLine,
  type Command,
  insertNode,
  removeFold,
  removeLine,
  setGrain,
  setNodeType,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import { foldProblem, leavesPiece } from "../edit";
import { type MarkKind } from "../MarkBar";
import { type PenPoint, penLine, snapPoint, snapStep } from "../draw";
import { type CutView, linePoints, distToPolyline, type P } from "../geometry";
import type { Drag, MarkPick } from "./types";
import { EDGE_PICK_PX, NODE_PICK_PX } from "./constants";
import { toPiece } from "./toPiece";
import type { usePointTool } from "./usePointTool";

export function useMarksTool(o: {
  /** The marks tool is on. */
  marking: boolean;
  garmentId: string | undefined;
  cuts: CutView[];
  mmPerPx: number;
  toPattern: (e: { clientX: number; clientY: number }) => P;
  edit: (build: (e: Entities, garmentId: string) => Command) => void;
  /** The drag the pointer started. */
  dragRef: RefObject<Drag | null>;
  pointHit: ReturnType<typeof usePointTool>["pointHit"];
  hitCut: (p: P) => CutView | null;
}) {
  const {
    marking,
    garmentId,
    cuts,
    mmPerPx,
    toPattern,
    edit,
    dragRef,
    pointHit,
    hitCut,
  } = o;
  const [markKind, setMarkKind] = useState<MarkKind>("line");
  const [markPick, setMarkPick] = useState<MarkPick>(null);
  /** A line being drawn on one cut's piece (points in the piece frame). */
  const [lineDraft, setLineDraft] = useState<{
    cutId: string;
    points: PenPoint[];
    cursor: P | null;
    handle: P | null;
  } | null>(null);
  /** A fold's first end, and where the pointer is (view). */
  const [foldFrom, setFoldFrom] = useState<{
    cutId: string;
    nodeId: string;
    cursor: P | null;
  } | null>(null);
  const [grainLive, setGrainLive] = useState<{
    cutId: string;
    from: P;
    to: P;
  } | null>(null);
  const [markWarning, setMarkWarning] = useState<string | null>(null);
  // Another tool, kind or garment: whatever was half done is dropped.
  const markKey = `${marking}:${markKind}:${garmentId}`;
  const [markFor, setMarkFor] = useState(markKey);
  if (markFor !== markKey) {
    setMarkFor(markKey);
    setLineDraft(null);
    setFoldFrom(null);
    setGrainLive(null);
    setMarkPick(null);
    setMarkWarning(null);
  }
  const lineCut = lineDraft
    ? cuts.find((v) => v.cut.id === lineDraft.cutId)
    : undefined;
  const markPicked =
    marking && markPick
      ? (() => {
          const v = cuts.find((x) => x.cut.id === markPick.cutId);
          if (!v) return null;
          const there =
            markPick.kind === "grain"
              ? !!v.piece.grain
              : markPick.kind === "line"
                ? v.piece.lines?.some((l) => l.id === markPick.id)
                : v.piece.folds?.some((f) => f.id === markPick.id);
          return there ? markPick : null;
        })()
      : null;

  /** Where a line's point or the grain line's end goes on cut `v` (piece frame), snapped to that piece only. */
  const markAt = (
    v: CutView,
    e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean },
    from?: P,
  ): P => {
    const raw = toPiece(v, toPattern(e));
    const own = [
      ...v.piece.outline.map((n) => n.position),
      ...(lineDraft?.cutId === v.cut.id
        ? lineDraft.points.map((x) => x.at)
        : []),
    ];
    return snapPoint(raw, {
      step: e.altKey ? 0 : snapStep(mmPerPx),
      near: e.altKey ? 0 : NODE_PICK_PX * mmPerPx,
      own: e.altKey ? [] : own,
      from: e.shiftKey ? from : undefined,
    });
  };

  /** The line, fold or grain line under the pointer, topmost cut first. */
  const markHit = (p: P): MarkPick => {
    const near = EDGE_PICK_PX * mmPerPx;
    for (const v of [...cuts].reverse()) {
      const q = toPiece(v, p);
      const base = { pieceId: v.piece.id, cutId: v.cut.id };
      for (const l of v.piece.lines ?? [])
        if (distToPolyline(q, linePoints(l)) <= near)
          return { ...base, kind: "line", id: l.id };
      const at = (id: string) =>
        v.piece.outline.find((n) => n.id === id)?.position;
      for (const f of v.piece.folds ?? []) {
        const a = at(f.from);
        const b = at(f.to);
        if (a && b && distToPolyline(q, [a, b]) <= near)
          return { ...base, kind: "fold", id: f.id };
      }
      const g = v.piece.grain;
      if (g && distToPolyline(q, [g.from, g.to]) <= near)
        return { ...base, kind: "grain", id: "" };
    }
    return null;
  };

  /** Why the line being drawn (with the pointer's point, if any) can't be kept, or null. */
  const lineProblem = (v: CutView, pts: readonly PenPoint[]): string | null =>
    pts.length >= 2 &&
    leavesPiece(v.piece.outline, linePoints(penLine(pts, () => "")))
      ? "a line must stay inside the piece"
      : null;

  const finishLine = () => {
    const d = lineDraft;
    const v = lineCut;
    if (!d || !v) return;
    if (d.points.length < 2) {
      setMarkWarning("A line needs at least two points");
      return;
    }
    const why = lineProblem(v, d.points);
    if (why) {
      setMarkWarning(`Can't keep this line: ${why}`);
      return;
    }
    const line = penLine(d.points, () => crypto.randomUUID());
    const pieceId = v.piece.id;
    edit((e, g) => addLine(e, g, pieceId, line));
    setLineDraft(null);
    setMarkWarning(null);
  };

  const removeMark = () => {
    const m = markPicked;
    if (!m) return;
    if (m.kind === "line") edit((e, g) => removeLine(e, g, m.pieceId, m.id));
    else if (m.kind === "fold")
      edit((e, g) => removeFold(e, g, m.pieceId, m.id));
    else edit((e, g) => setGrain(e, g, m.pieceId, undefined));
    setMarkPick(null);
  };

  const markKeys = useRef({ finishLine, removeMark });
  useEffect(() => {
    markKeys.current = { finishLine, removeMark };
  });
  useEffect(() => {
    if (!marking) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      if (e.key === "Escape") {
        setLineDraft(null);
        setFoldFrom(null);
        setMarkPick(null);
        setMarkWarning(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        markKeys.current.finishLine();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        let drafting = false;
        setLineDraft((d) => {
          drafting = !!d;
          return d ? { ...d, points: d.points.slice(0, -1) } : d;
        });
        if (!drafting) markKeys.current.removeMark();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [marking]);

  /** The marks tool's pointer down; true if it took it. */
  const markDown = (e: React.PointerEvent<HTMLDivElement>, p: P): boolean => {
    setMarkWarning(null);
    if (lineDraft) {
      if (!lineCut) return false;
      dragRef.current = {
        kind: "line",
        cut: lineCut,
        at: markAt(lineCut, e, lineDraft.points.at(-1)?.at),
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
      return true;
    }
    if (markKind === "notch" || markKind === "fold") {
      const hit = pointHit(p);
      const node = hit?.v.piece.outline[hit.k];
      if (hit && node && markKind === "notch") {
        const pieceId = hit.v.piece.id;
        if (hit.kind === "node") {
          if (node.type !== "notch")
            edit((x, g) => setNodeType(x, g, pieceId, node.id, "notch"));
        } else {
          const at = toPiece(hit.v, p);
          edit((x, g) =>
            insertNode(
              x,
              g,
              pieceId,
              node.id,
              [at[0], at[1]],
              crypto.randomUUID(),
              "notch",
            ),
          );
        }
        return true;
      }
      if (hit?.kind === "node" && node) {
        const from = foldFrom
          ? cuts.find((v) => v.cut.id === foldFrom.cutId)
          : undefined;
        if (!foldFrom || !from || from.piece.id !== hit.v.piece.id) {
          setFoldFrom({ cutId: hit.v.cut.id, nodeId: node.id, cursor: p });
          return true;
        }
        if (foldFrom.nodeId === node.id) {
          setFoldFrom(null);
          return true;
        }
        const why = foldProblem(hit.v.piece.outline, foldFrom.nodeId, node.id);
        if (why) {
          setMarkWarning(`Can't fold there: ${why}`);
          return true;
        }
        const fold = {
          id: crypto.randomUUID(),
          from: foldFrom.nodeId,
          to: node.id,
        };
        const pieceId = hit.v.piece.id;
        edit((x, g) => addFold(x, g, pieceId, fold));
        setFoldFrom(null);
        return true;
      }
    }
    const m = markHit(p);
    if (m) {
      setMarkPick(m);
      return true;
    }
    setMarkPick(null);
    const v = hitCut(p);
    if (!v) return false;
    if (markKind === "line") {
      const at = markAt(v, e);
      setLineDraft({ cutId: v.cut.id, points: [], cursor: at, handle: null });
      dragRef.current = {
        kind: "line",
        cut: v,
        at,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
      return true;
    }
    if (markKind === "grain") {
      const from = markAt(v, e);
      dragRef.current = { kind: "grain", cut: v, from };
      setGrainLive({ cutId: v.cut.id, from, to: from });
      return true;
    }
    return false;
  };
  return {
    markKind,
    setMarkKind,
    setMarkPick,
    lineDraft,
    setLineDraft,
    foldFrom,
    setFoldFrom,
    grainLive,
    setGrainLive,
    markWarning,
    lineCut,
    markPicked,
    markAt,
    lineProblem,
    finishLine,
    removeMark,
    markDown,
  };
}
