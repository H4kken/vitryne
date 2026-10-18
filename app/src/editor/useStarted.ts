// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

/** True once `started` resolved: what a crash left was put back first (it may be the project a URL names). */
export function useStarted(started: () => Promise<void>): boolean {
  const [ready, setReady] = useState(false);
  const first = useState(() => started)[0];
  useEffect(() => {
    let live = true;
    void first().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [first]);
  return ready;
}
