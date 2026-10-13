// SPDX-License-Identifier: AGPL-3.0-or-later
// Cheap 2D geometry for drawing the pattern (docs/ARCHITECTURE.md: TypeScript only draws;
// anything algorithmic is asked of the worker). Pattern coordinates are mm, +y up.

import type { Line, OutlineNode, Piece } from '@/format/schema.gen';

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

export interface Placed {
  piece: Piece;
  /** Offset added to the piece's coordinates in the view (display only, never saved). */
  dx: number;
  dy: number;
  box: Box;
}

/**
 * Lays the pieces out side by side in rows, about as wide as tall overall (the file's own
 * layout, `cut.layout`, comes with M7's piece moving).
 */
export function layoutPieces(pieces: readonly Piece[], gap = 40): { placed: Placed[]; box: Box } {
  const items = pieces.map((piece) => ({ piece, box: bounds(outlinePoints(piece)) }));
  const area = items.reduce((a, { box }) => a + (box.maxX - box.minX + gap) * (box.maxY - box.minY + gap), 0);
  const rowWidth = Math.max(Math.sqrt(area) * 1.4, ...items.map(({ box }) => box.maxX - box.minX));
  const placed: Placed[] = [];
  let x = 0,
    y = 0,
    rowH = 0;
  for (const { piece, box } of items) {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y -= rowH + gap;
      rowH = 0;
    }
    // Top-left of the piece's box at (x, y).
    placed.push({ piece, dx: x - box.minX, dy: y - box.maxY, box: { minX: x, maxX: x + w, minY: y - h, maxY: y } });
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  return { placed, box: bounds(placed.flatMap(({ box }) => [[box.minX, box.minY], [box.maxX, box.maxY]] as P[])) };
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
