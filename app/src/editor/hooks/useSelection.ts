// SPDX-License-Identifier: AGPL-3.0-or-later
// What is picked out: the selected cuts, the cut hovered in the pieces list, and the seam
// hovered or open in the Pieces panel (each picked out in 2D and 3D). Each only counts in the
// file it was made in.

import { useCallback, useEffect, useState } from "react";
import { findCut } from "@/document/commands";
import type { Garment } from "@/format/schema.gen";
import type { Selection } from "@/pattern/PatternPanel";
import type { PanelId } from "@/properties/panelTitles";
import type { EngineSession } from "@/worker/session";

export function useSelection(o: {
  session: EngineSession;
  garment: Garment | undefined;
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
}) {
  const { session, garment, panel, setPanel } = o;
  const [selection, setSelection] = useState<Selection>(null);
  // A selection only counts in the file it was made in.
  const selected =
    selection && garment ? findCut(garment, selection.cutId) : undefined;
  const shownSelection = selected ? selection : null;

  // A cut hovered in the pieces list: picked out in 2D and 3D (only in the file it's in).
  const [hovered, setHovered] = useState<string | null>(null);
  const shownHovered =
    hovered && garment && findCut(garment, hovered) ? hovered : null;
  useEffect(() => {
    session.highlight(shownHovered);
  }, [session, shownHovered]);

  // A seam: hovered in the list or open in the Pieces panel, it is picked out in 2D and 3D.
  const [openSeam, setOpenSeam] = useState<string | null>(null);
  const [hoveredSeam, setHoveredSeam] = useState<string | null>(null);
  /** Selects cuts (and shows them in the Pieces panel), or nothing. */
  const select = useCallback(
    (s: Selection) => {
      setSelection(s);
      if (s) {
        setOpenSeam(null);
        setPanel("pieces");
      }
    },
    [setPanel, setOpenSeam],
  );

  /** Opens a seam's page in the Pieces panel (the cuts are unselected), or closes it. */
  const openSeamPage = useCallback(
    (id: string | null) => {
      setOpenSeam(id);
      if (id) setSelection(null);
    },
    [setOpenSeam, setSelection],
  );
  const litSeam = hoveredSeam ?? (panel === "pieces" ? openSeam : null);
  const litSeamIndex = (garment?.seams ?? []).findIndex(
    (s) => s.id === litSeam,
  );
  const shownLitSeam = litSeamIndex >= 0 ? litSeam : null;
  useEffect(() => {
    session.highlightSeam(litSeamIndex >= 0 ? litSeamIndex : null);
  }, [session, litSeamIndex]);

  return {
    /** As set; `shown` is what counts in this file. */
    selection,
    setSelection,
    /** The selected cut, found in the garment. */
    selected,
    shown: shownSelection,
    select,
    hovered: shownHovered,
    setHovered,
    openSeam,
    setOpenSeam,
    openSeamPage,
    setHoveredSeam,
    litSeam: shownLitSeam,
  };
}
