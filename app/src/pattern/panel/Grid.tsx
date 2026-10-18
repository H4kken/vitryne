// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Box } from "@/pattern/geometry";

/** The piece drawn in its own frame (the group around it mirrors, turns and moves it). */
/** The grid's steps, in millimetres, like millimetre paper: 1, 5 and 10 mm, then on by 5 and 2. */
const GRID_STEPS_MM = [1, 5, 10, 50, 100, 500, 1000, 5000];

/** A step's lines show from this spacing on screen, and reach full strength at the second. */
const GRID_MIN_PX = 5;

const GRID_FULL_PX = 80;

/**
 * Millimetre paper under the pieces, in pattern millimetres (the origin is the layout's): each
 * step fades in as zooming spreads its lines, and the coarser steps fall on the finer ones' lines
 * so every 5th and 10th line reads darker.
 */
export function Grid({ box, mmPerPx }: { box: Box; mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  return (
    <g
      fill="none"
      stroke="#7F8B78"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      shapeRendering="crispEdges"
      pointerEvents="none"
    >
      {GRID_STEPS_MM.map((step) => {
        const px = step / mmPerPx;
        if (
          px < GRID_MIN_PX ||
          px > Math.max(box.maxX - box.minX, box.maxY - box.minY) / mmPerPx
        )
          return null;
        const strength = Math.min(
          1,
          (px - GRID_MIN_PX) / (GRID_FULL_PX - GRID_MIN_PX),
        );
        let d = "";
        for (
          let x = Math.ceil(box.minX / step) * step;
          x <= box.maxX;
          x += step
        )
          d += `M${x} ${box.minY}V${box.maxY}`;
        for (
          let y = Math.ceil(box.minY / step) * step;
          y <= box.maxY;
          y += step
        )
          d += `M${box.minX} ${y}H${box.maxX}`;
        return (
          <path
            key={step}
            d={d}
            vectorEffect="non-scaling-stroke"
            strokeOpacity={0.06 + 0.3 * strength}
          />
        );
      })}
    </g>
  );
}
