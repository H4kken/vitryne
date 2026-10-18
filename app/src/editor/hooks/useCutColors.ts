// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from "react";
import { cutColor } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { Garment } from "@/format/schema.gen";

/** Each coloured cut's colour, by cut id: the flat view shows each cut in its colour. */
export function useCutColors(entities: Entities, garment: Garment | undefined) {
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const p of garment?.pieces ?? []) {
      for (const c of p.cuts) {
        const color = garment && cutColor(entities, garment, c);
        if (color) out.set(c.id, color);
      }
    }
    return out;
  }, [entities, garment]);
}
