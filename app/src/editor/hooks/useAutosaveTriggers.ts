// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import type { Autosaver } from "@/cloud/autosave";
import type { CloudUser } from "@/cloud/backend";
import type { DocState } from "@/document/store";
import type { Blocked } from "./useFiles";

/**
 * When autosave runs: after every change Rust confirmed, when the tab (or the page) is left, and
 * once there is an account for a project a sign-in stopped.
 */
export function useAutosaveTriggers(
  autosave: Autosaver,
  doc: DocState,
  blocked: Blocked,
  user: CloudUser | null,
) {
  // Every change Rust confirmed is autosaved.
  useEffect(() => {
    autosave.changed();
  }, [autosave, doc.rev, doc.dirty, doc.syncing, doc.empty, blocked]);

  // Leaving the tab (or the page) saves what is waiting.
  useEffect(() => {
    const now = () => {
      if (document.visibilityState === "hidden") void autosave.flush();
    };
    document.addEventListener("visibilitychange", now);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", now);
      window.removeEventListener("pagehide", now);
    };
  }, [autosave]);

  // A project a sign-in stopped (it needed an account): saved once there is one.
  const accountUser = user && !user.anonymous ? user.id : null;
  useEffect(() => {
    if (
      accountUser &&
      autosave.status.kind === "stopped" &&
      autosave.status.reason === "account"
    )
      autosave.resume();
  }, [accountUser, autosave]);
}
