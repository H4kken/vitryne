// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat view's pointer: what a press, a drag and a release do with each tool (pan, the pen,
// the marks and point tools, turning, sewing, the shape tool, picking and moving cuts, the select
// box), and a double click (finish a line, add a point, or frame the pieces again). A drag lives
// in `dragRef` from the press to the release. A hook only so that it may take refs: it holds no
// state of its own.

import type { OutlineNode, Vec2 } from "@/format/schema.gen";
import {
  type Command,
  moveNodes as moveNodesCommand,
  setEdge,
  setGrain,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import { moveNodes, outlineProblem, withControl } from "../edit";
import { type ShapeKind, shapeOutline } from "../draw";
import {
  apply,
  bounds,
  type CutView,
  type P,
  roundMm,
  touchesBox,
  type Transform,
  unapply,
} from "../geometry";
import type { FlatTool, SewingState, Drag } from "./types";
import { HANDLE_R_PX, SNAP_DEG } from "./constants";
import { toPiece } from "./toPiece";
import type { RefObject } from "react";
import type { useMarksTool } from "./useMarksTool";
import type { usePanelSelection } from "./usePanelSelection";
import type { usePanelView } from "./usePanelView";
import type { usePen } from "./usePen";
import type { usePointTool } from "./usePointTool";
import type { useShapeTool } from "./useShapeTool";

export function usePanelPointer(c: {
  tool: FlatTool;
  /** Cmd (Ctrl) held: dragging pans. */
  panning: boolean;
  drawing: boolean;
  marking: boolean;
  points: boolean;
  view: ReturnType<typeof usePanelView>;
  selection: ReturnType<typeof usePanelSelection>;
  point: ReturnType<typeof usePointTool>;
  penTool: ReturnType<typeof usePen>;
  shapes: ReturnType<typeof useShapeTool>;
  marks: ReturnType<typeof useMarksTool>;
  cuts: CutView[];
  dragRef: RefObject<Drag | null>;
  spaceDownRef: RefObject<boolean>;
  box: { from: P; to: P } | null;
  setBox: (b: { from: P; to: P } | null) => void;
  shape: {
    pieceId: string;
    outline: OutlineNode[];
    problem: string | null;
  } | null;
  setShape: (
    s: {
      pieceId: string;
      outline: OutlineNode[];
      problem: string | null;
    } | null,
  ) => void;
  live: ReadonlyMap<string, Transform> | null;
  setLive: (t: ReadonlyMap<string, Transform> | null) => void;
  sewing: SewingState | undefined;
  shapeKind: ShapeKind;
  onShape: ((outline: OutlineNode[], origin: Vec2) => void) | undefined;
  onArrange: (t: ReadonlyMap<string, Transform>) => void;
  edit: (build: (e: Entities, garmentId: string) => Command) => void;
}) {
  const {
    tool,
    panning,
    drawing,
    marking,
    points,
    cuts,
    dragRef,
    spaceDownRef,
    box,
    setBox,
    shape,
    setShape,
    live,
    setLive,
    sewing,
    shapeKind,
    onShape,
    onArrange,
    edit,
  } = c;
  const { toPattern, freeze, setView, vb, mmPerPx } = c.view;
  const {
    selected,
    handle,
    edgeHit,
    hitCut,
    inGroup,
    group,
    select,
    selectAll,
  } = c.selection;
  const { pointHit, pickAt, setPick, insertAt } = c.point;
  const { pen, setPen, penAt, isFirst, closePen } = c.penTool;
  const { shapeAt, setEven, shapeDrop } = c.shapes;
  const {
    markDown,
    lineDraft,
    setLineDraft,
    lineCut,
    markAt,
    foldFrom,
    setFoldFrom,
    grainLive,
    setGrainLive,
    finishLine,
  } = c.marks;
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      // On a bar or hint over the view: its own buttons take it (capturing the pointer
      // here would send their clicks to the view).
      if (e.target !== e.currentTarget && !(e.target instanceof SVGElement))
        return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag just stops at the panel's edge.
      }
      const p = toPattern(e);
      // A right click picks the cut under it (or none) for the menu, and starts no drag.
      if (e.button === 2) {
        const hit = hitCut(p);
        if (!hit) selectAll([]);
        else if (!inGroup.has(hit.cut.id)) selectAll([hit]);
        return;
      }
      if (panning) {
        freeze();
        dragRef.current = {
          kind: "pan",
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        return;
      }
      if (drawing && e.button === 0 && !spaceDownRef.current) {
        const at = penAt(e);
        dragRef.current = {
          kind: "pen",
          at,
          closing: isFirst(at),
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        setPen((x) => ({ ...x, cursor: at, handle: null, problem: null }));
        return;
      }
      if (marking && e.button === 0 && markDown(e, p)) return;
      if (points) {
        const hit = pointHit(p);
        const nodes = hit?.v.piece.outline;
        const node = nodes?.[hit?.k ?? -1];
        if (hit && nodes && node) {
          if (hit.kind === "edge") {
            pickAt("edge", hit.v, node.id);
            return;
          }
          freeze();
          const common = { cut: hit.v, nodes, start: p, moved: false };
          if (hit.kind === "node") {
            pickAt("node", hit.v, node.id);
            dragRef.current = {
              ...common,
              kind: "node",
              k: hit.k,
              from: node.position,
              to: node.position,
            };
          } else if (hit.kind === "control" && node.edge.type === "cubic") {
            const c = node.edge.controls[hit.which];
            dragRef.current = {
              ...common,
              kind: "control",
              k: hit.k,
              which: hit.which,
              from: c,
              to: c,
            };
          }
          return;
        }
      }
      if (
        selected &&
        handle &&
        Math.hypot(p[0] - handle[0], p[1] - handle[1]) <=
          (HANDLE_R_PX + 4) * mmPerPx
      ) {
        const centre: P = [
          (selected.box.minX + selected.box.maxX) / 2,
          (selected.box.minY + selected.box.maxY) / 2,
        ];
        freeze();
        dragRef.current = {
          kind: "turn",
          cut: selected,
          centre,
          local: unapply(selected.t, centre),
          from: Math.atan2(p[1] - centre[1], p[0] - centre[0]),
          t: selected.t,
        };
        return;
      }
      if (tool === "sew") {
        const edge = edgeHit(p);
        if (edge) {
          sewing?.onPick(edge, e.shiftKey);
          return;
        }
      }
      if (tool === "shape" && onShape && e.button === 0) {
        freeze();
        dragRef.current = {
          kind: "shape",
          from: shapeAt(p),
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        return;
      }
      const hit = hitCut(p);
      const selecting =
        tool === "select" && e.button === 0 && !spaceDownRef.current;
      if (selecting && hit) {
        freeze();
        // A picked cut takes the others picked with it; another is picked alone (with
        // Shift: added to them).
        const picked = inGroup.has(hit.cut.id);
        const cuts = picked ? group : e.shiftKey ? [...group, hit] : [hit];
        if (!picked) selectAll(cuts);
        dragRef.current = {
          kind: "move",
          cuts,
          start: p,
          moved: false,
          hit,
          shift: e.shiftKey,
          picked,
        };
        return;
      }
      if (selecting) {
        freeze();
        dragRef.current = {
          kind: "box",
          from: p,
          x: e.clientX,
          y: e.clientY,
          moved: false,
          add: e.shiftKey,
        };
        return;
      }
      dragRef.current = {
        kind: "pan",
        x: e.clientX,
        y: e.clientY,
        moved: false,
        hit,
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (drawing && (!d || d.kind === "pen")) {
        if (!d) {
          const at = penAt(e);
          if (pen.cursor?.[0] !== at[0] || pen.cursor?.[1] !== at[1])
            setPen((x) => ({ ...x, cursor: at }));
          return;
        }
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
          d.moved = true;
        if (d.moved) setPen((x) => ({ ...x, handle: toPattern(e) }));
        return;
      }
      if (marking && (!d || d.kind === "line" || d.kind === "grain")) {
        if (!d) {
          if (lineDraft && lineCut) {
            const at = markAt(lineCut, e, lineDraft.points.at(-1)?.at);
            if (
              lineDraft.cursor?.[0] !== at[0] ||
              lineDraft.cursor[1] !== at[1]
            )
              setLineDraft({ ...lineDraft, cursor: at });
          } else if (foldFrom)
            setFoldFrom({ ...foldFrom, cursor: toPattern(e) });
          return;
        }
        if (d.kind === "grain") {
          const to = markAt(d.cut, e, d.from);
          setGrainLive({ cutId: d.cut.cut.id, from: d.from, to });
          return;
        }
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
          d.moved = true;
        if (d.moved)
          setLineDraft((x) =>
            x ? { ...x, handle: toPiece(d.cut, toPattern(e)) } : x,
          );
        return;
      }
      if (!d || d.kind === "pen" || d.kind === "line" || d.kind === "grain")
        return;
      if (d.kind === "box" || d.kind === "shape") {
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
          d.moved = true;
        if (!d.moved) return;
        const p = toPattern(e);
        setBox({ from: d.from, to: d.kind === "shape" ? shapeAt(p) : p });
        setEven(e.shiftKey);
        return;
      }
      if (d.kind === "pan") {
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
          d.moved = true;
        if (!d.moved) return;
        const dx = (e.clientX - d.x) * mmPerPx;
        const dy = (e.clientY - d.y) * mmPerPx;
        d.x = e.clientX;
        d.y = e.clientY;
        setView({
          minX: vb.minX - dx,
          maxX: vb.maxX - dx,
          minY: vb.minY - dy,
          maxY: vb.maxY - dy,
        });
        return;
      }
      const p = toPattern(e);
      if (d.kind === "node" || d.kind === "control") {
        if (
          !d.moved &&
          Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 3 * mmPerPx
        )
          return;
        d.moved = true;
        let q = p;
        if (e.shiftKey) {
          // Shift: along 15° steps from where it started, as seen.
          const step = (SNAP_DEG * Math.PI) / 180;
          const len = Math.hypot(p[0] - d.start[0], p[1] - d.start[1]);
          const ang =
            Math.round(
              Math.atan2(p[1] - d.start[1], p[0] - d.start[0]) / step,
            ) * step;
          q = [
            d.start[0] + len * Math.cos(ang),
            d.start[1] + len * Math.sin(ang),
          ];
        }
        const a = toPiece(d.cut, d.start);
        const b = toPiece(d.cut, q);
        d.to = [d.from[0] + b[0] - a[0], d.from[1] + b[1] - a[1]];
        const id = d.nodes[d.k]?.id ?? "";
        const outline =
          d.kind === "node"
            ? moveNodes(d.nodes, new Map([[id, d.to]]))
            : withControl(d.nodes, d.k, d.which, d.to);
        setShape({
          pieceId: d.cut.piece.id,
          outline,
          problem: outlineProblem(outline),
        });
        return;
      }
      if (d.kind === "move") {
        d.moved = true;
        const [dx, dy] = [p[0] - d.start[0], p[1] - d.start[1]];
        setLive(
          new Map(
            d.cuts.map((v) => [
              v.cut.id,
              { ...v.t, x: v.t.x + dx, y: v.t.y + dy },
            ]),
          ),
        );
        return;
      }
      // Turn about the box's centre: that point of the cut stays put.
      let rot =
        d.t.rot + Math.atan2(p[1] - d.centre[1], p[0] - d.centre[0]) - d.from;
      if (e.shiftKey) {
        const step = (SNAP_DEG * Math.PI) / 180;
        rot = Math.round(rot / step) * step;
      }
      rot = Math.atan2(Math.sin(rot), Math.cos(rot));
      const [x, y] = apply({ x: 0, y: 0, rot }, d.local);
      setLive(
        new Map([
          [d.cut.cut.id, { x: d.centre[0] - x, y: d.centre[1] - y, rot }],
        ]),
      );
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.kind === "pen") {
        const out = d.moved ? toPattern(e) : undefined;
        if (d.closing) {
          const [first, ...rest] = pen.points;
          if (first) closePen([{ ...first, out: out ?? first.out }, ...rest]);
          return;
        }
        // A click on the last point again (a double click) puts nothing down.
        const last = pen.points.at(-1);
        if (!out && last && last.at[0] === d.at[0] && last.at[1] === d.at[1])
          return;
        setPen((x) => ({
          ...x,
          points: [...x.points, { at: d.at, ...(out ? { out } : {}) }],
          handle: null,
        }));
        return;
      }
      if (d.kind === "line") {
        const out = d.moved ? toPiece(d.cut, toPattern(e)) : undefined;
        const last = lineDraft?.points.at(-1);
        // A click on the last point again (a double click) puts nothing down.
        if (!out && last && last.at[0] === d.at[0] && last.at[1] === d.at[1])
          return;
        setLineDraft((x) =>
          x
            ? {
                ...x,
                points: [...x.points, { at: d.at, ...(out ? { out } : {}) }],
                handle: null,
              }
            : x,
        );
        return;
      }
      if (d.kind === "grain") {
        const g = grainLive;
        setGrainLive(null);
        if (!g || Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) < 1)
          return;
        const pieceId = d.cut.piece.id;
        const grain = {
          from: [roundMm(g.from[0]), roundMm(g.from[1])] as Vec2,
          to: [roundMm(g.to[0]), roundMm(g.to[1])] as Vec2,
        };
        edit((x, gid) => setGrain(x, gid, pieceId, grain));
        return;
      }
      if (d.kind === "pan") {
        if (!d.moved && d.hit !== undefined) {
          select(d.hit);
          setPick(null);
          setFoldFrom(null);
        }
        return;
      }
      if (d.kind === "box") {
        const b = box;
        setBox(null);
        // A click on empty space picks nothing (with Shift: keeps the pick).
        if (!d.moved || !b) {
          if (!d.add) select(null);
          return;
        }
        const area = bounds([b.from, b.to]);
        const hits = cuts.filter((v) =>
          touchesBox(
            v.pts.map((q) => apply(v.t, q)),
            area,
          ),
        );
        selectAll(
          d.add
            ? [...group, ...hits.filter((v) => !inGroup.has(v.cut.id))]
            : hits,
        );
        return;
      }
      if (d.kind === "shape") {
        setBox(null);
        const out = shapeDrop(
          d.from,
          d.moved ? shapeAt(toPattern(e)) : null,
          e.shiftKey,
        );
        if (out.problem) return;
        onShape?.(
          shapeOutline(shapeKind, out.size, () => crypto.randomUUID()),
          out.origin,
        );
        return;
      }
      if (d.kind === "node" || d.kind === "control") {
        const s = shape;
        setShape(null);
        const node = d.nodes[d.k];
        // A shape that can't be kept goes back: it never becomes a command.
        if (!d.moved || !s || s.problem || !node) return;
        const pieceId = d.cut.piece.id;
        const to = d.to;
        const edge = s.outline[d.k]?.edge;
        if (d.kind === "node")
          edit((e, g) =>
            moveNodesCommand(e, g, pieceId, { [node.id]: [to[0], to[1]] }),
          );
        else if (edge) edit((e, g) => setEdge(e, g, pieceId, node.id, edge));
        return;
      }
      if (d.kind === "move" && !d.moved) {
        setLive(null);
        if (!d.shift) select(d.hit);
        else if (d.picked) selectAll(group.filter((v) => v !== d.hit));
        return;
      }
      const ids =
        d.kind === "move" ? d.cuts.map((v) => v.cut.id) : [d.cut.cut.id];
      if (
        live &&
        ids.every((id) => live.has(id)) &&
        (d.kind === "turn" || d.moved)
      ) {
        const round = (x: number) => Math.round(x * 1000) / 1000;
        onArrange(
          new Map(
            ids.map((id) => {
              const t = live.get(id) as Transform;
              return [
                id,
                {
                  x: round(t.x),
                  y: round(t.y),
                  rot: Math.round(t.rot * 1e4) / 1e4,
                },
              ];
            }),
          ),
        );
      }
      setLive(null);
    },
    onPointerCancel: () => {
      dragRef.current = null;
      setLive(null);
      setBox(null);
      setShape(null);
      setPen((x) => ({ ...x, handle: null }));
      setGrainLive(null);
    },
    onPointerLeave: () =>
      drawing && !dragRef.current && setPen((x) => ({ ...x, cursor: null })),
    onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (drawing) return;
      if (marking) {
        if (lineDraft) finishLine();
        return;
      }
      if (points) {
        const p = toPattern(e);
        const hit = pointHit(p);
        if (hit?.kind === "edge") insertAt(hit.v, hit.k, toPiece(hit.v, p));
        if (hit) return;
      }
      setView(null);
    },
  };
}
