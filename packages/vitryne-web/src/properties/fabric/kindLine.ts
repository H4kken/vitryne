// SPDX-License-Identifier: AGPL-3.0-or-later
import { matchingPreset } from "@/format/presets";
import type { Fabric } from "@/format/schema.gen";

/** The kind and weight of a fabric, in a few words. */
export function kindLine(f: Fabric): string {
  const kind = matchingPreset(f)?.name ?? `Custom ${f.category}`;
  return `${kind} · ${Math.round(f.density * 1000)} g/m²`;
}
