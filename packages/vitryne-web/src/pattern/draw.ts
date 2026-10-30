// SPDX-License-Identifier: AGPL-3.0-or-later
// Drawing new pieces: the pen tool's points turned into an outline, ready shapes with typed
// sizes (rectangle, ellipse, tube), and the snapping the pen uses. Snapping is to the grid, to
// 15° steps and to the drawn piece's own points only: never to another piece, and never to make
// an edge as long as another piece's (packages/vitryne-docs/content/docs/developers/patents.md). Every coordinate written is on the
// format's 0.001 mm grid.

import type {
  Cut,
  Edge,
  Line,
  OutlineNode,
  Piece,
  Vec2,
} from "@/format/schema.gen";
import { outlineProblem } from "./edit";
import { type Box, bounds, nodesPoints, type P, roundMm } from "./geometry";

/** A point the pen put down; `out`: its curve handle (where the next edge leaves towards), if dragged. */
export interface PenPoint {
  at: P;
  out?: P;
}

const grid = (p: P): Vec2 => [roundMm(p[0]), roundMm(p[1])];
const lerp = (a: P, b: P, t: number): P => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** The handle on the other side of `at` from `out`: where an edge arrives from. */
const mirror = (at: P, out: P): P => [2 * at[0] - out[0], 2 * at[1] - out[1]];

/**
 * The edge the pen draws from `a` to `b`: straight, or a curve when either end was dragged
 * (leaving `a` along its handle, arriving at `b` against its handle; an end that wasn't
 * dragged pulls a third of the way along the chord).
 */
export function penEdge(a: PenPoint, b: PenPoint): Edge {
  if (!a.out && !b.out) return { type: "polyline", points: [] };
  return {
    type: "cubic",
    controls: [
      grid(a.out ?? lerp(a.at, b.at, 1 / 3)),
      grid(b.out ? mirror(b.at, b.out) : lerp(a.at, b.at, 2 / 3)),
    ],
  };
}

/**
 * The pen's closed path as outline nodes, counter-clockwise. A clicked point is a corner (edges
 * to sew run corner to corner), a dragged one a plain point on a smooth curve; with no corner
 * at all, the first point is one.
 */
export function penOutline(
  points: readonly PenPoint[],
  newId: () => string,
): OutlineNode[] {
  const nodes: OutlineNode[] = points.map((p, k) => ({
    id: newId(),
    type: p.out ? "point" : "corner",
    position: grid(p.at),
    edge: penEdge(p, points[(k + 1) % points.length] ?? p),
  }));
  const first = nodes[0];
  if (first && !nodes.some((n) => n.type === "corner"))
    nodes[0] = { ...first, type: "corner" };
  return counterClockwise(nodes);
}

/**
 * The pen's open path as an internal line (`lines[]`, file-format.md): plain points, each with the
 * edge to the next but the last.
 */
export function penLine(
  points: readonly PenPoint[],
  newId: () => string,
): Line {
  const nodes = points.map((p, k) => {
    const next = points[k + 1];
    return {
      id: newId(),
      type: "point" as const,
      position: grid(p.at),
      ...(next ? { edge: penEdge(p, next) } : {}),
    };
  });
  return { id: newId(), nodes: nodes as Line["nodes"] };
}

/** Twice the signed area of the outline (positive: counter-clockwise). */
function signedArea(nodes: readonly OutlineNode[]): number {
  const pts = nodesPoints(nodes);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P;
    const b = pts[(i + 1) % pts.length] as P;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

/** The same loop walked the other way: each edge now belongs to its other end, reversed. */
export function reverseOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const n = nodes.length;
  return nodes.map((_, i) => {
    // Walking backwards, node i of the result is node j, and its edge is the one from node
    // j - 1 to j, reversed.
    const j = (n - i) % n;
    const node = nodes[j] as OutlineNode;
    const e = (nodes[(j + n - 1) % n] as OutlineNode).edge;
    const edge: Edge =
      e.type === "cubic"
        ? { ...e, controls: [e.controls[1], e.controls[0]] }
        : { ...e, points: [...e.points].reverse() };
    return { ...node, edge };
  });
}

/** The outline made counter-clockwise, as the format wants. */
export function counterClockwise(nodes: readonly OutlineNode[]): OutlineNode[] {
  return signedArea(nodes) < 0 ? reverseOutline(nodes) : [...nodes];
}

