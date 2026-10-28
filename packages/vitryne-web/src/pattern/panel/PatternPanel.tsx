// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat pieces view: every cut of the garment (a mirrored one drawn mirrored) with its
// folds, grain line, notches and internal lines, where its layout puts it. Wheel zooms around
// the cursor, dragging empty space pans (with the select tool: Space-drag or the middle button).
// Cmd (Ctrl) held: dragging pans, whatever the tool. The select tool picks a cut (Shift adds or
// takes one out) or every cut a box dragged out touches, drags cuts (a group of picked cuts
// together), and turns a lone pick by its round handle; the shape tool drags out a ready shape (a click: its starting size); the
// sew tool picks whole edges to sew (two clicks, edge
// then edge: nothing is measured or shown while picking, docs/PATENTS.md). Sewn edges are drawn
// in a colour per seam. The point tool edits a piece's outline: drag a point or a curve's
// handle, double-click an edge to add a point, Delete removes one; a drag that would make the
// outline cross itself shows red and is dropped, so Rust never has to refuse it. The pen tool
// draws a new piece: click for a straight edge, drag for a curve, close on the first point (or
// Enter); it snaps to the grid, 15° steps and the drawn piece's own points only. The marks
// tool adds internal lines (drawn like the pen, inside one piece, snapping to that piece's own
// points), notches (a click on the outline), folds (two outline points) and the grain line (a
// drag); a click on a line, fold or grain line picks it to delete or reset. Where a cut sits
// here is display only (`cut.layout`).

import {
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Garment, OutlineNode, Vec2 } from "@/format/schema.gen";
import { type Command } from "@/document/commands";
import type { Entities } from "@/document/entities";
import { type ShapeKind } from "../draw";
import { type P, type Transform } from "../geometry";
import type { FlatTool, SewingState, PatternView, Drag } from "./types";
import { NODE_PX } from "./constants";
import { Grid } from "./Grid";
import { PenMarks } from "./PenMarks";
import { ScaleBar } from "./ScaleBar";
import type { Selection } from "@/pattern/panel/types";
import { cutLabel } from "./cutLabel";
import { CutGroup } from "./CutGroup";
import { MarkToolBar } from "./MarkToolBar";
import { usePanelPointer } from "./usePanelPointer";
import { PenDrawBar } from "./PenDrawBar";
import { PointToolBar } from "./PointToolBar";
import { ShapePreview } from "./ShapePreview";
import { TurnHandle } from "./TurnHandle";
import { useCutLayout } from "./useCutLayout";
import { useMarksTool } from "./useMarksTool";
import { usePanelSelection } from "./usePanelSelection";
import { usePanelView } from "./usePanelView";
import { usePen } from "./usePen";
import { usePointTool } from "./usePointTool";
import { useShapeTool } from "./useShapeTool";
import { useSpaceHeld } from "./useSpaceHeld";

