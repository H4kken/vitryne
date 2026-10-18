// SPDX-License-Identifier: AGPL-3.0-or-later

import { type MarkKind } from "@/pattern/MarkBar";
import { type PenPoint } from "@/pattern/draw";
import { type CutView, type P, pathData } from "@/pattern/geometry";
import { PointMarks } from "./PointMarks";
import { toPiece } from "./toPiece";
import { PenMarks } from "./PenMarks";
import { penPath } from "./penPath";

/**
 * The marks tool's marks on one cut, in the piece frame: the outline's points (for notches
 * and folds), the line being drawn, a fold from its first end to the pointer, the grain line
 * being dragged.
 */
export function MarkMarks({
  v,
  kind,
  line,
  fold,
  grain,
  bad,
  r,
}: {
  v: CutView;
  kind: MarkKind;
  line: { points: PenPoint[]; cursor: P | null; handle: P | null } | null;
  fold: { nodeId: string; cursor: P | null } | null;
  grain: { from: P; to: P } | null;
  bad: boolean;
  r: number;
}) {
  const blue = "#3A63F0";
  const nodes = v.piece.outline;
  const k = fold ? nodes.findIndex((n) => n.id === fold.nodeId) : -1;
  const start = nodes[k]?.position;
  const last = line?.points.at(-1);
  const end: PenPoint | null = line?.cursor
    ? { at: line.cursor, ...(line.handle ? { out: line.handle } : {}) }
    : null;
  return (
    <g pointerEvents="none">
      {(kind === "notch" || kind === "fold") && (
        <PointMarks
          piece={v.piece}
          pick={k >= 0 ? { kind: "node", k } : null}
          handles={[]}
          r={r}
        />
      )}
      {start && fold?.cursor && (
        <path
          d={pathData([start, toPiece(v, fold.cursor)], false)}
          stroke={blue}
          strokeWidth={1.6}
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {grain && (
        <path
          d={pathData([grain.from, grain.to], false)}
          stroke={blue}
          strokeWidth={2}
          strokeLinecap="round"
          markerStart="url(#grain-arrow)"
          markerEnd="url(#grain-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {line && (
        <PenMarks
          points={line.points}
          live={last && end ? penPath([last, end], false) : null}
          end={end}
          closable={false}
          bad={bad}
          r={r * 0.8}
          open
        />
      )}
    </g>
  );
}