/** The outline moved by `d` (mm), curve handles and edge points too. */
export function translateOutline(
  nodes: readonly OutlineNode[],
  d: P,
): OutlineNode[] {
  const move = (p: P): Vec2 => grid([p[0] + d[0], p[1] + d[1]]);
  return nodes.map((n) => ({
    ...n,
    position: move(n.position),
    edge:
      n.edge.type === "cubic"
        ? {
            ...n.edge,
            controls: [move(n.edge.controls[0]), move(n.edge.controls[1])],
          }
        : { ...n.edge, points: n.edge.points.map(move) },
  }));
}

/** The outline's box as drawn (curves flattened). */
export function outlineBox(nodes: readonly OutlineNode[]): Box {
  return bounds(nodesPoints(nodes));
}

/**
 * The outline in a piece frame of its own (its box's bottom left at the origin) and where that
 * origin was: a layout there shows the piece where it was drawn.
 */
export function framed(nodes: readonly OutlineNode[]): {
  outline: OutlineNode[];
  origin: Vec2;
} {
  const b = outlineBox(nodes);
  const origin = grid([b.minX, b.minY]);
  return {
    outline: translateOutline(nodes, [-origin[0], -origin[1]]),
    origin,
  };
}

// ---- ready shapes, counter-clockwise from the bottom left, the box's bottom left at the origin

export type ShapeKind = "rectangle" | "ellipse" | "tube";

export interface ShapeSize {
  /** Rectangle and ellipse: width; tube: the bottom width. */
  width: number;
  /** The tube's top width. */
  top?: number;
  /** Rectangle and ellipse: height; tube: its length. */
  height: number;
}

function corner(id: string, position: Vec2, edge?: Edge): OutlineNode {
  return {
    id,
    type: "corner",
    position: grid(position),
    edge: edge ?? { type: "polyline", points: [] },
  };
}

/** How far a quarter circle's handles reach, as a share of its radius. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/**
 * A ready shape's outline. The ellipse is four curves with a corner at each end of its axes,
 * so its quarters can be sewn as whole edges; the tube is a trapezoid, its top centred on its
 * bottom.
 */
export function shapeOutline(
  kind: ShapeKind,
  s: ShapeSize,
  newId: () => string,
): OutlineNode[] {
  const w = s.width;
  const h = s.height;
  if (kind === "rectangle")
    return [
      corner(newId(), [0, 0]),
      corner(newId(), [w, 0]),
      corner(newId(), [w, h]),
      corner(newId(), [0, h]),
    ];
  if (kind === "tube") {
    const top = s.top ?? w;
    const wide = Math.max(w, top);
    const x0 = (wide - w) / 2;
    const t0 = (wide - top) / 2;
    return [
      corner(newId(), [x0, 0]),
      corner(newId(), [x0 + w, 0]),
      corner(newId(), [t0 + top, h]),
      corner(newId(), [t0, h]),
    ];
  }
  const [rx, ry] = [w / 2, h / 2];
  const [kx, ky] = [rx * KAPPA, ry * KAPPA];
  const cubic = (c1: P, c2: P): Edge => ({
    type: "cubic",
    controls: [grid(c1), grid(c2)],
  });
  // Bottom, right, top, left; each edge to the next counter-clockwise.
  return [
    corner(newId(), [rx, 0], cubic([rx + kx, 0], [w, ry - ky])),
    corner(newId(), [w, ry], cubic([w, ry + ky], [rx + kx, h])),
    corner(newId(), [rx, h], cubic([rx - kx, h], [0, ry + ky])),
    corner(newId(), [0, ry], cubic([0, ry - ky], [rx - kx, 0])),
  ];
}

/** Each shape's sizes to start from, mm. */
export const SHAPE_START: Record<ShapeKind, ShapeSize> = {
  rectangle: { width: 500, height: 700 },
  ellipse: { width: 300, height: 300 },
  tube: { width: 600, top: 400, height: 600 },
};

/**
 * The sizes of a shape dragged out `w` by `h` mm (on the grid); a tube keeps the starting
 * shape's top to bottom ratio. `even` (Shift): as wide as high, the larger of the two.
 */
