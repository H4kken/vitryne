// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import type { Preview } from "./ImportDialog";

/** A titled list of pieces in the import's placement step; nothing when it has none. */
export function PlacementSection(props: {
  title: string;
  pieces: Preview["pieces"];
  render: (x: Preview["pieces"][number]) => ReactNode;
}) {
  if (!props.pieces.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground m-0 mt-1 text-[13px] font-semibold">
        {props.title} ({props.pieces.length})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {props.pieces.map(props.render)}
      </ul>
    </section>
  );
}
