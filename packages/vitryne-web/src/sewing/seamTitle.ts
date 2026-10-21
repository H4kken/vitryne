// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Garment, Seam } from "@/format/schema.gen";

/** A seam's title: its number in the garment. */
export function seamTitle(g: Garment, seam: Seam): string {
  return `Seam ${(g.seams ?? []).indexOf(seam) + 1}`;
}