export function PatternPanel({
  garment,
  selection,
  onSelect,
  tool,
  panning = false,
  onArrange,
  sewing,
  cutColors,
  highlight = null,
  highlightSeam = null,
  empty,
  onEdit,
  onDrawn,
  shapeKind = "rectangle",
  onShape,
  ref,
}: {
  garment: Garment | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: FlatTool;
  /**
   * Cmd (Ctrl) held: dragging pans the view, whatever the tool (a piece or line half drawn is
   * kept).
   */
  panning?: boolean;
  /** Cuts moved or turned: their new layouts, by cut id (one edit per drag). */
  onArrange: (t: ReadonlyMap<string, Transform>) => void;
  /** For the sew tool: the whole edges to pick from. */
  sewing?: SewingState;
  /** Each coloured cut's colour (#rrggbb), by cut id. */
  cutColors?: ReadonlyMap<string, string>;
  /** A cut picked out (hovered in the pieces list): outlined, the others faded. */
  highlight?: string | null;
  /** A seam picked out (hovered or open in the seams list): drawn wider, the others faded. */
  highlightSeam?: string | null;
  /** Shown over the view while the garment has no pieces. */
  empty?: ReactNode;
  /** The point tool's edits: a command, built on the current document. */
  onEdit?: (build: (e: Entities) => Command) => void;
  /** The pen closed a piece: its outline (own frame) and where that frame's origin is drawn. */
  onDrawn?: (outline: OutlineNode[], origin: Vec2) => void;
  /** The shape tool's shape. */
  shapeKind?: ShapeKind;
  /** The shape tool put a shape down: its outline (own frame) and where that origin is drawn. */
  onShape?: (outline: OutlineNode[], origin: Vec2) => void;
  ref?: Ref<PatternView>;
}) {
  /** An outline being dragged, drawn as the pointer has it until the edit lands. */
  const [shape, setShape] = useState<{
    pieceId: string;
    outline: OutlineNode[];
    problem: string | null;
  } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** Cuts being dragged or turned, drawn where the pointer has them until the edit lands. */
  const [live, setLive] = useState<ReadonlyMap<string, Transform> | null>(null);
  /** The select tool's box being dragged out, and the shape tool's shape (pattern mm). */
  const [box, setBox] = useState<{ from: P; to: P } | null>(null);
  const { layout, cuts } = useCutLayout({ garment, shape, live });
  const host = useRef<HTMLDivElement>(null);
  const garmentId = garment?.id;
  const view = usePanelView({ host, garmentId, layoutBox: layout.box });
  const { vb, mmPerPx, toPattern, zoomAt, setView } = view;

  useImperativeHandle(ref, () => ({
    zoom: (factor: number) => zoomAt(1 / factor),
    reset: () => setView(null),
    views: (ids: readonly string[]) =>
      cuts.filter((v) => ids.includes(v.cut.id)),
    freeSpot: (): Vec2 =>
      layout.cuts.length
        ? [Math.round(layout.box.maxX + 80), Math.round(layout.box.minY)]
        : [0, 0],
  }));

  // The turn handle, above the selection's top middle (pattern coordinates, y up); none
  // while editing points.
  const points = tool === "points" && !!onEdit;
  const sel = usePanelSelection({
    cuts,
    selection,
    onSelect,
    tool,
    points,
    mmPerPx,
    sewing,
  });
  const edit = (build: (e: Entities, garmentId: string) => Command) => {
    if (garmentId && onEdit) onEdit((e) => build(e, garmentId));
  };
  const point = usePointTool({ cuts, points, mmPerPx, edit });
  const { picked, handles } = point;

  // ---- the pen ----
  const drawing = tool === "draw" && !!onDrawn;
  const penTool = usePen({ drawing, garmentId, mmPerPx, toPattern, onDrawn });
  const { pen, liveEdge, liveEnd, isFirst } = penTool;
  const spaceDownRef = useSpaceHeld();

  // ---- the shape tool ----
  const shapes = useShapeTool({
    shapeKind,
    mmPerPx,
    box: tool === "shape" ? box : null,
  });
  const { shapePreview } = shapes;

  // ---- the marks tool: internal lines, notches, folds, the grain line ----
  const marking = tool === "marks" && !!onEdit;
  const marks = useMarksTool({
    marking,
    garmentId,
    cuts,
    mmPerPx,
    toPattern,
    edit,
    dragRef,
    pointHit: point.pointHit,
    hitCut: sel.hitCut,
  });

  const { group, inGroup, handle, selected } = sel;
  const pointer = usePanelPointer({
    tool,
    panning,
    drawing,
    marking,
    points,
    view,
    selection: sel,
    point,
    penTool,
    shapes,
    marks,
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
  });

  return (
    <div
      ref={host}
      className={`flat-grid relative h-full w-full touch-none overflow-hidden ${panning ? "cursor-grab" : tool === "sew" || tool === "shape" || drawing ? "cursor-crosshair" : "cursor-default"}`}
      {...pointer}
      onPointerMove={(e) => {
        pointer.onPointerMove(e);
        if (tool === "sew" && sewing && !dragRef.current) {
          const hit = sel.edgeHit(toPattern(e));
          const was = sewing.hovered;
          if (
            hit?.cut !== was?.cut ||
            hit?.from !== was?.from ||
            hit?.to !== was?.to
          )
            sewing.onHover(hit);
        }
      }}
      onPointerLeave={(e) => {
        pointer.onPointerLeave();
        void e;
        if (sewing?.hovered) sewing.onHover(null);
      }}
    >
      <svg
        className={garment ? "block h-full w-full" : "hidden"}
        viewBox={`${vb.minX} ${vb.minY} ${vb.maxX - vb.minX} ${vb.maxY - vb.minY}`}
        role="img"
        aria-label={`Flat pattern pieces: ${cuts.map(cutLabel).join(", ")}`}
      >
        <defs>
          <marker
            id="grain-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 L9 5 L1 9"
              fill="none"
              stroke="var(--line)"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <Grid box={vb} mmPerPx={mmPerPx} />
        {cuts.map((v) => (
          <CutGroup
            key={v.cut.id}
            v={v}
            garment={garment}
            tool={tool}
            inGroup={inGroup}
            highlight={highlight}
            highlightSeam={highlightSeam}
            cutColors={cutColors}
            shape={shape}
            sewing={sewing}
            marking={marking}
            marks={marks}
            points={points}
            picked={picked}
            handles={handles}
            mmPerPx={mmPerPx}
          />
        ))}
        {drawing && (
          <PenMarks
            points={pen.points}
            live={liveEdge}
            end={
              liveEnd ??
              (pen.cursor
                ? { at: pen.cursor, ...(pen.handle ? { out: pen.handle } : {}) }
                : null)
            }
            closable={!!pen.cursor && isFirst(pen.cursor)}
            bad={!!pen.problem}
            r={NODE_PX * mmPerPx}
          />
        )}
        {/* Several cuts picked: a dashed box round each. */}
        {group.length > 1 &&
          (tool === "select" || tool === "sew") &&
          group.map((v) => (
            <rect
              key={v.cut.id}
              x={v.box.minX - 12}
              y={-v.box.maxY - 12}
              width={v.box.maxX - v.box.minX + 24}
              height={v.box.maxY - v.box.minY + 24}
              fill="none"
              stroke="var(--select)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
        {/* The select tool's box being dragged out. */}
        {box && tool !== "shape" && (
          <rect
            x={Math.min(box.from[0], box.to[0])}
            y={-Math.max(box.from[1], box.to[1])}
            width={Math.abs(box.to[0] - box.from[0])}
            height={Math.abs(box.to[1] - box.from[1])}
            fill="var(--select)"
            fillOpacity={0.08}
            stroke="var(--select)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* The shape being dragged out, with its sizes. */}
        {shapePreview && (
          <ShapePreview
            shapePreview={shapePreview}
            shapeKind={shapeKind}
            mmPerPx={mmPerPx}
          />
        )}
        {selected && handle && (
          <TurnHandle selected={selected} handle={handle} mmPerPx={mmPerPx} />
        )}
      </svg>
      {garment && <ScaleBar mmPerPx={mmPerPx} />}
      {garment && !layout.cuts.length && !drawing && tool !== "shape" && empty}
      {drawing && garment && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <PenDrawBar penTool={penTool} />
        </div>
      )}
      {marking && garment && layout.cuts.length > 0 && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <MarkToolBar marks={marks} />
        </div>
      )}
      {points && garment && layout.cuts.length > 0 && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <PointToolBar
            picked={picked}
            shape={shape}
            edit={edit}
            removePicked={point.removePicked}
            insertAt={point.insertAt}
          />
        </div>
      )}
    </div>
  );
}
