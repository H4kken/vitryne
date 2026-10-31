// SPDX-License-Identifier: AGPL-3.0-or-later
import { setCutState } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import { cutName } from "../cutName";

/** The pieces kept in the project but off the body, below the active ones. */
export function SetAside(props: { store: DocumentStore; garment: Garment }) {
  const { store, garment: g } = props;
  const items = g.pieces.flatMap((piece) =>
    piece.cuts
      .filter((c) => c.state === "set-aside")
      .map((cut) => ({ id: cut.id, name: cutName(piece, cut) })),
  );
  if (!items.length) return null;
  return (
    <section className="border-border mt-1 flex flex-col gap-1 border-t pt-4">
      <h3 className="text-muted-foreground m-0 mb-1 px-3 text-[13px] font-semibold">
        Set aside ({items.length})
      </h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((x) => (
          <li
            key={x.id}
            className="text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-[14px]"
          >
            <span className="grow truncate">{x.name}</span>
            <button
              type="button"
              onClick={() =>
                store.execute((e) => setCutState(e, g.id, [x.id], "unplaced"))
              }
              className="hover:text-foreground cursor-pointer border-0 bg-transparent text-[13px] whitespace-nowrap hover:underline"
            >
              Bring back
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
