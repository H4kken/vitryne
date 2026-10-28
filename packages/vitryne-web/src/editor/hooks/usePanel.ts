// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useState } from "react";
import type { FabricView } from "@/properties/FabricPanel";
import type { PanelId } from "@/properties/panelTitles";
import type { PiecesView } from "@/properties/pieces/PiecesViewSwitch";

/**
 * The panel the rail opened (or none), the Fabric panel's page and the Pieces panel's view. The last panel shown stays
 * displayed while the side panel closes, so it slides away with its content.
 */
export function usePanel() {
  const [panel, setPanelState] = useState<PanelId | null>(null);
  const [displayedPanel, setDisplayedPanel] = useState<PanelId>("fabric");
  const setPanel = useCallback((p: PanelId | null) => {
    setPanelState(p);
    if (p) setDisplayedPanel(p);
  }, []);
  const [fabricView, setFabricView] = useState<FabricView>({ kind: "list" });
  // Which view of the Pieces panel (the list or the stack) stays while other panels are open.
  const [piecesView, setPiecesView] = useState<PiecesView>("pieces");
  return {
    panel,
    displayedPanel,
    setPanel,
    fabricView,
    setFabricView,
    piecesView,
    setPiecesView,
  };
}
