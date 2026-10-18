// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import type { Cloud } from "@/cloud/useCloud";

/** Without an account, a new project replaces the draft: asked first (`ReplaceDraftDialog`). */
export function useDraftReplace(cloud: Cloud) {
  const draft = cloud.user?.anonymous ? (cloud.projects?.[0] ?? null) : null;
  const [replacing, setReplacing] = useState<{
    name: string;
    answer: (go: boolean) => void;
  } | null>(null);
  const confirmReplace = (): Promise<boolean> =>
    draft
      ? new Promise((resolve) =>
          setReplacing({ name: draft.name, answer: resolve }),
        )
      : Promise.resolve(true);
  return {
    /** The anonymous user's draft, their one project. */
    draft,
    /** The question being asked: the draft's name. */
    replacing,
    /** Answers the question (and closes it). */
    answer: (go: boolean) => {
      replacing?.answer(go);
      setReplacing(null);
    },
    /** Closes the question without answering it: its answer, to give later. */
    take: () => {
      setReplacing(null);
      return replacing?.answer ?? null;
    },
    confirmReplace,
    /** Runs `go` once the person agreed to replace their draft (at once without one). */
    startNew: (go: () => void) =>
      void confirmReplace().then((yes) => yes && go()),
  };
}
