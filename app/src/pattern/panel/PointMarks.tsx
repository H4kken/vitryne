// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Piece } from "@/format/schema.gen";
import { edgePoints } from "@/pattern/edit";
import { pathData } from "@/pattern/geometry";
import type { Handle } from "./pickHandles";
import { CONTROL_PX, NODE_PX } from "./constants";

/**
 * The point tool's marks on one cut, in the piece frame: every node (a square for a corner, a
 * diamond for a notch, a dot for a plain point), the picked edge, and the handles of the
 * curves at the pick.
 */
export function PointMarks({
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