export function shapeFromDrag(
  kind: ShapeKind,
  w: number,
  h: number,
  even = false,
): ShapeSize {
  const [width, height] = even ? [Math.max(w, h), Math.max(w, h)] : [w, h];
  const start = SHAPE_START.tube;
  return {
    width: roundMm(width),
    height: roundMm(height),
    ...(kind === "tube"
      ? { top: roundMm((width * (start.top ?? start.width)) / start.width) }
      : {}),
  };
}

/** Why a shape's sizes can't make a piece, or null. */
export function shapeProblem(kind: ShapeKind, s: ShapeSize): string | null {
  const sizes = [s.width, s.height, ...(kind === "tube" ? [s.top ?? 0] : [])];
  if (!sizes.every((x) => Number.isFinite(x) && x >= 1))
    return "every size must be at least 1 mm";
  if (sizes.some((x) => x > 5000)) return "every size must be at most 5 m";
  return null;
}

// ---- a new piece -----------------------------------------------------------------------------

/** A wrap Rust replaces (`place_piece`): any valid one will do. */
const UNPLACED: Cut["placement"] = {
  type: "wrap",
  region: "torso",
  angle: 0,
  radius: 1,
  top: 0,
};

/**
 * A piece of `outline` (its own frame), cut once or as a pair (the second cut mirrored),
 * each cut laid out in the flat view: the first at `origin`, the pair's mirror image to its
 * right. Its placements are to be filled in by Rust.
 */
export function newPiece(o: {
  id: string;
  name: string;
  outline: OutlineNode[];
  cutIds: string[];
  origin: Vec2;
}): Piece {
  const b = outlineBox(o.outline);
  const gap = 80;
  const cuts = o.cutIds.map((id, k): Cut => ({
    id,
    ...(k === 1 ? { mirrored: true } : {}),
    placement: UNPLACED,
    layout: {
      position:
        k === 1
          ? grid([o.origin[0] + 2 * b.maxX + gap, o.origin[1]])
          : o.origin,
    },
  }));
  return {
    id: o.id,
    name: o.name,
    outline: o.outline as Piece["outline"],
    cuts: cuts as Piece["cuts"],
  };
}

// ---- the pen's snapping ----------------------------------------------------------------------

export interface Snap {
  /** Grid step, mm; 0: off. */
  step: number;
  /** How near counts as on a point or in line with it, mm. */
  near: number;
  /** The drawn piece's own points so far. */
  own: readonly P[];
  /** 15° steps from this point (Shift). */
  from?: P;
}

const ANGLE_STEP = (15 * Math.PI) / 180;

/**
 * Where the pen puts a point for the pointer at `p`: on one of the piece's own points if near
 * one; else, with `from`, on the 15° ray nearest the pointer, its length a whole number of grid
 * steps; else on the grid, lined up with the piece's own points where near.
 */
export function snapPoint(p: P, s: Snap): P {
  for (const q of s.own)
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= s.near) return q;
  const round = (x: number) =>
    s.step > 0 ? Math.round(x / s.step) * s.step : x;
  if (s.from) {
    const [fx, fy] = s.from;
    const ang =
      Math.round(Math.atan2(p[1] - fy, p[0] - fx) / ANGLE_STEP) * ANGLE_STEP;
    const len = round(Math.hypot(p[0] - fx, p[1] - fy));
    return grid([fx + len * Math.cos(ang), fy + len * Math.sin(ang)]);
  }
  let [x, y] = [round(p[0]), round(p[1])];
  let lx = Infinity;
  let ly = Infinity;
  for (const q of s.own) {
    const dx = Math.abs(p[0] - q[0]);
    const dy = Math.abs(p[1] - q[1]);
    if (dx <= s.near && dx < lx) [x, lx] = [q[0], dx];
    if (dy <= s.near && dy < ly) [y, ly] = [q[1], dy];
  }
  return grid([x, y]);
}

/** The grid step the pen snaps to at this zoom: the finest that is at least `px` pixels apart. */
export function snapStep(mmPerPx: number, px = 10): number {
  for (const step of [1, 5, 10, 50, 100]) if (step / mmPerPx >= px) return step;
  return 100;
}

/** Why the pen's closed path can't be a piece, or null. */
export function penProblem(points: readonly PenPoint[]): string | null {
  if (points.length < 3) return "a piece needs at least three points";
  return outlineProblem(penOutline(points, () => ""));
}
