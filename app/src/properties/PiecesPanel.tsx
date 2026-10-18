// SPDX-License-Identifier: AGPL-3.0-or-later
// The Pieces panel the rail opens: what the editor can change about the pieces today, in plain
// words. Every change goes through a command (document/commands.ts) on the store.

import { useEffect } from "react";
import type { Cut, Garment } from "@/format/schema.gen";
import { cutColor, cutFabric, findCut } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";

import { type Place, PLACES, placeOf } from "@/placement/places";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { type Sewing, SeamsSection } from "@/sewing/SeamsSection";
import { cutName } from "./cutName";
import { PanelIntro } from "@/components/PanelIntro";
import { SeamDetails } from "@/sewing/SeamDetails";
import { CutDetails } from "./pieces/CutDetails";
import type { Selection } from "@/pattern/panel/types";

/** Where a cut starts, in a few words. */
function whereLabel(g: Garment, cut: Cut): string {
  const p = cut.placement;
  if (p.type === "follow") {
    const on = p.cut ? findCut(g, p.cut) : undefined;
    return on ? `On the ${cutName(on.piece, on.cut)}` : "On another piece";
  }
  const place = placeOf(p);
  return place ? PLACES[place].label : (p.region ?? "Somewhere");
}

export function PiecesPanel(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  selection: Selection;
  /** Opens the Fabric panel on a new fabric for a piece. */
  onNewFabric: (piece: { id: string; name: string }) => void;
  onSelect: (s: Selection) => void;
  /** A cut hovered in the list (picked out in the views), or none. */
  onHover: (cutId: string | null) => void;
  /** Asks Rust for a fresh wrap of the cut at `place`, then makes it an edit. */
  onRewrap: (cutId: string, place: Place) => void;
  /** Switches to placing in 3D (null when already there). */
  onPlaceIn3d: (() => void) | null;
  /** The seam whose page is open, or none. */
  openSeam: string | null;
  sewing: Sewing;
}) {
  const { store, garment, selection, onHover, sewing } = props;
  // A piece picked in the views wins over an open seam.
  const seam =
    !selection && props.openSeam
      ? garment?.seams?.find((s) => s.id === props.openSeam)
      : undefined;
  // The list goes away when a cut or a seam is open: nothing stays hovered.
  const listed = !selection && !seam;
  const onHoverSeam = sewing.onHover;
  useEffect(() => {
    if (!listed) {
      onHover(null);
      onHoverSeam(null);
    }
    return () => {
      onHover(null);
      onHoverSeam(null);
    };
  }, [listed, onHover, onHoverSeam]);
  if (!garment) return <PanelIntro>This project has no garment.</PanelIntro>;
  const found = selection ? findCut(garment, selection.cutId) : undefined;
  if (seam)
    return (
      <SeamDetails
        store={store}
        garment={garment}
        seam={seam}
        sewing={sewing}
      />
    );
  return (
    <div className="flex flex-col gap-5">
      {found ? (
        <CutDetails
          {...props}
          garment={garment}
          piece={found.piece}
          cut={found.cut}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ul
            className="m-0 flex list-none flex-col gap-1 p-0"
            onPointerLeave={() => onHover(null)}
          >
            {garment.pieces.flatMap((piece) =>
              piece.cuts.map((cut) => {
                const own = cut.fabric
                  ? cutFabric(props.entities, garment, cut)
                  : undefined;
                return (
                  <li key={cut.id}>
                    <button
                      type="button"
                      onPointerEnter={() => onHover(cut.id)}
                      onFocus={() => onHover(cut.id)}
                      onBlur={() => onHover(null)}
                      onClick={() =>
                        props.onSelect({
                          kind: "cut",
                          pieceId: piece.id,
                          cutId: cut.id,
                        })
                      }
                      className="flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left hover:bg-[#F4F5F2]"
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full border border-black/10"
                          style={{
                            background:
                              cutColor(props.entities, garment, cut) ??
                              DEFAULT_CLOTH_COLOR,
                          }}
                        />
                        {cutName(piece, cut)}
                        {cut.mirrored ? " (mirrored)" : ""}
                      </span>
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[13px]">
                        <span>{whereLabel(garment, cut)}</span>
                        {own && (
                          <>
                            <span>·</span>
                            <span className="rounded bg-[#E1E4DE] px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                              {own.name}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      )}
      {!found && (
        <SeamsSection store={store} garment={garment} sewing={sewing} />
      )}
    </div>
  );
}
