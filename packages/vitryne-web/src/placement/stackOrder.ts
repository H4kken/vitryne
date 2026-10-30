// SPDX-License-Identifier: AGPL-3.0-or-later
// The stack as the Layers view shows it (file-format.md, The stack): the cuts that are wrapped on the
// body, outermost first, each with the cuts placed on it nested under it. Where a drop or a step
// lands is a place in the stack (`moveInStack`); Rust says what the order means for distances.

import { followers, stackAfterMove } from "@/document/commands";
import type { Garment } from "@/format/schema.gen";

/** The cuts wrapped on the body, in stack order (closest to the body first). */
export function stackRoots(g: Garment): string[] {
  const wrapped = new Set(
    g.pieces.flatMap((p) =>
      p.cuts.filter((c) => c.placement.type === "wrap").map((c) => c.id),
    ),
  );
  return g.stack.filter((id) => wrapped.has(id));
}

/** The cuts placed directly on `id`, in stack order. */
export function stackChildren(g: Garment, id: string): string[] {
  const on = new Set(
    g.pieces.flatMap((p) =>
      p.cuts
        .filter((c) => c.placement.type === "follow" && c.placement.cut === id)
        .map((c) => c.id),
    ),
  );
  return g.stack.filter((x) => on.has(x));
}

/**
 * The place (for `moveInStack`) that puts `cutId`'s block just outside `targetId`'s block
 * (`outer`) or just inside it, or null when `targetId` is part of the block.
 */
export function dropPlace(
  g: Garment,
  cutId: string,
  targetId: string,
  outer: boolean,
): number | null {
  const block = followers(g, cutId);
  if (block.has(targetId)) return null;
  const rest = g.stack.filter((id) => !block.has(id));
  const target = followers(g, targetId);
  const at = rest.flatMap((id, k) => (target.has(id) ? [k] : []));
  if (!at.length) return null;
  return outer ? Math.max(...at) + 1 : Math.min(...at);
}

/** The place after moving `cutId` one wrapped cut outwards (`dir` 1) or inwards (-1), or null. */
export function stepPlace(
  g: Garment,
  cutId: string,
  dir: 1 | -1,
): number | null {
  const roots = stackRoots(g);
  const next = roots[roots.indexOf(cutId) + dir];
  return next === undefined ? null : dropPlace(g, cutId, next, dir === 1);
}

/** Whether moving `cutId` to place `to` changes the stack at all. */
export function moves(g: Garment, cutId: string, to: number | null): boolean {
  if (to === null) return false;
  const next = stackAfterMove(g, cutId, to);
  return next.some((id, k) => id !== g.stack[k]);
}
