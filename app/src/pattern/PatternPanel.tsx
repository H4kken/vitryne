// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat pieces view: every cut of the garment (a mirrored one drawn mirrored) with its
// folds, grain line, notches and internal lines, where its layout puts it. Wheel zooms around
// the cursor, dragging empty space pans. The select tool picks a cut and turns it by its round
// handle; the move tool drags cuts; the sew tool picks whole edges to sew (two clicks, edge
// then edge: nothing is measured or shown while picking, docs/PATENTS.md). Sewn edges are drawn
// in a colour per seam. The point tool edits a piece's outline: drag a point or a curve's
// handle, double-click an edge to add a point, Delete removes one; a drag that would make the
// outline cross itself shows red and is dropped, so Rust never has to refuse it. Where a cut
// sits here is display only (`cut.layout`).

import {
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Garment, OutlineNode, Piece } from "@/format/schema.gen";
import {
  type Command,
  insertNode,
  moveNodes as moveNodesCommand,
  removeNode,
  setEdge,
  setNodeType,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import {
  curvedEdge,
  edgeLength,
  edgePoints,
  endForLength,
  isStraight,
  moveNodes,
  outlineProblem,
  pointAlong,
  straightEdge,
  withControl,
} from "./edit";
import { PointBar } from "./PointBar";
import {
  apply,
  type Box,
  bounds,
  type CutView,
  inside,
  layoutCuts,
  linePoints,
  outlinePoints,
  distToPolyline,
  edgeInterior,
  type P,
  pathData,
  runPoints,
  type Transform,
  unapply,
} from "./geometry";
import { type CutEdge, sameEdge } from "@/sewing/api";

/** A cut, by its id (and its piece's). */
export type Selection = { kind: "cut"; pieceId: string; cutId: string } | null;

export type FlatTool = "select" | "move" | "points" | "sew";

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
    <div className="pointer-events-none absolute right-4 bottom-[68px] flex flex-col items-end gap-1 text-[12px] font-medium text-[#4A514B]">
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
}: {
  piece: Piece;
  color?: string;
  bad?: boolean;
}) {
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
          stroke="#8E968A"
          strokeWidth={1.6}
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
            stroke="#8E968A"
            strokeWidth={1.6}
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
          stroke="#8E968A"
          strokeWidth={1.6}
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
  | { kind: "pan"; x: number; y: number; moved: boolean; hit: CutView | null }
  | ({ kind: "node"; k: number } & PointDrag)
  | ({ kind: "control"; k: number; which: 0 | 1 } & PointDrag)
  | { kind: "move"; cut: CutView; start: P; t: Transform; moved: boolean }
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
  onArrange,
  sewing,
  cutColors,
  empty,
  onEdit,
  ref,
}: {
  garment: Garment | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: FlatTool;
  /** A cut moved or turned: its new layout (one edit per drag). */
  onArrange: (cutId: string, t: Transform) => void;
  /** For the sew tool: the whole edges to pick from. */
  sewing?: SewingState;
  /** Each coloured cut's colour (#rrggbb), by cut id. */
  cutColors?: ReadonlyMap<string, string>;
  /** Shown over the view while the garment has no pieces. */
  empty?: ReactNode;
  /** The point tool's edits: a command, built on the current document. */
  onEdit?: (build: (e: Entities) => Command) => void;
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
  // Cuts without a layout stay where they were first put while their outlines are edited
  // (laid out again when cuts come or go).
  const cutKey = `${garment?.id}:${(garment?.pieces ?? []).flatMap((p) => p.cuts.map((c) => c.id)).join(",")}`;
  const [autos, setAutos] = useState<{
    key: string;
    t: ReadonlyMap<string, Transform>;
  } | null>(null);
  const keep = autos?.key === cutKey ? autos.t : undefined;
  const layout = useMemo(
    () => layoutCuts(shown, undefined, keep),
    [shown, keep],
  );
  if (autos?.key !== cutKey)
    setAutos({
      key: cutKey,
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
  /** A cut being dragged or turned, drawn where the pointer has it until the edit lands. */
  const [live, setLive] = useState<{ cutId: string; t: Transform } | null>(
    null,
  );

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
    if (live?.cutId !== v.cut.id) return v;
    return { ...v, t: live.t, box: bounds(v.pts.map((p) => apply(live.t, p))) };
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
  // The turn handle, above the selection's top middle (pattern coordinates, y up); none
  // while editing points.
  const points = tool === "points" && !!onEdit;
  const handle: P | null =
    selected && !points
      ? [
          (selected.box.minX + selected.box.maxX) / 2,
          selected.box.maxY + HANDLE_PX * mmPerPx,
        ]
      : null;
  const select = (v: CutView | null) =>
    onSelect(v ? { kind: "cut", pieceId: v.piece.id, cutId: v.cut.id } : null);

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
      className={`flat-grid relative h-full w-full touch-none overflow-hidden ${tool === "move" ? "cursor-move" : tool === "sew" ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser no longer tracks: the drag just stops at the panel's edge.
        }
        const p = toPattern(e);
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
        const hit = hitCut(p);
        if (tool === "move" && hit) {
          freeze();
          select(hit);
          drag.current = {
            kind: "move",
            cut: hit,
            start: p,
            t: hit.t,
            moved: false,
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
        if (!d) return;
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
          setLive({
            cutId: d.cut.cut.id,
            t: {
              ...d.t,
              x: d.t.x + p[0] - d.start[0],
              y: d.t.y + p[1] - d.start[1],
            },
          });
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
        setLive({
          cutId: d.cut.cut.id,
          t: { x: d.centre[0] - x, y: d.centre[1] - y, rot },
        });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.kind === "pan") {
          if (!d.moved) {
            select(d.hit);
            setPick(null);
          }
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
        if (
          live &&
          live.cutId === d.cut.cut.id &&
          (d.kind === "turn" || d.moved)
        ) {
          const round = (x: number) => Math.round(x * 1000) / 1000;
          onArrange(d.cut.cut.id, {
            x: round(live.t.x),
            y: round(live.t.y),
            rot: Math.round(live.t.rot * 1e4) / 1e4,
          });
        }
        setLive(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
        setShape(null);
      }}
      onDoubleClick={(e) => {
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
          const on = selection?.cutId === v.cut.id;
          return (
            <g key={v.cut.id}>
              <g transform={svgTransform(v.t, !!v.cut.mirrored)}>
                <PieceDrawing
                  piece={v.piece}
                  color={cutColors?.get(v.cut.id)}
                  bad={!!shape?.problem && shape.pieceId === v.piece.id}
                />
                {/* Seams, one colour each, on the edges they sew. */}
                {(garment?.seams ?? []).flatMap((seam, i) =>
                  [...seam.a, ...seam.b]
                    .filter((r) => r.cut === v.cut.id && !r.line)
                    .map((r, k) => (
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
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                        vectorEffect="non-scaling-stroke"
                      />
                    )),
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
      {garment && !layout.cuts.length && empty}
      {points && garment && layout.cuts.length > 0 && (
        <div className="pointer-events-none absolute bottom-[76px] left-1/2 z-10 -translate-x-1/2">
          {bar}
        </div>
      )}
    </div>
  );
}
