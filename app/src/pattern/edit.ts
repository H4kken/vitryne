// SPDX-License-Identifier: AGPL-3.0-or-later
// Editing outlines: the cheap geometry behind the point tool's commands (moving, adding and
// removing nodes, straight and curved edges, typed lengths), and the outline check Rust makes
// (vitryne-format `check_outline_shape`), so a move Rust would refuse is caught before it
// becomes a command. Every coordinate written is on the format's 0.001 mm grid.

import type { CubicEdge, Edge, OutlineNode, Vec2 } from "@/format/schema.gen";
import { edgeInterior, nodesPoints, type P, roundMm } from "./geometry";

export type Nodes = readonly OutlineNode[];

/** Two outline nodes closer than this are in the same place, mm (Rust `SAME_PLACE_MM`). */
const SAME_PLACE_MM = 0.01;
/** A point added on an edge stays this far from its ends, mm. */
const MIN_SPLIT_MM = 0.5;

const grid = (p: P): Vec2 => [roundMm(p[0]), roundMm(p[1])];
const lerp = (a: P, b: P, t: number): P => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const add = (a: P, d: P): P => [a[0] + d[0], a[1] + d[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];

function at<T>(list: readonly T[], k: number): T {
  const n = list.length;
  const x = list[((k % n) + n) % n];
  if (x === undefined) throw new Error("empty outline");
  return x;
}

export function isStraight(edge: Edge): boolean {
  return edge.type === "polyline" && edge.points.length === 0;
}

/** The edge from node `k` as points, from its node to the next one. */
export function edgePoints(nodes: Nodes, k: number): P[] {
  const a = at(nodes, k);
  const b = at(nodes, k + 1);
  return [
    a.position,
    ...edgeInterior(a.edge, a.position, b.position),
    b.position,
  ];
}

/** The edge's length as drawn (curves flattened as the mesher does), mm. */
export function edgeLength(nodes: Nodes, k: number): number {
  const pts = edgePoints(nodes, k);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(at(pts, i - 1), at(pts, i));
  return len;
}

/** The point of the edge from node `k` nearest to `p`: which segment, how far along it, how far away. */
export function nearestOnEdge(
  nodes: Nodes,
  k: number,
  p: P,
): { point: P; segment: number; u: number; d: number } {
  const pts = edgePoints(nodes, k);
  let best = { point: pts[0] ?? p, segment: 0, u: 0, d: Infinity };
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = at(pts, s);
    const b = at(pts, s + 1);
    const [dx, dy] = sub(b, a);
    const u = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    const q = lerp(a, b, u);
    const d = dist(p, q);
    if (d < best.d) best = { point: q, segment: s, u, d };
  }
  return best;
}

/**
 * A new node `id` (a plain point) on the edge from node `k`, where it passes nearest to `p`.
 * The shape doesn't change: a curve is split exactly (de Casteljau), a polyline keeps its
 * points on either side. Null if that is too near either end.
 */
