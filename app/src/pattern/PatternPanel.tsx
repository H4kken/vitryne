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
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Garment, OutlineNode, Piece, Vec2 } from "@/format/schema.gen";
import {
  addFold,
  addLine,
  type Command,
  insertNode,
  moveNodes as moveNodesCommand,
  removeFold,
  removeLine,
  removeNode,
  setEdge,
  setGrain,
  setNodeType,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import {
  curvedEdge,
  edgeLength,
  edgePoints,
  endForLength,
  foldProblem,
  isStraight,
  leavesPiece,
  moveNodes,
  outlineProblem,
  pointAlong,
  straightEdge,
  withControl,
} from "./edit";
import { PointBar } from "./PointBar";
import { DrawBar } from "./DrawBar";
import { MarkBar, type MarkKind } from "./MarkBar";
import {
  framed,
  type PenPoint,
  type ShapeKind,
  SHAPE_START,
  shapeFromDrag,
  shapeOutline,
  shapeProblem,
  penEdge,
  penLine,
  penOutline,
  penProblem,
  snapPoint,
  snapStep,
} from "./draw";
import {
  apply,
  type Box,
  bounds,
  type CutView,
  inside,
  layoutCuts,
  linePoints,
  nodesPoints,
  outlinePoints,
  distToPolyline,
  edgeInterior,
  flattenCubic,
  type P,
  pathData,
  roundMm,
  runPoints,
  touchesBox,
  type Transform,
  unapply,
} from "./geometry";
import { type CutEdge, sameEdge } from "@/sewing/api";

/**
 * A cut, by its id (and its piece's): the one the properties and the 3D view show. `also`: other
 * cuts picked with it in the flat view (a box dragged round them, or Shift-clicks), moved with it.
 */
export type Selection = {
  kind: "cut";
  pieceId: string;
  cutId: string;
  also?: readonly string[];
} | null;

export type FlatTool = "select" | "points" | "draw" | "shape" | "marks" | "sew";

/** The marks tool's pick: a line, fold or grain line of one cut's piece. */
type MarkPick = {
  kind: "line" | "fold" | "grain";
  pieceId: string;
  cutId: string;
  /** The line's or fold's id (the grain line has none). */
  id: string;
} | null;

/** The point tool's pick: an outline node, or the edge from it, on one cut of its piece. */
type PointPick = {
  kind: "node" | "edge";
  pieceId: string;
  cutId: string;
  nodeId: string;
} | null;

/** The sew tool's edges and what the user has picked so far. */
export interface SewingState {
  edges: CutEdge[];
  /** The edges picked so far, both sides. */
  picked: CutEdge[];
  /** `more`: Shift was held, so the side being picked continues with another edge. */
  onPick: (edge: CutEdge, more: boolean) => void;
}

const SEAM_COLOURS = [
  "#3A63F0",
  "#D6457F",
  "#1F9D6B",
  "#D9822B",
  "#7B5CD6",
  "#2A9DB5",
];
/** How close the pointer must be to an edge to pick it, screen pixels. */
const EDGE_PICK_PX = 10;
/** The point tool's markers: their size and how close counts as on one, screen pixels. */
const NODE_PX = 4.5;
const NODE_PICK_PX = 9;
const CONTROL_PX = 4;
const BAD = "#D14343";

/** What the zoom control can do to the view. */
export interface PatternView {
  zoom(factor: number): void;
  reset(): void;
  /** Where a new piece's bottom left goes so it sits right of the pieces there (mm). */
  freeSpot(): Vec2;
}

const NOTCH_MM = 10;
/** Room under each cut for its name. */
const LABEL_GAP_MM = 34;
/** The turn handle: how far above the selection, and how big, in screen pixels. */
const HANDLE_PX = 26;
const HANDLE_R_PX = 7;
const SNAP_DEG = 15;

function fit(box: Box, aspect: number, margin = 60): Box {
  let w = box.maxX - box.minX + 2 * margin;
  let h = box.maxY - box.minY + 2 * margin;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - h / 2,
    maxY: cy + h / 2,
  };
}

/** The SVG transform for a cut's frame (SVG's y points down, so turns are clockwise there). */
function svgTransform(t: Transform, mirrored: boolean): string {
  return `translate(${t.x} ${-t.y}) rotate(${(-t.rot * 180) / Math.PI}) scale(${mirrored ? -1 : 1} 1)`;
}

/** The piece drawn in its own frame (the group around it mirrors, turns and moves it). */
/** The grid's steps, in millimetres, like millimetre paper: 1, 5 and 10 mm, then on by 5 and 2. */
const GRID_STEPS_MM = [1, 5, 10, 50, 100, 500, 1000, 5000];
/** A step's lines show from this spacing on screen, and reach full strength at the second. */
const GRID_MIN_PX = 5;
const GRID_FULL_PX = 80;

