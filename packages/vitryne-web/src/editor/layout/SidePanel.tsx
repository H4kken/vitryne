// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Garment } from "@/format/schema.gen";
import { type DocState, DocumentStore } from "@/document/store";
import { cn } from "@/lib/utils";
import type { FlipAxis } from "@/pattern/flip";
import { type Place } from "@/placement/places";
import { FabricPanel } from "@/properties/FabricPanel";
import { PANEL_TITLES } from "@/properties/panelTitles";
import { PiecesPanel } from "@/properties/PiecesPanel";
import { SettingsPanel } from "@/properties/SettingsPanel";
import type { usePanel } from "../hooks/usePanel";
import type { useOtherFabrics } from "../hooks/useOtherFabrics";
import type { useSelection } from "../hooks/useSelection";
import type { useSewing } from "../hooks/useSewing";

/** The panel the rail opened, sliding in over the canvas: Fabric, Pieces (and seams) or Settings. */
export function SidePanel(props: {
  panels: ReturnType<typeof usePanel>;
  store: DocumentStore;
  doc: DocState;
  garment: Garment | undefined;
  loadOthers: ReturnType<typeof useOtherFabrics>;
  selection: ReturnType<typeof useSelection>;
  sewing: ReturnType<typeof useSewing>;
  rewrap: (cutId: string, place: Place) => void;
  /** Shows the 3D view with the Select tool, to place pieces there (null: already placing). */
  onPlaceIn3d: (() => void) | null;
  /** Flips the picked pieces in the flat view. */
  onFlip: (axis: FlipAxis) => void;
  /** How far out each cut starts, mm, by cut id, in the drape shown. */
  startsOut: ReadonlyMap<string, number>;
}) {
  const {
    store,
    doc,
    garment,
    loadOthers,
    rewrap,
    onPlaceIn3d,
    onFlip,
    startsOut,
  } = props;
  const {
    panel,
    displayedPanel,
    setPanel,
    fabricView,
    setFabricView,
    piecesView,
    setPiecesView,
  } = props.panels;
  const {
    shown: shownSelection,
    select,
    setHovered,
    openSeam,
    openSeamPage,
    setHoveredSeam,
  } = props.selection;
  const {
    differences,
    proposals,
    finding,
    findSeams,
    acceptProposal,
    skipProposal,
    hoverProposal,
  } = props.sewing;
  return (
    <aside
      aria-label={displayedPanel ? PANEL_TITLES[displayedPanel] : "Panel"}
      aria-hidden={!panel}
      className={cn(
        // Over the canvas, from behind the rail, as in Figma: opening it moves nothing under it.
        "absolute top-0 left-20 z-20 h-full w-[300px] overflow-hidden border-r border-border bg-card shadow-lg",
        "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        panel
          ? "translate-x-0 opacity-100"
          : "pointer-events-none -translate-x-full opacity-0 shadow-none",
      )}
    >
      <div className="flex h-full w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
        {displayedPanel && (
          <>
            {displayedPanel === "fabric" && (
              <FabricPanel
                store={store}
                entities={doc.entities}
                garment={garment}
                view={fabricView}
                onView={setFabricView}
                onMadeForPiece={() => {
                  setFabricView({ kind: "list" });
                  setPanel("pieces");
                }}
                loadOthers={loadOthers}
              />
            )}
            {displayedPanel === "pieces" && (
              <PiecesPanel
                store={store}
                entities={doc.entities}
                garment={garment}
                selection={shownSelection}
                onNewFabric={(piece) => {
                  setFabricView({ kind: "new", forPiece: piece });
                  setPanel("fabric");
                }}
                onSelect={select}
                onHover={setHovered}
                onRewrap={rewrap}
                onPlaceIn3d={onPlaceIn3d}
                onFlip={onFlip}
                openSeam={openSeam}
                view={piecesView}
                onView={setPiecesView}
                startsOut={startsOut}
                sewing={{
                  differences,
                  proposals,
                  finding,
                  onFind: () => void findSeams(),
                  onAccept: acceptProposal,
                  onSkip: skipProposal,
                  onHoverProposal: hoverProposal,
                  onHover: setHoveredSeam,
                  onOpen: openSeamPage,
                }}
              />
            )}
            {displayedPanel === "settings" && (
              <SettingsPanel store={store} entities={doc.entities} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
