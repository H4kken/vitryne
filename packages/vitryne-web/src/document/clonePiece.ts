// SPDX-License-Identifier: AGPL-3.0-or-later
// A copy of a piece for pasting: a new piece of one cut (the copied cut's fabric and look, not
// mirrored, not yet placed), with fresh ids all through. Ids are unique across the file, and the
// folds name outline nodes, so those are remapped together.

import type { Cut, Piece } from "@/format/schema.gen";

export function clonePiece(
  piece: Piece,
  cut: Cut,
  o: { id: () => string; name: string },
): Piece {
  const ids = new Map(piece.outline.map((n) => [n.id, o.id()]));
  const to = (id: string) => ids.get(id) ?? id;
  const copy = structuredClone(piece);
  delete copy.source; // it names a piece of the imported source, which this is not
  return {
    ...copy,
    id: o.id(),
    name: o.name,
    outline: copy.outline.map((n) => ({
      ...n,
      id: to(n.id),
    })) as Piece["outline"],
    ...(copy.lines
      ? {
          lines: copy.lines.map((l) => ({
            ...l,
            id: o.id(),
            nodes: l.nodes.map((n) => ({ ...n, id: o.id() })),
          })) as NonNullable<Piece["lines"]>,
        }
      : {}),
    ...(copy.folds
      ? {
          folds: copy.folds.map((f) => ({
            ...f,
            id: o.id(),
            from: to(f.from),
            to: to(f.to),
          })),
        }
      : {}),
    cuts: [
      {
        id: o.id(),
        ...(cut.name ? { name: cut.name } : {}),
        ...(cut.fabric ? { fabric: cut.fabric } : {}),
        ...(cut.appearance ? { appearance: cut.appearance } : {}),
        placement: cut.placement,
        ...(cut.layout ? { layout: structuredClone(cut.layout) } : {}),
      },
    ],
  };
}