/**
 * Millimetre paper under the pieces, in pattern millimetres (the origin is the layout's): each
 * step fades in as zooming spreads its lines, and the coarser steps fall on the finer ones' lines
 * so every 5th and 10th line reads darker.
 */
function Grid({ box, mmPerPx }: { box: Box; mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  return (
    <g
      fill="none"
      stroke="#7F8B78"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      shapeRendering="crispEdges"
      pointerEvents="none"
    >
      {GRID_STEPS_MM.map((step) => {
        const px = step / mmPerPx;
        if (
          px < GRID_MIN_PX ||
          px > Math.max(box.maxX - box.minX, box.maxY - box.minY) / mmPerPx
        )
          return null;
        const strength = Math.min(
          1,
          (px - GRID_MIN_PX) / (GRID_FULL_PX - GRID_MIN_PX),
        );
        let d = "";
        for (
          let x = Math.ceil(box.minX / step) * step;
          x <= box.maxX;
          x += step
        )
          d += `M${x} ${box.minY}V${box.maxY}`;
        for (
          let y = Math.ceil(box.minY / step) * step;
          y <= box.maxY;
          y += step
        )
          d += `M${box.minX} ${y}H${box.maxX}`;
        return (
          <path
            key={step}
            d={d}
            vectorEffect="non-scaling-stroke"
            strokeOpacity={0.06 + 0.3 * strength}
          />
        );
      })}
    </g>
  );
}

/** The scale bar's longest length on screen, pixels. */
const SCALE_MAX_PX = 120;

/** A map's scale bar: the longest round length (1, 2 or 5 times a power of ten mm) that fits. */
function ScaleBar({ mmPerPx }: { mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  const most = SCALE_MAX_PX * mmPerPx;
  const pow = 10 ** Math.floor(Math.log10(most));
  const mm = [5, 2, 1].map((k) => k * pow).find((v) => v <= most) ?? pow;
  const label =
    mm >= 1000
      ? `${mm / 1000} m`
      : mm >= 10
        ? `${mm / 10} cm`
        : `${+mm.toPrecision(3)} mm`;
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 flex flex-col items-end gap-1 text-[12px] font-medium text-[#4A514B]">
      <span>{label}</span>
      <span
        className="h-1.5 border-x-[1.5px] border-b-[1.5px] border-[#4A514B]"
        style={{ width: mm / mmPerPx }}
      />
    </div>
  );
}

/**
 * `color`: the cut's own (its appearance), drawn light so the lines stay readable. `bad`: an
 * outline being dragged into a shape that can't be kept.
 */
function PieceDrawing({
  piece,
  color,
  bad,
  marked,
}: {
  piece: Piece;
  color?: string;
  bad?: boolean;
  /** The marks tool's pick on this piece, drawn in blue. */
  marked?: MarkPick;
}) {
  const ink = (kind: "line" | "fold" | "grain", id = "") =>
    marked?.kind === kind && (kind === "grain" || marked.id === id)
      ? { stroke: "#3A63F0", strokeWidth: 3.5 }
      : { stroke: "#8E968A", strokeWidth: 1.6 };
  const outline = outlinePoints(piece);
  const nodes = piece.outline;
  const byId = new Map(nodes.map((n: OutlineNode) => [n.id, n.position]));
  // Notches: a tick into the piece, along the inward normal (the outline is counter-clockwise).
  const ticks = nodes.flatMap((n, k) => {
    if (n.type !== "notch") return [];
    const prev = nodes[(k + nodes.length - 1) % nodes.length];
    const after = nodes[(k + 1) % nodes.length]?.position ?? n.position;
    const next = edgeInterior(n.edge, n.position, after)[0] ?? after;
    const before = prev
      ? (edgeInterior(prev.edge, prev.position, n.position).at(-1) ??
        prev.position)
      : undefined;
    if (!next || !before) return [];
    const tx = next[0] - before[0];
    const ty = next[1] - before[1];
    const len = Math.hypot(tx, ty) || 1;
    const [x, y] = n.position;
    return [
      [
        [x, y],
        [x - (ty / len) * NOTCH_MM, y + (tx / len) * NOTCH_MM],
      ] as P[],
    ];
  });
  return (
    <>
      <path d={pathData(outline, true)} fill="#FFFFFF" stroke="none" />
      <path
        d={pathData(outline, true)}
        fill={color ?? "none"}
        fillOpacity={0.55}
        stroke={bad ? BAD : "#14181F"}
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {(piece.lines ?? []).map((l) => (
        <path
          key={l.id}
          d={pathData(linePoints(l), false)}
          fill="none"
          {...ink("line", l.id)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {(piece.folds ?? []).map((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        return a && b ? (
          <path
            key={f.id}
            d={pathData([a, b], false)}
            {...ink("fold", f.id)}
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null;
      })}
      {ticks.map((t, i) => (
        <path
          key={i}
          d={pathData(t, false)}
          stroke="#14181F"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {piece.grain && (
        <path
          d={pathData([piece.grain.from, piece.grain.to], false)}
          {...ink("grain")}
          strokeLinecap="round"
          markerStart="url(#grain-arrow)"
          markerEnd="url(#grain-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </>
  );
}

/**
 * The point tool's marks on one cut, in the piece frame: every node (a square for a corner, a
 * diamond for a notch, a dot for a plain point), the picked edge, and the handles of the
 * curves at the pick.
 */
function PointMarks({
  piece,
  pick,
  handles,
  r,
}: {
  piece: Piece;
  pick: { kind: "node" | "edge"; k: number } | null;
  handles: Handle[];
  r: number;
}) {
  const nodes = piece.outline;
  const blue = "#3A63F0";
  return (
    <g pointerEvents="none">
      {pick?.kind === "edge" && (
        <path
          d={pathData(edgePoints(nodes, pick.k), false)}
          fill="none"
          stroke={blue}
          strokeWidth={5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {handles.map((h) => {
        const n = nodes[h.k];
        const end = h.which === 0 ? n : nodes[(h.k + 1) % nodes.length];
        if (n?.edge.type !== "cubic" || !end) return null;
        const c = n.edge.controls[h.which];
        return (
          <g key={`${h.k}:${h.which}`}>
            <path
              d={pathData([end.position, c], false)}
              stroke={blue}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={c[0]}
              cy={-c[1]}
              r={CONTROL_PX * (r / NODE_PX)}
              fill="#FFFFFF"
              stroke={blue}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {nodes.map((n, k) => {
        const on = pick?.kind === "node" && pick.k === k;
        const [x, y] = [n.position[0], -n.position[1]];
        const paint = {
          fill: on ? blue : "#FFFFFF",
          stroke: on ? blue : "#14181F",
          strokeWidth: 1.5,
          vectorEffect: "non-scaling-stroke" as const,
        };
        if (n.type === "corner")
          return (
            <rect
              key={n.id}
              x={x - r}
              y={y - r}
              width={2 * r}
              height={2 * r}
              {...paint}
            />
          );
        if (n.type === "notch")
          return (
            <path
              key={n.id}
              d={`M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}Z`}
              {...paint}
            />
          );
        return <circle key={n.id} cx={x} cy={y} r={r * 0.85} {...paint} />;
      })}
    </g>
  );
}

/** The pen's points joined by the edges it draws, as one polyline (`closed`: back to the first). */
function penPath(points: readonly PenPoint[], closed: boolean): P[] {
  const out: P[] = [];
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const a = points[k] as PenPoint;
    out.push(a.at);
    if (k + 1 === n && !closed) break;
    const b = points[(k + 1) % n] as PenPoint;
    const e = penEdge(a, b);
    if (e.type === "cubic")
      out.push(...flattenCubic(a.at, e.controls[0], e.controls[1], b.at));
  }
  if (closed && points[0]) out.push(points[0].at);
  return out;
}

/**
 * The piece being drawn, in view coordinates: its edges so far, the edge to the pointer, the
 * points (the first one ringed when a click there closes the piece) and the handle being
 * dragged.
 */
function PenMarks({
  points,
  live,
  end,
  closable,
  bad,
  r,
  open = false,
}: {
  points: readonly PenPoint[];
  live: P[] | null;
  end: PenPoint | null;
  closable: boolean;
  bad: boolean;
  r: number;
  /** An internal line: never closed, no edge back to the first point. */
  open?: boolean;
}) {
  const blue = "#3A63F0";
  const ink = bad ? BAD : "#14181F";
  const first = points[0];
  const dot = (p: P, key: string, on = false) => (
    <rect
      key={key}
      x={p[0] - r}
      y={-p[1] - r}
      width={2 * r}
      height={2 * r}
      fill={on ? blue : "#FFFFFF"}
      stroke={on ? blue : ink}
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
  return (
    <g pointerEvents="none">
      {points.length >= 2 && (
        <path
          d={pathData(penPath(points, bad && !open), false)}
          fill="none"
          stroke={ink}
          strokeWidth={2.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {live && (
        <path
          d={pathData(live, false)}
          fill="none"
          stroke={blue}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {end && first && points.length >= 2 && !closable && !open && (
        <path
          d={pathData([end.at, first.at], false)}
          fill="none"
          stroke={blue}
          strokeWidth={1.2}
          strokeDasharray="4 5"
          opacity={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {end?.out && (
        <g>
          <path
            d={pathData(
              [
                [2 * end.at[0] - end.out[0], 2 * end.at[1] - end.out[1]],
                end.out,
              ],
              false,
            )}
            stroke={blue}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={end.out[0]}
            cy={-end.out[1]}
            r={CONTROL_PX * (r / NODE_PX)}
            fill="#FFFFFF"
            stroke={blue}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {points.map((p, k) => dot(p.at, `${k}`, k === 0 && closable))}
      {first && closable && (
        <circle
          cx={first.at[0]}
          cy={-first.at[1]}
          r={r * 2.4}
          fill="none"
          stroke={blue}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {end && !closable && (
        <circle
          cx={end.at[0]}
          cy={-end.at[1]}
          r={r * 0.6}
          fill={blue}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

/**
 * The marks tool's marks on one cut, in the piece frame: the outline's points (for notches
 * and folds), the line being drawn, a fold from its first end to the pointer, the grain line
 * being dragged.
 */
function MarkMarks({
  v,
  kind,
  line,
  fold,
  grain,
  bad,
  r,
}: {
  v: CutView;
  kind: MarkKind;
  line: { points: PenPoint[]; cursor: P | null; handle: P | null } | null;
  fold: { nodeId: string; cursor: P | null } | null;
  grain: { from: P; to: P } | null;
  bad: boolean;
  r: number;
}) {
  const blue = "#3A63F0";
  const nodes = v.piece.outline;
  const k = fold ? nodes.findIndex((n) => n.id === fold.nodeId) : -1;
  const start = nodes[k]?.position;
  const last = line?.points.at(-1);
  const end: PenPoint | null = line?.cursor
    ? { at: line.cursor, ...(line.handle ? { out: line.handle } : {}) }
    : null;
  return (
    <g pointerEvents="none">
      {(kind === "notch" || kind === "fold") && (
        <PointMarks
          piece={v.piece}
          pick={k >= 0 ? { kind: "node", k } : null}
          handles={[]}
          r={r}
        />
      )}
      {start && fold?.cursor && (
        <path
          d={pathData([start, toPiece(v, fold.cursor)], false)}
          stroke={blue}
          strokeWidth={1.6}
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {grain && (
        <path
          d={pathData([grain.from, grain.to], false)}
          stroke={blue}
          strokeWidth={2}
          strokeLinecap="round"
          markerStart="url(#grain-arrow)"
          markerEnd="url(#grain-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {line && (
        <PenMarks
          points={line.points}
          live={last && end ? penPath([last, end], false) : null}
          end={end}
          closable={false}
          bad={bad}
          r={r * 0.8}
          open
        />
      )}
    </g>
  );
}

/** A curve's handle: of the edge from node `k`, 0 at its start, 1 at its end. */
interface Handle {
  k: number;
  which: 0 | 1;
}

/** The handles shown for a pick: the picked edge's, or those at the picked node. */
function pickHandles(
  nodes: readonly OutlineNode[],
  pick: { kind: "node" | "edge"; k: number } | null,
): Handle[] {
  if (!pick) return [];
  const n = nodes.length;
  const all: Handle[] =
    pick.kind === "edge"
      ? [
          { k: pick.k, which: 0 },
          { k: pick.k, which: 1 },
        ]
      : [
          { k: pick.k, which: 0 },
          { k: (pick.k + n - 1) % n, which: 1 },
        ];
  return all.filter((h) => nodes[h.k]?.edge.type === "cubic");
}

/** A point of the view (mm, y up) in the cut's piece frame (before mirroring and layout). */
function toPiece(v: CutView, p: P): P {
  const q = unapply(v.t, p);
  return v.cut.mirrored ? [-q[0], q[1]] : q;
}

function cutLabel(v: CutView): string {
  return v.cut.name ?? v.piece.name;
}

/** A point drag: a node to `to`, or a curve's handle; both from where the pointer went down. */
interface PointDrag {
  cut: CutView;
  /** The outline as it was (the document's). */
  nodes: readonly OutlineNode[];
  /** Where the pointer went down (view) and where the dragged thing was (piece frame). */
  start: P;
  from: P;
  moved: boolean;
  to: P;
}

type Drag =
  /** `hit`: what a click (no drag) picks; undefined: it picks nothing (Cmd held). */
  | {
      kind: "pan";
      x: number;
      y: number;
      moved: boolean;
      hit?: CutView | null;
    }
  | ({ kind: "node"; k: number } & PointDrag)
  | ({ kind: "control"; k: number; which: 0 | 1 } & PointDrag)
  /**
   * The select tool: cuts dragged together (the one under the pointer and the rest of the
   * selection). A click without a drag picks `hit` alone, or with Shift takes it out if it
   * was `picked` already.
   */
  | {
      kind: "move";
      cuts: CutView[];
      start: P;
      moved: boolean;
      hit: CutView;
      shift: boolean;
      picked: boolean;
    }
  /** The select tool: a box dragged out over the view; `add` keeps what was picked (Shift). */
  | { kind: "box"; from: P; x: number; y: number; moved: boolean; add: boolean }
  /** The shape tool: a shape dragged out from `from` (a click puts a default one there). */
  | { kind: "shape"; from: P; x: number; y: number; moved: boolean }
  /** The marks tool: a line's point being put down (piece frame), dragged for a curve. */
  | {
      kind: "line";
      cut: CutView;
      at: P;
      x: number;
      y: number;
      moved: boolean;
    }
  /** The marks tool: the grain line being dragged out (piece frame). */
  | { kind: "grain"; cut: CutView; from: P }
  /** The pen: a point being put down (`closing`: on the first one), dragged for a curve. */
  | {
      kind: "pen";
      at: P;
      closing: boolean;
      x: number;
      y: number;
      moved: boolean;
    }
  | {
      kind: "turn";
      cut: CutView;
      centre: P;
      local: P;
      from: number;
      t: Transform;
    };

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
  const [pick, setPick] = useState<PointPick>(null);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const garmentId = garment?.id;
  // The view box the user panned or zoomed to, for one garment (another file frames itself).
  const [userView, setUserView] = useState<{
    garment: string | undefined;
    box: Box;
  } | null>(null);
  const view = userView && userView.garment === garmentId ? userView.box : null;
  const setView = (box: Box | null) =>
    setUserView(box ? { garment: garmentId, box } : null);
  const drag = useRef<Drag | null>(null);
  /** Cuts being dragged or turned, drawn where the pointer has them until the edit lands. */
  const [live, setLive] = useState<ReadonlyMap<string, Transform> | null>(null);
  /** The select tool's box being dragged out, and the shape tool's shape (pattern mm). */
  const [box, setBox] = useState<{ from: P; to: P } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cuts = layout.cuts.map((v) => {
    const t = live?.get(v.cut.id);
    if (!t) return v;
    return { ...v, t, box: bounds(v.pts.map((p) => apply(t, p))) };
  });
  // The same box in SVG coordinates (y down), with room for the labels.
  const all = {
    minX: layout.box.minX,
    maxX: layout.box.maxX,
    minY: -layout.box.maxY,
    maxY: -layout.box.minY + LABEL_GAP_MM,
  };
  const aspect = size.w / size.h;
  // Room around the pieces for the status pill above and the hint and zoom below.
  const home = fit(
    all,
    aspect,
    0.12 * Math.max(all.maxX - all.minX, (all.maxY - all.minY) * aspect),
  );
  // Keep the aspect of the panel (the view box may come from another size).
  const vb = fit(view ?? home, aspect, 0);
  const mmPerPx = (vb.maxX - vb.minX) / size.w;

  /** Scales the view box by `k` (< 1 zooms in) around a point given as a fraction of the panel. */
  const zoomAt = (k: number, fx = 0.5, fy = 0.5) =>
    setUserView((u) => {
      const v = u && u.garment === garmentId ? u.box : null;
      const b = fit(v ?? home, aspect, 0);
      const w = (b.maxX - b.minX) * k;
      const h = (b.maxY - b.minY) * k;
      const x = b.minX + (b.maxX - b.minX) * fx - w * fx;
      const y = b.minY + (b.maxY - b.minY) * fy - h * fy;
      return {
        garment: garmentId,
        box: { minX: x, maxX: x + w, minY: y, maxY: y + h },
      };
    });

  useImperativeHandle(ref, () => ({
    zoom: (factor: number) => zoomAt(1 / factor),
    reset: () => setView(null),
    freeSpot: (): Vec2 =>
      layout.cuts.length
        ? [Math.round(layout.box.maxX + 80), Math.round(layout.box.minY)]
        : [0, 0],
  }));

  // The wheel listener is added once (non-passive); it calls the current zoomAt.
  const zoomRef = useRef(zoomAt);
  useEffect(() => {
    zoomRef.current = zoomAt;
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(
        Math.exp(e.deltaY * 0.0015),
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const toPattern = (e: { clientX: number; clientY: number }): P => {
    const r = host.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return [
      vb.minX + (e.clientX - r.left) * mmPerPx,
      -(vb.minY + (e.clientY - r.top) * mmPerPx),
    ];
  };

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
  const points = tool === "points" && !!onEdit;
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

  // ---- the point tool ----
  // The pick, while its cut and node are still there.
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
  const edit = (build: (e: Entities, garmentId: string) => Command) => {
    if (garmentId && onEdit) onEdit((e) => build(e, garmentId));
  };
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

  // ---- the pen ----
  const drawing = tool === "draw" && !!onDrawn;
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
  /** Space held: dragging pans while drawing or picking with a box. */
  const spaceDown = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " ") spaceDown.current = e.type === "keydown";
    };
    const blur = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ---- the shape tool ----
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
  const shapePreview =
    tool === "shape" && box ? shapeDrop(box.from, box.to, even) : null;

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

  // ---- the marks tool: internal lines, notches, folds, the grain line ----
  const marking = tool === "marks" && !!onEdit;
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
      drag.current = {
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
      drag.current = {
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
      drag.current = { kind: "grain", cut: v, from };
      setGrainLive({ cutId: v.cut.id, from, to: from });
      return true;
    }
    return false;
  };

  const markBar = (
    <MarkBar
      kind={markKind}
      onKind={setMarkKind}
      drawing={
        lineDraft
          ? {
              points: lineDraft.points.length,
              onFinish: finishLine,
              onUndo: () =>
                setLineDraft((d) =>
                  d ? { ...d, points: d.points.slice(0, -1) } : d,
                ),
              onCancel: () => setLineDraft(null),
            }
          : undefined
      }
      folding={foldFrom ? { onCancel: () => setFoldFrom(null) } : undefined}
      picked={
        markPicked ? { what: markPicked.kind, onRemove: removeMark } : undefined
      }
      warning={
        markWarning ??
        (lineDraft && lineCut
          ? (() => {
              const live = lineDraft.cursor
                ? [
                    ...lineDraft.points,
                    {
                      at: lineDraft.cursor,
                      ...(lineDraft.handle ? { out: lineDraft.handle } : {}),
                    },
                  ]
                : lineDraft.points;
              const why = lineProblem(lineCut, live);
              return why ? `Can't keep this line: ${why}` : undefined;
            })()
          : undefined)
      }
    />
  );

  const bar = (() => {
    const warning = shape?.problem
      ? `Can't keep this shape: ${shape.problem}`
      : undefined;
    const nodes = picked?.v.piece.outline;
    const node = nodes?.[picked?.k ?? -1];
    if (!picked || !nodes || !node)
      return <PointBar kind="hint" warning={warning} />;
    const { k, v } = picked;
    const pieceId = v.piece.id;
    if (picked.kind === "node")
      return (
        <PointBar
          kind="node"
          type={node.type}
          warning={warning}
          onType={(t) => edit((e, g) => setNodeType(e, g, pieceId, node.id, t))}
          onDelete={removePicked}
        />
      );
    const next = nodes[(k + 1) % nodes.length];
    const straight = isStraight(node.edge);
    let angle: number | undefined;
    if (straight && next) {
      const dx =
        (next.position[0] - node.position[0]) * (v.cut.mirrored ? -1 : 1);
      const dy = next.position[1] - node.position[1];
      const deg = ((Math.atan2(dy, dx) + v.t.rot) * 180) / Math.PI;
      angle = ((((deg + 180) % 360) + 360) % 360) - 180 || 0;
    }
    return (
      <PointBar
        kind="edge"
        edge={
          node.edge.type === "cubic"
            ? "curve"
            : straight
              ? "straight"
              : "traced"
        }
        length={edgeLength(nodes, k)}
        angle={angle}
        warning={warning}
        onStraight={() =>
          edit((e, g) => setEdge(e, g, pieceId, node.id, straightEdge()))
        }
        onCurve={() =>
          edit((e, g) => setEdge(e, g, pieceId, node.id, curvedEdge(nodes, k)))
        }
        onLength={(mm) =>
          next &&
          edit((e, g) =>
            moveNodesCommand(e, g, pieceId, {
              [next.id]: endForLength(nodes, k, mm),
            }),
          )
        }
        onAddPoint={() => insertAt(v, k, pointAlong(nodes, k, 0.5))}
      />
    );
  })();
  // Panning or zooming during a drag would move the fit under the pointer: freeze it.
  const freeze = () => {
    if (!view) setView(vb);
  };

  return (
    <div
      ref={host}
      className={`flat-grid relative h-full w-full touch-none overflow-hidden ${panning ? "cursor-grab" : tool === "sew" || tool === "shape" || drawing ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={(e) => {
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
        if (panning) {
          freeze();
          drag.current = {
            kind: "pan",
            x: e.clientX,
            y: e.clientY,
            moved: false,
          };
          return;
        }
        if (drawing && e.button === 0 && !spaceDown.current) {
          const at = penAt(e);
          drag.current = {
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
              drag.current = {
                ...common,
                kind: "node",
                k: hit.k,
                from: node.position,
                to: node.position,
              };
            } else if (hit.kind === "control" && node.edge.type === "cubic") {
              const c = node.edge.controls[hit.which];
              drag.current = {
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
          drag.current = {
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
          drag.current = {
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
          tool === "select" && e.button === 0 && !spaceDown.current;
        if (selecting && hit) {
          freeze();
          // A picked cut takes the others picked with it; another is picked alone (with
          // Shift: added to them).
          const picked = inGroup.has(hit.cut.id);
          const cuts = picked ? group : e.shiftKey ? [...group, hit] : [hit];
          if (!picked) selectAll(cuts);
          drag.current = {
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
          drag.current = {
            kind: "box",
            from: p,
            x: e.clientX,
            y: e.clientY,
            moved: false,
            add: e.shiftKey,
          };
          return;
        }
        drag.current = {
          kind: "pan",
          x: e.clientX,
          y: e.clientY,
          moved: false,
          hit,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
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
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
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
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
        setBox(null);
        setShape(null);
        setPen((x) => ({ ...x, handle: null }));
        setGrainLive(null);
      }}
      onPointerLeave={() =>
        drawing && !drag.current && setPen((x) => ({ ...x, cursor: null }))
      }
      onDoubleClick={(e) => {
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
              stroke="#8E968A"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <Grid box={vb} mmPerPx={mmPerPx} />
        {cuts.map((v) => {
          const on = inGroup.has(v.cut.id);
          const lit = highlight === v.cut.id;
          return (
            <g
              key={v.cut.id}
              opacity={highlight && !lit ? 0.3 : undefined}
              className="transition-opacity duration-150"
            >
              <g transform={svgTransform(v.t, !!v.cut.mirrored)}>
                <PieceDrawing
                  piece={v.piece}
                  color={cutColors?.get(v.cut.id)}
                  bad={!!shape?.problem && shape.pieceId === v.piece.id}
                  marked={markPicked?.cutId === v.cut.id ? markPicked : null}
                />
                {lit && (
                  <path
                    d={pathData(outlinePoints(v.piece), true)}
                    fill="none"
                    stroke="#3A63F0"
                    strokeWidth={5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="pointer-events-none"
                  />
                )}
                {/* Seams, one colour each, on the edges they sew. */}
                {(garment?.seams ?? []).flatMap((seam, i) =>
                  [...seam.a, ...seam.b]
                    .filter((r) => r.cut === v.cut.id && !r.line)
                    .map((r, k) => {
                      const lit = highlightSeam === seam.id;
                      return (
                        <path
                          key={`${seam.id}:${k}`}
                          d={pathData(
                            runPoints(
                              v.piece,
                              r.from,
                              r.to,
                              r.direction !== "cw",
                            ),
                            false,
                          )}
                          fill="none"
                          stroke={SEAM_COLOURS[i % SEAM_COLOURS.length]}
                          strokeWidth={lit ? 9 : 5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={lit ? 1 : highlightSeam ? 0.2 : 0.85}
                          vectorEffect="non-scaling-stroke"
                          className="transition-opacity duration-150"
                        />
                      );
                    }),
                )}
                {/* The sew tool: free edges to pick, and the first pick. */}
                {tool === "sew" &&
                  sewing?.edges
                    .filter((e) => e.cut === v.cut.id && !e.sewn)
                    .map((e) => {
                      const on = sewing.picked.some((x) => sameEdge(x, e));
                      return (
                        <path
                          key={`${e.from}:${e.to}`}
                          d={pathData(
                            runPoints(v.piece, e.from, e.to, true),
                            false,
                          )}
                          fill="none"
                          stroke="#3A63F0"
                          strokeWidth={on ? 7 : 4}
                          strokeDasharray={on ? undefined : "2 7"}
                          strokeLinecap="round"
                          opacity={on ? 1 : 0.55}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                {marking && (
                  <MarkMarks
                    v={v}
                    kind={markKind}
                    line={lineDraft?.cutId === v.cut.id ? lineDraft : null}
                    fold={foldFrom?.cutId === v.cut.id ? foldFrom : null}
                    grain={grainLive?.cutId === v.cut.id ? grainLive : null}
                    bad={
                      lineDraft?.cutId === v.cut.id &&
                      !!lineProblem(v, [
                        ...lineDraft.points,
                        ...(lineDraft.cursor
                          ? [
                              {
                                at: lineDraft.cursor,
                                ...(lineDraft.handle
                                  ? { out: lineDraft.handle }
                                  : {}),
                              },
                            ]
                          : []),
                      ])
                    }
                    r={NODE_PX * mmPerPx}
                  />
                )}
                {points && (
                  <PointMarks
                    piece={v.piece}
                    pick={picked?.v.cut.id === v.cut.id ? picked : null}
                    handles={picked?.v.cut.id === v.cut.id ? handles : []}
                    r={NODE_PX * mmPerPx}
                  />
                )}
              </g>
              <text
                x={(v.box.minX + v.box.maxX) / 2}
                y={-v.box.minY + LABEL_GAP_MM}
                textAnchor="middle"
                fill={on ? "#14181F" : "#5B625C"}
                fontWeight={on ? 600 : 400}
                className="pointer-events-none font-sans text-[22px] select-none"
              >
                {cutLabel(v)}
                {v.cut.mirrored ? " (mirrored)" : ""}
              </text>
            </g>
          );
        })}
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
              stroke="#3A63F0"
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
            fill="#3A63F0"
            fillOpacity={0.08}
            stroke="#3A63F0"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {/* The shape being dragged out, with its sizes. */}
        {shapePreview && (
          <g pointerEvents="none">
            <path
              transform={`translate(${shapePreview.origin[0]} ${-shapePreview.origin[1]})`}
              d={pathData(
                nodesPoints(
                  shapeOutline(shapeKind, shapePreview.size, () => ""),
                ),
                true,
              )}
              fill="#FFFFFF"
              fillOpacity={0.7}
              stroke={shapePreview.problem ? BAD : "#3A63F0"}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            <text
              x={shapePreview.origin[0] + shapePreview.size.width / 2}
              y={
                -shapePreview.origin[1] - shapePreview.size.height - 8 * mmPerPx
              }
              textAnchor="middle"
              fill={shapePreview.problem ? BAD : "#3A63F0"}
              fontSize={12 * mmPerPx}
              className="font-sans font-semibold tabular-nums select-none"
            >
              {shapeKind === "tube"
                ? `${Math.round(shapePreview.size.top ?? 0)} / ${Math.round(shapePreview.size.width)} × ${Math.round(shapePreview.size.height)} mm`
                : `${Math.round(shapePreview.size.width)} × ${Math.round(shapePreview.size.height)} mm`}
            </text>
          </g>
        )}
        {selected && handle && (
          <g>
            <rect
              x={selected.box.minX - 12}
              y={-selected.box.maxY - 12}
              width={selected.box.maxX - selected.box.minX + 24}
              height={selected.box.maxY - selected.box.minY + 24}
              fill="none"
              stroke="#3A63F0"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={pathData([[handle[0], selected.box.maxY + 12], handle], false)}
              stroke="#3A63F0"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={handle[0]}
              cy={-handle[1]}
              r={HANDLE_R_PX * mmPerPx}
              fill="#FFFFFF"
              stroke="#3A63F0"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              className="cursor-grab"
            >
              <title>Drag to turn (Shift: 15° steps)</title>
            </circle>
          </g>
        )}
      </svg>
      {garment && <ScaleBar mmPerPx={mmPerPx} />}
      {garment && !layout.cuts.length && !drawing && tool !== "shape" && empty}
      {drawing && garment && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <DrawBar
            key={pen.points.length}
            points={pen.points.length}
            length={liveLength}
            angle={liveAngle}
            warning={
              pen.problem
                ? `Can't make this a piece: ${pen.problem}`
                : undefined
            }
            onPlace={(mm, deg) => {
              if (!lastPen) return;
              const a = (deg * Math.PI) / 180;
              const at: P = [
                roundMm(lastPen.at[0] + mm * Math.cos(a)),
                roundMm(lastPen.at[1] + mm * Math.sin(a)),
              ];
              setPen((x) => ({
                ...x,
                points: [...x.points, { at }],
                cursor: at,
                problem: null,
              }));
            }}
            onUndo={() =>
              setPen((x) => ({
                ...x,
                points: x.points.slice(0, -1),
                problem: null,
              }))
            }
            onClose={() => closePen(pen.points)}
            onCancel={() =>
              setPen({ points: [], cursor: null, handle: null, problem: null })
            }
          />
        </div>
      )}
      {marking && garment && layout.cuts.length > 0 && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          {markBar}
        </div>
      )}
      {points && garment && layout.cuts.length > 0 && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          {bar}
        </div>
      )}
    </div>
  );
}
