// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ShapeKind, shapeOutline } from "../draw";
import { nodesPoints, pathData } from "../geometry";
import { BAD } from "./constants";
import type { useShapeTool } from "./useShapeTool";

/** The shape being dragged out with the shape tool, with its sizes (red when it can't be kept). */
export function ShapePreview({
  shapePreview,
  shapeKind,
  mmPerPx,
}: {
  shapePreview: NonNullable<ReturnType<typeof useShapeTool>["shapePreview"]>;
  shapeKind: ShapeKind;
  mmPerPx: number;
}) {
  return (
    <g pointerEvents="none">
      <path
        transform={`translate(${shapePreview.origin[0]} ${-shapePreview.origin[1]})`}
        d={pathData(
          nodesPoints(shapeOutline(shapeKind, shapePreview.size, () => "")),
          true,
        )}
        fill="var(--piece-fill)"
        fillOpacity={0.7}
        stroke={shapePreview.problem ? BAD : "var(--select)"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <text
        x={shapePreview.origin[0] + shapePreview.size.width / 2}
        y={-shapePreview.origin[1] - shapePreview.size.height - 8 * mmPerPx}
        textAnchor="middle"
        fill={shapePreview.problem ? BAD : "var(--select)"}
        fontSize={12 * mmPerPx}
        className="font-sans font-semibold tabular-nums select-none"
      >
        {shapeKind === "tube"
          ? `${Math.round(shapePreview.size.top ?? 0)} / ${Math.round(shapePreview.size.width)} × ${Math.round(shapePreview.size.height)} mm`
          : `${Math.round(shapePreview.size.width)} × ${Math.round(shapePreview.size.height)} mm`}
      </text>
    </g>
  );
}
