// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Choice } from "./ImportDialog";

export function encodeChoice(c: Choice): string {
  switch (c.type) {
    case "leave":
      return "leave";
    case "one":
      return `one:${c.place}`;
    case "unplaced":
      return "unplaced";
    case "flat":
      return "flat";
    case "pair":
      return `pair:${c.pair}`;
    case "on":
      return `on:${c.piece}`;
  }
}
