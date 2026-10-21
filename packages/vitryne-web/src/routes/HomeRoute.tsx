// SPDX-License-Identifier: AGPL-3.0-or-later
// `/`: the start screen. Coming back here (the back button) closes the open document, once its
// changes are saved or the person decided about them; if they keep it, the URL goes back to it.

import { useEffect, useRef } from "react";
import { useEditor } from "@/editor/hooks/useEditor";
import { useShowOpen } from "./useShowOpen";

export function HomeRoute() {
  const { files, doc, startScreen } = useEditor();
  const showOpen = useShowOpen();
  const now = useRef({ files, empty: doc.empty });
  useEffect(() => {
    now.current = { files, empty: doc.empty };
  });
  // Only what was open on arrival: a document opened from here moves the URL itself.
  const closed = useRef(false);
  useEffect(() => {
    if (closed.current) return;
    closed.current = true;
    if (!now.current.empty) now.current.files.close(showOpen);
  }, [showOpen]);
  return startScreen;
}
