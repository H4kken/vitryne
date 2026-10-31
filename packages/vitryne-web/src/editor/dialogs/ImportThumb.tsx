// SPDX-License-Identifier: AGPL-3.0-or-later
import { bounds, type P, pathData } from "@/pattern/geometry";

export function ImportThumb({
  outline,
  size = 56,
}: {
  outline: readonly P[];
  size?: number;
}) {
  const b = bounds(outline as P[]);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      className="shrink-0 rounded-lg bg-hover"
      aria-hidden="true"
    >
      <path
        d={pathData(outline as P[], true)}
        fill="#FFFFFF"
        stroke="#14181F"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
