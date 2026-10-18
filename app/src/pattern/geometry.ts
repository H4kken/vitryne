// SPDX-License-Identifier: AGPL-3.0-or-later
// Cheap 2D geometry for drawing the pattern (docs/ARCHITECTURE.md: TypeScript only draws;
// anything algorithmic is asked of the worker). Pattern coordinates are mm, +y up.

import type {
  Cut,
  Edge,
  Garment,
  Line,
  OutlineNode,
  Piece,
} from "@/format/schema.gen";

export type P = readonly [number, number];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How far a flattened curve may stray, mm (Rust `CURVE_TOLERANCE_MM`). */
const CURVE_TOLERANCE_MM = 0.1;
const CURVE_MAX_SEGMENTS = 256;

/** Rust's `round_mm`: 0.001 mm, halves away from zero, no -0. */
export function roundMm(x: number): number {
  return (Math.sign(x) * Math.round(Math.abs(x) * 1000)) / 1000 + 0;
}

/**
 * A cubic Bézier as the points strictly between its ends: Rust's `flatten_cubic` (same count,
 * same parameters, same grid), so the view shows the curve the mesher uses.
 */
export function flattenCubic(p0: P, c1: P, c2: P, p3: P): P[] {
  const dd = (a: P, b: P, c: P) =>
    Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);
  const m = Math.max(dd(p0, c1, c2), dd(c1, c2, p3));
  const raw = Math.ceil(Math.sqrt((0.75 * m) / CURVE_TOLERANCE_MM));
  const n = Number.isFinite(raw)
    ? Math.min(Math.max(raw, 1), CURVE_MAX_SEGMENTS)
    : 1;
  const out: P[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const u = 1 - t;
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push([
      roundMm(a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0]),
      roundMm(a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]),
    ]);
  }
  return out;
}

/** The points strictly between an edge's node `from` and the next node `to` (Rust `Edge::interior`). */
export function edgeInterior(edge: Edge | undefined, from: P, to: P): P[] {
  if (!edge) return [];
  if (edge.type === "cubic")
    return flattenCubic(from, edge.controls[0], edge.controls[1], to);
  return edge.points as P[];
}

/** The outline as a closed polyline: each node, then its edge's points. */
export function outlinePoints(piece: Piece): P[] {
  return nodesPoints(piece.outline);
}

/** `outlinePoints` of a loop of nodes (Rust `outline_points`). */
export function nodesPoints(nodes: readonly OutlineNode[]): P[] {
  const pts: P[] = [];
  nodes.forEach((n, k) => {
    pts.push(n.position);
    const next = nodes[(k + 1) % nodes.length] ?? n;
    pts.push(...edgeInterior(n.edge, n.position, next.position));
  });
  return pts;
}

/**
 * The stretch of the outline from node `from` to node `to`, counter-clockwise (the outline's
 * order) or clockwise, with its edge points. Empty if either node isn't on the outline.
 */
export function runPoints(
  piece: Piece,
  from: string,
  to: string,
  ccw: boolean,
): P[] {
  const nodes = piece.outline as OutlineNode[];
  const n = nodes.length;
  let i = nodes.findIndex((x) => x.id === from);
  const end = nodes.findIndex((x) => x.id === to);
  const first = nodes[i];
  if (!first || end < 0) return [];
  const pts: P[] = [first.position];
  const inner = (k: number) => {
    const a = nodes[k];
    const b = nodes[(k + 1) % n];
    return a && b ? edgeInterior(a.edge, a.position, b.position) : [];
  };
  for (let steps = 0; i !== end && steps <= n; steps++) {
    if (ccw) {
      pts.push(...inner(i));
      i = (i + 1) % n;
    } else {
      i = (i + n - 1) % n;
      // A copy: a polyline's points are the document's own (frozen) array.
      pts.push(...[...inner(i)].reverse());
    }
    const there = nodes[i];
    if (there) pts.push(there.position);
  }
  return pts;
}

