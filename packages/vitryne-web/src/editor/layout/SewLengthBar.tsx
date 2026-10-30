// SPDX-License-Identifier: AGPL-3.0-or-later
// The header of the flat view while the Sew tool is on: what to do, and the whole edge under the
// pointer with its length (the first edge once it is picked, then the second). Each length is
// shown on its own, with no difference between them and no colour for "matches". A live
// comparison would be allowed without a snap (packages/vitryne-docs/content/docs/developers/patents.md
// rule 1); this is the stricter design choice.

import type { Garment } from "@/format/schema.gen";
import { type CutEdge, cutLabel, formatLength, sameEdge } from "@/sewing/api";

export function SewLengthBar(props: {
  garment: Garment;
  /** The first edge, once picked. */
  picked: CutEdge[];
  /** The free edge under the pointer. */
  hovered: CutEdge | null;
  /** The first side is done: the next pick is the second. */
  second: boolean;
}) {
  const { garment, hovered, second } = props;
  // Each edge once, whatever the picks hold.
  const picked = props.picked.filter(
    (e, i, all) =>
      all.findIndex((x) => x.cut === e.cut && x.from === e.from) === i,
  );
  const first = picked[0];
  // The edge already picked, pointed at again: clicking it takes it back, it can't be the other side.
  const itself =
    second && !!hovered && picked.some((e) => sameEdge(e, hovered));
  const row = (label: string, edge: CutEdge) => (
    <div
      // A new edge is a new row, so it fades in again. The label is in the key: the edge under
      // the pointer is often the one just picked, and two siblings with one key pile up rows.
      key={`${label}:${edge.cut}:${edge.from}:${edge.to}`}
      className="animate-in fade-in slide-in-from-top-1 flex items-baseline gap-2 duration-150"
    >
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <span className="text-[14px] font-semibold">
        {cutLabel(garment, edge.cut)}
      </span>
      <span className="text-[14px] tabular-nums">
        {formatLength(edge.length)}
      </span>
    </div>
  );
  return (
    <div className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2">
      <div className="animate-in fade-in slide-in-from-top-2 bg-card/95 flex min-h-11 min-w-56 flex-col justify-center gap-0.5 rounded-[14px] border px-4 py-2 shadow-[0_8px_24px_rgba(20,24,31,.12)] backdrop-blur duration-300">
        {first && picked.length === 1 && row("First edge", first)}
        {picked.length > 1 && (
          <div className="text-[14px] font-semibold">
            First side: {picked.length} edges
          </div>
        )}
        {itself ? (
          <div
            key="itself"
            role="status"
            className="animate-in fade-in slide-in-from-top-1 text-amber-600 dark:text-amber-400 text-[13px] duration-150"
          >
            An edge can't be sewn to itself. Point at another one.
          </div>
        ) : hovered ? (
          row(second ? "Second edge" : "Edge", hovered)
        ) : (
          <div className="text-muted-foreground text-[13px]">
            {second
              ? "Now point at the edge to sew it to."
              : "Point at an edge to see its length, click to pick it."}
          </div>
        )}
      </div>
    </div>
  );
}
