// SPDX-License-Identifier: AGPL-3.0-or-later
// The seams in the Pieces panel: a list of what is sewn (hover picks a seam out in 2D and 3D,
// a click opens it) and suggestions to accept or skip; the flat view's Sew tool picks edges by
// hand. Plain words (the target is someone who has never drafted a pattern).
// Design rules from docs/PATENTS.md: whole edges only; two picks, no readout while picking; a
// length difference is shown only on a seam that exists, as a sentence.

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeSeam } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment, Seam } from "@/format/schema.gen";
import { describeSide, type SeamProposal, sideTitle } from "./api";
import { PanelHeading } from "@/components/PanelHeading";
import { seamTitle } from "./seamTitle";

/** What the seams section needs from the editor: suggestions live there. */
export interface Sewing {
  /** Length differences by seam id (Rust), for the seams that exist. */
  differences: Record<string, number>;
  /** Suggested seams, or null before the user asked. */
  proposals: SeamProposal[] | null;
  finding: boolean;
  onFind: () => void;
  onAccept: (p: SeamProposal) => void;
  onSkip: (index: number) => void;
  /** A seam hovered in the list (picked out in the views), or none. */
  onHover: (seamId: string | null) => void;
  /** Opens a seam's page, or goes back to the list. */
  onOpen: (seamId: string | null) => void;
}

/** Under the title: its name, or the pieces it joins. */
function seamSubtitle(g: Garment, seam: Seam): string {
  return seam.name || `${sideTitle(g, seam.a)} with ${sideTitle(g, seam.b)}`;
}

export function SeamsSection(props: {
  store: DocumentStore;
  garment: Garment;
  sewing: Sewing;
}) {
  const { store, garment, sewing } = props;
  const seams = garment.seams ?? [];
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <PanelHeading>Seams</PanelHeading>
      {seams.length === 0 ? (
        <p className="text-muted-foreground m-0 text-sm leading-snug">
          A seam joins one edge of a piece to an edge of another. Sew whole
          edges, from corner to corner.
        </p>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0"
          onPointerLeave={() => sewing.onHover(null)}
        >
          {seams.map((s) => (
            <li
              key={s.id}
              className="group flex items-center rounded-[10px] hover:bg-hover"
              onPointerEnter={() => sewing.onHover(s.id)}
            >
              <button
                type="button"
                onFocus={() => sewing.onHover(s.id)}
                onBlur={() => sewing.onHover(null)}
                onClick={() => sewing.onOpen(s.id)}
                className="flex min-w-0 grow flex-col items-start px-3 py-2 text-left"
              >
                <span className="text-[15px] font-semibold">
                  {seamTitle(garment, s)}
                </span>
                <span className="text-muted-foreground w-full truncate text-[13px]">
                  {seamSubtitle(garment, s)}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${seamTitle(garment, s)}`}
                title="Delete"
                onClick={() =>
                  store.execute((e) => removeSeam(e, garment.id, s.id))
                }
                className="text-muted-foreground hover:text-foreground mr-1 grid size-9 shrink-0 place-items-center rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-chip"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        onClick={sewing.onFind}
        disabled={sewing.finding}
      >
        {sewing.finding
          ? "Looking…"
          : sewing.proposals === null
            ? "Suggest seams"
            : "Suggest again"}
      </Button>

      {sewing.proposals !== null &&
        (sewing.proposals.length === 0 ? (
          <p className="text-muted-foreground m-0 text-sm">
            Nothing left to suggest. Sew the rest with the Sew tool in the flat
            view.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sewing.proposals.map((p, i) => (
              <li key={i} className="rounded-xl border border-border p-3">
                <div className="text-[14px] leading-snug font-semibold">
                  {sideTitle(garment, p.a)}{" "}
                  <span className="text-muted-foreground font-normal">
                    with
                  </span>{" "}
                  {sideTitle(garment, p.b)}
                </div>
                <div className="text-muted-foreground mt-1 text-[12.5px] leading-snug">
                  {describeSide(garment, p.a)}
                  <br />
                  {describeSide(garment, p.b)}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => sewing.onAccept(p)}>
                    Sew
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => sewing.onSkip(i)}
                  >
                    Skip
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
