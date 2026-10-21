// SPDX-License-Identifier: AGPL-3.0-or-later
import { DrawBar } from "../DrawBar";
import { type P, roundMm } from "../geometry";
import type { usePen } from "./usePen";

/** The pen's bar: the edge being drawn (or typed), undo, close and cancel. */
export function PenDrawBar({
  penTool,
}: {
  penTool: ReturnType<typeof usePen>;
}) {
  const { pen, setPen, closePen, lastPen, liveLength, liveAngle } = penTool;
  return (
    <DrawBar
      key={pen.points.length}
      points={pen.points.length}
      length={liveLength}
      angle={liveAngle}
      warning={
        pen.problem ? `Can't make this a piece: ${pen.problem}` : undefined
      }
      onPlace={(mm, deg) => {
        if (!lastPen) return;
        const a = (deg * Math.PI) / 180;
        const at: P = [
          roundMm(lastPen.at[0] + mm * Math.cos(a)),
          roundMm(lastPen.at[1] + mm * Math.sin(a)),
        ];
        setPen((x) => ({
          ...x,
          points: [...x.points, { at }],
          cursor: at,
          problem: null,
        }));
      }}
      onUndo={() =>
        setPen((x) => ({
          ...x,
          points: x.points.slice(0, -1),
          problem: null,
        }))
      }
      onClose={() => closePen(pen.points)}
      onCancel={() =>
        setPen({ points: [], cursor: null, handle: null, problem: null })
      }
    />
  );
}
