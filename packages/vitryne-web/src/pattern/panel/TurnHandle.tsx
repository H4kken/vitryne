// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CutView, type P, pathData } from "../geometry";
import { HANDLE_R_PX } from "./constants";

/** A lone picked cut's dashed box, and the round handle above it that turns it. */
export function TurnHandle({
  selected,
  handle,
  mmPerPx,
}: {
  selected: CutView;
  handle: P;
  mmPerPx: number;
}) {
  return (
    <g>
      <rect
        x={selected.box.minX - 12}
        y={-selected.box.maxY - 12}
        width={selected.box.maxX - selected.box.minX + 24}
        height={selected.box.maxY - selected.box.minY + 24}
        fill="none"
        stroke="var(--select)"
        strokeWidth={1.5}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={pathData([[handle[0], selected.box.maxY + 12], handle], false)}
        stroke="var(--select)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={handle[0]}
        cy={-handle[1]}
        r={HANDLE_R_PX * mmPerPx}
        fill="var(--piece-fill)"
        stroke="var(--select)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className="cursor-grab"
      >
        <title>Drag to turn (Shift: 15° steps)</title>
      </circle>
    </g>
  );
}