export function splitEdge(
  nodes: Nodes,
  k: number,
  p: P,
  id: string,
): OutlineNode[] | null {
  const a = at(nodes, k);
  const b = at(nodes, k + 1);
  const near = nearestOnEdge(nodes, k, p);
  let first: Edge;
  let second: Edge;
  let position: Vec2;
  if (a.edge.type === "cubic") {
    const segments = edgePoints(nodes, k).length - 1;
    const t = (near.segment + near.u) / segments;
    const [c1, c2] = a.edge.controls;
    const p01 = lerp(a.position, c1, t);
    const p12 = lerp(c1, c2, t);
    const p23 = lerp(c2, b.position, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    position = grid(lerp(p012, p123, t));
    first = { type: "cubic", controls: [grid(p01), grid(p012)] };
    second = { type: "cubic", controls: [grid(p123), grid(p23)] };
  } else {
    position = grid(near.point);
    const inner = a.edge.points;
    // Segment s runs from point s to point s + 1 of [a, ...inner, b].
    const before = inner.slice(0, near.segment);
    const after = inner.slice(near.segment);
    // On an existing point: that point becomes the node.
    const same = (q: Vec2 | undefined) =>
      q !== undefined && dist(q, position) < SAME_PLACE_MM;
    if (same(before.at(-1))) before.pop();
    if (same(after[0])) after.shift();
    first = { ...a.edge, points: before };
    second = { type: "polyline", points: after };
  }
  if (
    dist(position, a.position) < MIN_SPLIT_MM ||
    dist(position, b.position) < MIN_SPLIT_MM
  )
    return null;
  const node: OutlineNode = { id, type: "point", position, edge: second };
  const out = [...nodes];
  out[k] = { ...a, edge: first };
  out.splice(k + 1, 0, node);
  return out;
}

/** A curve's handle at `from`, pointing at `towards`, a third of `span` long. */
function tangentHandle(from: P, towards: P, span: number): Vec2 {
  const d = dist(from, towards) || 1;
  return grid(
    add(from, [
      ((towards[0] - from[0]) / d) * (span / 3),
      ((towards[1] - from[1]) / d) * (span / 3),
    ]),
  );
}

/**
 * Node `k` taken out: the edge before it now runs to the node after it. Two polylines join
 * (without the node's own position); if either was a curve, the join is one curve leaving and
 * arriving as the two did.
 */
export function joinEdges(nodes: Nodes, k: number): OutlineNode[] {
  const n = nodes.length;
  const j = (k + n - 1) % n;
  const a = at(nodes, j);
  const m = at(nodes, k);
  const b = at(nodes, k + 1);
  let edge: Edge;
  if (a.edge.type === "polyline" && m.edge.type === "polyline") {
    edge = { ...a.edge, points: [...a.edge.points, ...m.edge.points] };
  } else {
    const span = dist(a.position, b.position);
    const c1 =
      a.edge.type === "cubic"
        ? a.edge.controls[0]
        : tangentHandle(a.position, a.edge.points[0] ?? m.position, span);
    const c2 =
      m.edge.type === "cubic"
        ? m.edge.controls[1]
        : tangentHandle(b.position, m.edge.points.at(-1) ?? m.position, span);
    edge = { type: "cubic", controls: [c1, c2] };
  }
  const out = nodes.filter((_, i) => i !== k);
  out[j < k ? j : j - 1] = { ...a, edge };
  return out;
}

/**
 * Nodes moved to new places (by id). A curve's handles go with their node; a polyline's points
 * follow both its ends, each by the share of the edge it sits at, so an imported curve keeps
 * its shape. Nodes and edges that don't change stay the same objects.
 */
export function moveNodes(
  nodes: Nodes,
  to: ReadonlyMap<string, P>,
): OutlineNode[] {
  const delta = (node: OutlineNode): P => {
    const q = to.get(node.id);
    return q ? sub(grid(q), node.position) : [0, 0];
  };
  return nodes.map((a, k) => {
    const b = at(nodes, k + 1);
    const da = delta(a);
    const db = delta(b);
    const still = (d: P) => d[0] === 0 && d[1] === 0;
    if (still(da) && still(db)) return a;
    let edge = a.edge;
    if (edge.type === "cubic") {
      const [c1, c2] = edge.controls;
      edge = { ...edge, controls: [grid(add(c1, da)), grid(add(c2, db))] };
    } else if (edge.points.length) {
      const pts = [a.position, ...edge.points, b.position];
      const along = [0];
      for (let i = 1; i < pts.length; i++)
        along.push(at(along, i - 1) + dist(at(pts, i - 1), at(pts, i)));
      const total = at(along, -1) || 1;
      edge = {
        ...edge,
        points: edge.points.map((q, i) =>
          grid(add(q, lerp(da, db, at(along, i + 1) / total))),
        ),
      };
    }
    if (still(da) && edge === a.edge) return a;
    return { ...a, position: grid(add(a.position, da)), edge };
  });
}

/** A straight edge. */
export function straightEdge(): Edge {
  return { type: "polyline", points: [] };
}

/**
 * The edge from node `k` made a curve: handles a third of the way along, leaving each end the
 * way the edge did (a straight edge stays straight until its handles are dragged).
 */
export function curvedEdge(nodes: Nodes, k: number): CubicEdge {
  const a = at(nodes, k);
  const b = at(nodes, k + 1);
  if (a.edge.type === "cubic") return a.edge;
  const span = dist(a.position, b.position);
  return {
    type: "cubic",
    controls: [
      tangentHandle(a.position, a.edge.points[0] ?? b.position, span),
      tangentHandle(b.position, a.edge.points.at(-1) ?? a.position, span),
    ],
  };
}

/** The edge from node `k` with one of its curve's handles (0: at node `k`, 1: at the next) at `p`. */
export function withControl(
  nodes: Nodes,
  k: number,
  which: 0 | 1,
  p: P,
): OutlineNode[] {
  return nodes.map((n, i) => {
    if (i !== k || n.edge.type !== "cubic") return n;
    const controls: [Vec2, Vec2] = [...n.edge.controls];
    controls[which] = grid(p);
    return { ...n, edge: { ...n.edge, controls } };
  });
}

/** The point `share` (0 to 1) of the way along the edge from node `k`, by length. */
export function pointAlong(nodes: Nodes, k: number, share: number): P {
  const pts = edgePoints(nodes, k);
  let left = edgeLength(nodes, k) * share;
  for (let i = 1; i < pts.length; i++) {
    const a = at(pts, i - 1);
    const b = at(pts, i);
    const d = dist(a, b);
    if (d >= left && d > 0) return lerp(a, b, left / d);
    left -= d;
  }
  return at(pts, -1);
}

/** Where the end node of the straight edge from node `k` goes for the edge to be `length` mm. */
export function endForLength(nodes: Nodes, k: number, length: number): Vec2 {
  const a = at(nodes, k).position;
  const b = at(nodes, k + 1).position;
  const d = dist(a, b) || 1;
  return grid(
    add(a, [((b[0] - a[0]) / d) * length, ((b[1] - a[1]) / d) * length]),
  );
}

// ---- the shape check: Rust's, so a drag Rust would refuse shows red instead ------------------

/**
 * Why Rust would refuse this outline (vitryne-format `check_outline_shape`: no two consecutive
 * nodes in the same place on a straight edge, counter-clockwise, never crossing or touching
 * itself), or null.
 */
export function outlineProblem(nodes: Nodes): string | null {
  for (const [k, a] of nodes.entries()) {
    const b = at(nodes, k + 1);
    const straight = a.edge.type === "cubic" || isStraight(a.edge);
    if (dist(a.position, b.position) < SAME_PLACE_MM && straight)
      return "two points are in the same place";
  }
  const pts: P[] = [];
  for (const p of nodesPoints(nodes)) {
    const last = pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  const [first, last] = [pts[0], pts.at(-1)];
  if (
    pts.length > 1 &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
  )
    pts.pop();
  if (pts.length < 3) return "the outline has no area";
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = at(pts, i);
    const b = at(pts, i + 1);
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area <= 0)
    return area === 0
      ? "the outline has no area"
      : "the outline runs clockwise; it must run counter-clockwise";
  return selfCrossing(pts) ? "the outline would cross itself" : null;
}

/** Whether two non-adjacent segments of the closed polygon `pts` cross or touch (Rust `self_crossing`). */
function selfCrossing(pts: readonly P[]): boolean {
  const n = pts.length;
  const seg = (i: number): [P, P] => [at(pts, i), at(pts, i + 1)];
  const lo = (i: number) => Math.min(at(pts, i)[0], at(pts, i + 1)[0]);
  const hi = (i: number) => Math.max(at(pts, i)[0], at(pts, i + 1)[0]);
  const order = [...Array(n).keys()].sort((a, b) => lo(a) - lo(b) || a - b);
  for (let k = 0; k < n; k++) {
    const i = at(order, k);
    for (let m = k + 1; m < n; m++) {
      const j = at(order, m);
      if (lo(j) > hi(i)) break;
      const adjacent = (i + 1) % n === j || (j + 1) % n === i;
      if (!adjacent && segmentsMeet(seg(i), seg(j))) return true;
    }
  }
  return false;
}

function orient(a: P, b: P, c: P): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsMeet([a, b]: [P, P], [c, d]: [P, P]): boolean {
  const within = (p: P, q: P, r: P) =>
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  const [d1, d2] = [orient(c, d, a), orient(c, d, b)];
  const [d3, d4] = [orient(a, b, c), orient(a, b, d)];
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  )
    return true;
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}
