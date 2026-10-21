// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";

/** What the file and the drape warn about goes to the console, once per change. */
export function useWarningsLog(
  docWarnings: readonly string[],
  drapeWarnings: readonly string[] | undefined,
) {
  const lastLoggedWarnings = useRef<string>("");
  useEffect(() => {
    const all = [...docWarnings, ...(drapeWarnings ?? [])];
    const key = all.join("\n");
    if (key && key !== lastLoggedWarnings.current) {
      lastLoggedWarnings.current = key;
      for (const w of all) {
        console.warn(`[vitryne] ${w}`);
      }
    } else if (!key) {
      lastLoggedWarnings.current = "";
    }
  }, [docWarnings, drapeWarnings]);
}
