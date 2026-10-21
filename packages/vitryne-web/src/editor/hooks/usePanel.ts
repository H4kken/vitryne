// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useState } from "react";
import type { FabricView } from "@/properties/FabricPanel";
import type { PanelId } from "@/properties/panelTitles";

/**
 * The panel the rail opened (or none), and the Fabric panel's page. The last panel shown stays
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
  return { panel, displayedPanel, setPanel, fabricView, setFabricView };
}
