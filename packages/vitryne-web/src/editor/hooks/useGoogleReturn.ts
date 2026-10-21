// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { moveProjects } from "@/cloud/projects";
import type { Cloud } from "@/cloud/useCloud";
import type { useFiles } from "./useFiles";

/**
 * Signing in with Google leaves the page. Back from Google: say what went wrong (the account
 * dialog opens with it), or finish what was left to do (move an anonymous user's projects into
 * the account reached, reopen the cloud project that was open). A password reset link comes back
 * here too: the account dialog opens to choose the new password.
 */
export function useGoogleReturn(
  cloud: Cloud,
  files: ReturnType<typeof useFiles>,
  openAccount: () => void,
) {
  const navigate = useNavigate();
  const [error, setError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const cloudBackend = cloud.backend;
  const cloudRefresh = cloud.refresh;
  const userId = cloud.user?.id;
  const now = useRef({ files, navigate, openAccount });
  useEffect(() => {
    now.current = { files, navigate, openAccount };
  });
  useEffect(() => {
    void cloudBackend().then(
      async (b) => {
        if (b.recovery) {
          setRecovering(true);
          now.current.openAccount();
          return;
        }
        if (!b.returned) return;
        b.returned = false;
        if (b.returnError) {
          setError(b.returnError);
          now.current.openAccount();
          return;
        }
        const stash = b.takeReturn();
        if (!stash || !b.user()) return;
        const from = b.fromStash(stash);
        if (from) {
          const r = await moveProjects(from, b);
          cloudRefresh();
          const { showInfo, projectsMoved } = now.current.files;
          projectsMoved(r.ids);
          if (r.failed.length)
            showInfo(
              `Signed in. These projects could not be moved from this browser and stay there: ${r.failed.join(", ")}.`,
            );
          else if (r.moved)
            showInfo(
              `Signed in. ${r.moved} project${r.moved === 1 ? "" : "s"} from this browser moved to your account.`,
            );
        } else if (stash.reopen) {
          void now.current.navigate({
            to: "/design/$id",
            params: { id: stash.reopen },
            replace: true,
          });
        }
      },
      () => undefined,
    );
    // `userId`: run again once the session from the URL is in.
  }, [cloudBackend, cloudRefresh, userId]);

  return {
    /** What Google said went wrong, for the account dialog. */
    error,
    /** A password reset link opened this page: the dialog asks for the new password. */
    recovering,
    clearError: () => {
      setError(null);
      setRecovering(false);
    },
    /** Leaves for Google (once the changes are saved or the person decided about them). */
    continueWithGoogle: (signIn: boolean) => {
      setError(null);
      files.leavePage(async () =>
        (await cloud.backend()).continueWithGoogle({
          signIn,
          reopen: files.ref?.cloud?.id,
        }),
      );
    },
  };
}
