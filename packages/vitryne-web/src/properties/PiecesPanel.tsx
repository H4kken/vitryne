// SPDX-License-Identifier: AGPL-3.0-or-later
// The Pieces panel the rail opens: what the editor can change about the pieces today, in plain
// words. Every change goes through a command (document/commands.ts) on the store.

import { useEffect } from "react";
import type { Garment } from "@/format/schema.gen";
import { cutColor, cutFabric, findCut } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";

import type { PickPart } from "@/editor/hooks/useBodyPick";
import { type Place } from "@/placement/places";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { type Sewing, SeamsSection } from "@/sewing/SeamsSection";
import { cutName } from "./cutName";
import { PanelIntro } from "@/components/PanelIntro";
import { SeamDetails } from "@/sewing/SeamDetails";
import type { FlipAxis } from "@/pattern/flip";
import { CutDetails } from "./pieces/CutDetails";
import { LayersView } from "./pieces/LayersView";
import { SetAside } from "./pieces/SetAside";
import { PlacementTray } from "./pieces/PlacementTray";
import { type PiecesView, PiecesViewSwitch } from "./pieces/PiecesViewSwitch";
import { whereLabel } from "./pieces/whereLabel";
import type { Selection } from "@/pattern/panel/types";

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
  onRewrap: (cutId: string, place: Place, at?: string) => void;
  /** The part of the body under a screen point of the 3D view. */
  pickPart: PickPart;
  /** Switches to placing in 3D (null when already there). */
  onPlaceIn3d: (() => void) | null;
  /** Flips the picked pieces in the flat view. */
  onFlip: (axis: FlipAxis) => void;
  /** The seam whose page is open, or none. */
  openSeam: string | null;
  sewing: Sewing;
  /** The list of pieces, the stack of them (Layers) or the seams. */
  view: PiecesView;
  onView: (v: PiecesView) => void;
  /** How far out each cut starts, mm, by cut id, in the drape shown. */
  startsOut: ReadonlyMap<string, number>;
}) {
  const { store, garment, selection, onHover, sewing } = props;
  // A piece picked in the views wins over an open seam.
  const seam =
    !selection && props.openSeam
      ? garment?.seams?.find((s) => s.id === props.openSeam)
      : undefined;
  // The list goes away when a cut or a seam is open: nothing stays hovered.
  const layers = props.view === "layers";
  const seams = props.view === "seams";
  const listed = layers || seams ? !seam : !selection && !seam;
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
  return (
    <div className="flex flex-col gap-5">
      <PiecesViewSwitch view={props.view} onView={props.onView} />
      {seam ? (
        <SeamDetails
          store={store}
          garment={garment}
          seam={seam}
          sewing={sewing}
        />
      ) : layers ? (
        <LayersView
          store={store}
          entities={props.entities}
          garment={garment}
          selection={selection}
          onSelect={props.onSelect}
          onHover={onHover}
          startsOut={props.startsOut}
        />
      ) : seams ? (
        <SeamsSection store={store} garment={garment} sewing={sewing} />
      ) : found ? (
        <CutDetails
          {...props}
          garment={garment}
          piece={found.piece}
          cut={found.cut}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <PlacementTray
            store={store}
            garment={garment}
            onRewrap={props.onRewrap}
            pickPart={props.pickPart}
            onHover={onHover}
          />
          <ul
            className="m-0 flex list-none flex-col gap-1 p-0"
            onPointerLeave={() => onHover(null)}
          >
            {garment.pieces.flatMap((piece) =>
              piece.cuts
                .filter((cut) => !cut.state)
                .map((cut) => {
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
                        className="flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left hover:bg-hover"
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
                              <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-medium text-foreground">
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
          <SetAside store={store} garment={garment} />
        </div>
      )}
    </div>
  );
}
