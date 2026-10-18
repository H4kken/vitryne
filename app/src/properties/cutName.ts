// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Cut, Piece } from "@/format/schema.gen";

/** A cut's name as people see it: its own, or its piece's. */
export function cutName(piece: Piece, cut: Cut): string {
  return cut.name ?? piece.name;
}
