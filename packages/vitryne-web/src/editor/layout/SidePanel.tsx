// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Garment } from "@/format/schema.gen";
import { type DocState, DocumentStore } from "@/document/store";
import { cn } from "@/lib/utils";
import { type Place } from "@/placement/places";
import { FabricPanel } from "@/properties/FabricPanel";
import { PANEL_TITLES } from "@/properties/panelTitles";
import { PiecesPanel } from "@/properties/PiecesPanel";
import { SettingsPanel } from "@/properties/SettingsPanel";
import type { usePanel } from "../hooks/usePanel";
import type { useOtherFabrics } from "../hooks/useOtherFabrics";
import type { useSelection } from "../hooks/useSelection";
import type { useSewing } from "../hooks/useSewing";

/** The panel the rail opened, sliding in beside the canvas: Fabric, Pieces (and seams) or Settings. */
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
}) {
  const { store, doc, garment, loadOthers, rewrap, onPlaceIn3d } = props;
  const { panel, displayedPanel, setPanel, fabricView, setFabricView } =
    props.panels;
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
  } = props.sewing;
  return (
    <aside
      aria-label={displayedPanel ? PANEL_TITLES[displayedPanel] : "Panel"}
      aria-hidden={!panel}
      style={{
        width: panel ? "300px" : "0px",
      }}
      className={cn(
        "relative h-full shrink-0 overflow-hidden bg-card",
        panel
          ? "border-r border-border opacity-100"
          : "pointer-events-none border-r-0 opacity-0",
        "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
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
                openSeam={openSeam}
                sewing={{
                  differences,
                  proposals,
                  finding,
                  onFind: () => void findSeams(),
                  onAccept: acceptProposal,
                  onSkip: skipProposal,
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
