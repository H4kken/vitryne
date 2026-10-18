// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

/** Cmd (Ctrl) held: dragging pans the flat view, whatever the tool, until it is let go. */
export function useModHeld(): boolean {
  const [modHeld, setModHeld] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setModHeld(e.metaKey || e.ctrlKey);
    const blur = () => setModHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return modHeld;
}
