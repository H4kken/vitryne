// SPDX-License-Identifier: AGPL-3.0-or-later
// Cheap 2D geometry for drawing the pattern (docs/ARCHITECTURE.md: TypeScript only draws;
// anything algorithmic is asked of the worker). Pattern coordinates are mm, +y up.

import type { Cut, Garment, Line, OutlineNode, Piece } from '@/format/schema.gen';

export type P = readonly [number, number];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The outline as a closed polyline: each node, then its edge's points. */
export function outlinePoints(piece: Piece): P[] {
  const pts: P[] = [];
  for (const n of piece.outline as OutlineNode[]) {
    pts.push(n.position);
    for (const q of n.edge.points ?? []) pts.push(q as P);
  }
  return pts;
}

export function linePoints(line: Line): P[] {
  const pts: P[] = [];
  for (const n of line.nodes) {
    pts.push(n.position);
    for (const q of n.edge?.points ?? []) pts.push(q as P);
  }
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
  if (!pts.length) return '';
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' ');
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
export function layoutCuts(g: Garment | undefined, gap = 80): { cuts: CutView[]; box: Box } {
  const items = (g?.pieces ?? []).flatMap((piece) =>
    piece.cuts.map((cut) => {
      const pts = cutOutline(piece, cut);
      return { piece, cut, pts, own: bounds(pts) };
    }),
  );
  const area = items.reduce((a, { own }) => a + (own.maxX - own.minX + gap) * (own.maxY - own.minY + gap), 0);
  const rowWidth = Math.max(Math.sqrt(area) * 1.4, ...items.map(({ own }) => own.maxX - own.minX));
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
    const t: Transform = l?.position ? { x: l.position[0], y: l.position[1], rot: l.rotation ?? 0 } : auto;
    cuts.push({ piece, cut, pts, t, box: bounds(pts.map((p) => apply(t, p))) });
  }
  const box = bounds(cuts.flatMap(({ box }) => [[box.minX, box.minY], [box.maxX, box.maxY]] as P[]));
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
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
