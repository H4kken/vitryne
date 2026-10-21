// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectLock } from "@/cloud/lock";
import type { Blocked } from "./useFiles";

/**
 * One tab per cloud project (cloud/lock.ts): this tab takes the open project's lock, and says
 * when it can't edit it (another tab has it, or took it over).
 */
export function useProjectLock(cloudId: string | null) {
  /** Which project this tab can't edit, and why. */
  const [blockedOn, setBlockedOn] = useState<{
    id: string;
    why: Exclude<Blocked, null>;
  } | null>(null);
  /** `blocked` now, for saves (a state update lands only at the next render). */
  const blockedNow = useRef<Blocked>(null);
  const lock = useMemo(() => new ProjectLock(), []);
  const blocked: Blocked =
    blockedOn && blockedOn.id === cloudId ? blockedOn.why : null;
  useEffect(() => {
    blockedNow.current = blocked;
  }, [blocked]);
  useEffect(() => {
    if (!cloudId) {
      lock.drop();
      return;
    }
    let live = true;
    void lock
      .take(
        cloudId,
        false,
        () => live && setBlockedOn({ id: cloudId, why: "taken" }),
      )
      .then(
        (got) =>
          live && !got && setBlockedOn({ id: cloudId, why: "elsewhere" }),
      );
    return () => {
      live = false;
    };
  }, [cloudId, lock]);
  useEffect(() => () => lock.drop(), [lock]);

  return {
    blocked,
    blockedNow,
    /** Takes the project from the tab that has it; false if that didn't work. */
    takeLock: async (id: string) => {
      if (
        !(await lock.take(id, true, () => setBlockedOn({ id, why: "taken" })))
      )
        return false;
      setBlockedOn(null);
      blockedNow.current = null;
      return true;
    },
  };
}
