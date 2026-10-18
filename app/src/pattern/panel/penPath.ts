// SPDX-License-Identifier: AGPL-3.0-or-later

import { type PenPoint, penEdge } from "@/pattern/draw";
import { flattenCubic, type P } from "@/pattern/geometry";

/** The pen's points joined by the edges it draws, as one polyline (`closed`: back to the first). */
export function penPath(points: readonly PenPoint[], closed: boolean): P[] {
  const out: P[] = [];
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const a = points[k] as PenPoint;
    out.push(a.at);
    if (k + 1 === n && !closed) break;
    const b = points[(k + 1) % n] as PenPoint;
    const e = penEdge(a, b);
    if (e.type === "cubic")
      out.push(...flattenCubic(a.at, e.controls[0], e.controls[1], b.at));
  }
  if (closed && points[0]) out.push(points[0].at);
  return out;
}
