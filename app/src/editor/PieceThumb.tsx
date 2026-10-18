// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OutlineNode } from "@/format/schema.gen";
import { bounds, nodesPoints, type P, pathData } from "@/pattern/geometry";

export function PieceThumb({
  outline,
}: {
  outline: readonly OutlineNode[] | null;
}) {
  const pts = outline ? nodesPoints(outline) : [];
  const b = pts.length ? bounds(pts) : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 || 1;
  return (
    <svg
      width={120}
      height={120}
      viewBox={`${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      className="shrink-0 rounded-xl bg-[#F4F5F2]"
      aria-hidden="true"
    >
      {pts.length > 0 && (
        <path
          d={pathData(pts as P[], true)}
          fill="#FFFFFF"
          stroke="#14181F"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
