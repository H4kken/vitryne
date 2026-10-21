// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CutView } from "../geometry";

/** A cut's name in the flat view: its own, else its piece's. */
export function cutLabel(v: CutView): string {
  return v.cut.name ?? v.piece.name;
}
