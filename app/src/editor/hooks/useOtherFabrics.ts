// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from "react";
import type { CloudBackend } from "@/cloud/backend";
import { fabricKey, projectFabrics } from "@/cloud/fabrics";
import type { DocumentStore } from "@/document/store";

/**
 * Loads the fabrics of the person's other projects, the ones this project doesn't have yet (an
 * account's: a draft is the only project, so null without one).
 */
export function useOtherFabrics(
  isAccount: boolean,
  backend: () => Promise<CloudBackend>,
  openProjectId: string | null,
  store: DocumentStore,
) {
  return useMemo(
    () =>
      isAccount
        ? async () => {
            const e = store.state.entities;
            const have = new Set(
              e.fabrics.map((f) =>
                fabricKey(
                  f,
                  e.appearances?.find((a) => a.id === f.appearance)?.color,
                ),
              ),
            );
            return projectFabrics(await backend(), openProjectId, have);
          }
        : null,
    [isAccount, backend, openProjectId, store],
  );
}
