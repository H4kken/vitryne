// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

/** Option (Alt) held: dragging slides the 3D view, whatever the tool, until it is let go. */
export function useAltHeld(): boolean {
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return altHeld;
}
