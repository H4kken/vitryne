// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Choice } from "./ImportDialog";

export function decodeChoice(v: string): Choice {
  if (v === "leave") return { type: "leave" };
  if (v === "flat") return { type: "flat" };
  const [kind, rest] = [
    v.slice(0, v.indexOf(":")),
    v.slice(v.indexOf(":") + 1),
  ];
  if (kind === "one") return { type: "one", place: rest };
  if (kind === "pair") return { type: "pair", pair: rest };
  return { type: "on", piece: rest };
}
