// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OutlineNode, Piece } from "@/format/schema.gen";
import {
  linePoints,
  outlinePoints,
  edgeInterior,
  type P,
  pathData,
} from "@/pattern/geometry";
import type { MarkPick } from "./types";
import { BAD } from "./constants";

const NOTCH_MM = 10;

/**
 * `color`: the cut's own (its appearance), drawn light so the lines stay readable. `bad`: an
 * outline being dragged into a shape that can't be kept.
 */
export function PieceDrawing({
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
      ? { stroke: "var(--select)", strokeWidth: 3.5 }
      : { stroke: "var(--line)", strokeWidth: 1.6 };
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
      <path
        d={pathData(outline, true)}
        fill="var(--piece-fill)"
        stroke="none"
      />
      <path
        d={pathData(outline, true)}
        fill={color ?? "none"}
        fillOpacity={0.55}
        stroke={bad ? BAD : "var(--foreground)"}
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
          stroke="var(--foreground)"
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
