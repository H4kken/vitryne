// SPDX-License-Identifier: AGPL-3.0-or-later
import { useNavigate } from "@tanstack/react-router";
import type { EngineSession } from "@/worker/session";
import { type Example, exampleId, fetchAvatar } from "../examples";
import { seed } from "../seed";
import type { useFiles } from "./useFiles";

/**
 * The start screen's ways to begin: an example (at its own URL, which opens it), an empty
 * project, or a folder from disk. Each asks first before replacing an anonymous user's draft.
 */
export function useNewProject(o: {
  session: EngineSession;
  files: ReturnType<typeof useFiles>;
  startNew: (go: () => void) => void;
  /** The empty project is open. */
  onScratch: () => void;
}) {
  const { session, files, startNew } = o;
  const navigate = useNavigate();
  const openPreset = (ex: Example) =>
    startNew(
      () =>
        void navigate({
          to: "/example/$name",
          params: { name: exampleId(ex) },
        }),
    );
  /** An empty project, opened on the flat view (its hint says how to start). */
  const startScratch = () =>
    startNew(
      () =>
        void files
          .importNew(
            async (rev) => ({
              name: "Untitled.vtry",
              ...(await session.newEmpty(
                { avatar: await fetchAvatar(), seed: seed() },
                rev,
              )),
            }),
            null,
          )
          .then(o.onScratch)
          .catch((e: unknown) => {
            if ((e as Error).message !== "cancelled")
              files.showError("Could not start a project", e);
          }),
    );
  const openFolder = () => startNew(() => files.openFolder());
  return { openPreset, startScratch, openFolder };
}
