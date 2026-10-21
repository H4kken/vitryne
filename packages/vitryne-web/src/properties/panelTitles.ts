// SPDX-License-Identifier: AGPL-3.0-or-later

export type PanelId = "fabric" | "pieces" | "settings";

export const PANEL_TITLES: Record<PanelId, string> = {
  fabric: "Fabric",
  pieces: "Pieces",
  settings: "Settings",
};
