// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OutlineNode } from "@/format/schema.gen";

/** A curve's handle: of the edge from node `k`, 0 at its start, 1 at its end. */
export interface Handle {
  k: number;
  which: 0 | 1;
}

/** The handles shown for a pick: the picked edge's, or those at the picked node. */
export function pickHandles(
  nodes: readonly OutlineNode[],
  pick: { kind: "node" | "edge"; k: number } | null,
): Handle[] {
  if (!pick) return [];
  const n = nodes.length;
  const all: Handle[] =
    pick.kind === "edge"
      ? [
          { k: pick.k, which: 0 },
          { k: pick.k, which: 1 },
        ]
      : [
          { k: pick.k, which: 0 },
          { k: (pick.k + n - 1) % n, which: 1 },
        ];
  return all.filter((h) => nodes[h.k]?.edge.type === "cubic");
}
