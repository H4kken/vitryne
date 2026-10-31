// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Cut, Garment } from "@/format/schema.gen";
import { findCut } from "@/document/commands";
import { PLACES, placeOf } from "@/placement/places";
import { cutName } from "../cutName";

/** Where a cut starts, in a few words. */
export function whereLabel(g: Garment, cut: Cut): string {
  if (cut.state) return cut.state === "set-aside" ? "Set aside" : "Not placed";
  const p = cut.placement;
  if (p.type === "follow") {
    const on = p.cut ? findCut(g, p.cut) : undefined;
    return on ? `On the ${cutName(on.piece, on.cut)}` : "On another piece";
  }
  const place = placeOf(p);
  return place ? PLACES[place].label : (p.region ?? "Somewhere");
}
