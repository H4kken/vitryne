// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, type RefObject } from "react";

/** Space held: dragging pans while drawing or picking with a box. */
export function useSpaceHeld(): RefObject<boolean> {
  const spaceDown = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " ") spaceDown.current = e.type === "keydown";
    };
    const blur = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return spaceDown;
}
