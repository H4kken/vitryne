// SPDX-License-Identifier: AGPL-3.0-or-later

import { type PenPoint } from "@/pattern/draw";
import { type P, pathData } from "@/pattern/geometry";
import { BAD, CONTROL_PX, NODE_PX } from "./constants";
import { penPath } from "./penPath";

/**
 * The piece being drawn, in view coordinates: its edges so far, the edge to the pointer, the
 * points (the first one ringed when a click there closes the piece) and the handle being
 * dragged.
 */
export function PenMarks({
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
  const blue = "var(--select)";
  const ink = bad ? BAD : "var(--foreground)";
  const first = points[0];
  const dot = (p: P, key: string, on = false) => (
    <rect
      key={key}
      x={p[0] - r}
      y={-p[1] - r}
      width={2 * r}
      height={2 * r}
      fill={on ? blue : "var(--piece-fill)"}
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
            fill="var(--piece-fill)"
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