/** Distance from `p` to the polyline `pts`. */
export function distToPolyline([px, py]: P, pts: readonly P[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export function linePoints(line: Line): P[] {
  const pts: P[] = [];
  line.nodes.forEach((n, k) => {
    pts.push(n.position);
    const next = line.nodes[k + 1];
    if (next) pts.push(...edgeInterior(n.edge, n.position, next.position));
  });
  return pts;
}

export function bounds(pts: readonly P[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** SVG path data, y flipped (SVG's y points down). */
export function pathData(pts: readonly P[], closed: boolean): string {
  if (!pts.length) return "";
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`)
    .join(" ");
  return closed ? `${d} Z` : d;
}

/**
 * Where a cut sits in the flat view: its points (mirrored first, for a mirrored cut) are
 * turned by `rot` (radians, counter-clockwise) about the piece's origin, then moved by
 * (`x`, `y`) mm. The file's `cut.layout` is this (FORMAT.md, Cuts).
 */
export interface Transform {
  x: number;
  y: number;
  rot: number;
}

export function apply(t: Transform, [px, py]: P): P {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return [c * px - s * py + t.x, s * px + c * py + t.y];
}

/** The point of the cut's (mirrored) frame that `apply` takes to `p`. */
export function unapply(t: Transform, [px, py]: P): P {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  const x = px - t.x;
  const y = py - t.y;
  return [c * x + s * y, -s * x + c * y];
}

/** A cut's outline in its own frame: the piece's, mirrored (x -> -x) for a mirrored cut. */
export function cutOutline(piece: Piece, cut: Cut): P[] {
  const pts = outlinePoints(piece);
  return cut.mirrored ? pts.map(([x, y]) => [-x, y] as P) : pts;
}

export interface CutView {
  piece: Piece;
  cut: Cut;
  /** `cutOutline`. */
  pts: P[];
  t: Transform;
  /** Where it is in the view (its outline's box after `t`). */
  box: Box;
}

/**
 * Every cut, where its layout says, or else laid out side by side in rows, about as wide as
 * tall overall (cuts without a layout don't move when another one is moved).
 */
export function layoutCuts(
  g: Garment | undefined,
  gap = 80,
  /** Where cuts without a layout were put before, kept (so editing a piece doesn't shuffle them). */
  keep?: ReadonlyMap<string, Transform>,
): { cuts: CutView[]; box: Box } {
  const items = (g?.pieces ?? []).flatMap((piece) =>
    piece.cuts.map((cut) => {
      const pts = cutOutline(piece, cut);
      return { piece, cut, pts, own: bounds(pts) };
    }),
  );
  const area = items.reduce(
    (a, { own }) =>
      a + (own.maxX - own.minX + gap) * (own.maxY - own.minY + gap),
    0,
  );
  const rowWidth = Math.max(
    Math.sqrt(area) * 1.4,
    ...items.map(({ own }) => own.maxX - own.minX),
  );
  const cuts: CutView[] = [];
  let x = 0,
    y = 0,
    rowH = 0;
  for (const { piece, cut, pts, own } of items) {
    const w = own.maxX - own.minX;
    const h = own.maxY - own.minY;
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y -= rowH + gap;
      rowH = 0;
    }
    // Top-left of the cut's box at (x, y), unless the file says where it is.
    const auto: Transform = { x: x - own.minX, y: y - own.maxY, rot: 0 };
    x += w + gap;
    rowH = Math.max(rowH, h);
    const l = cut.layout;
    const t: Transform = l?.position
      ? { x: l.position[0], y: l.position[1], rot: l.rotation ?? 0 }
      : (keep?.get(cut.id) ?? auto);
    cuts.push({ piece, cut, pts, t, box: bounds(pts.map((p) => apply(t, p))) });
  }
  // Nothing yet: a metre square around the origin, where a first piece is drawn.
  if (!cuts.length)
    return { cuts, box: { minX: -500, minY: -500, maxX: 500, maxY: 500 } };
  const box = bounds(
    cuts.flatMap(
      ({ box }) =>
        [
          [box.minX, box.minY],
          [box.maxX, box.maxY],
        ] as P[],
    ),
  );
  return { cuts, box };
}

/** Point-in-polygon (even-odd), for picking a piece. */
export function inside([x, y]: P, poly: readonly P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      c = !c;
  }
  return c;
}
