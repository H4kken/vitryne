// SPDX-License-Identifier: AGPL-3.0-or-later

import { type CutView, type P, unapply } from "@/pattern/geometry";

/** A point of the view (mm, y up) in the cut's piece frame (before mirroring and layout). */
export function toPiece(v: CutView, p: P): P {
  const q = unapply(v.t, p);
  return v.cut.mirrored ? [-q[0], q[1]] : q;
}
