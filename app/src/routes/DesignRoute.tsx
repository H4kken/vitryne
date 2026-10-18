// SPDX-License-Identifier: AGPL-3.0-or-later
// `/design/$id`: a cloud project. Opens it unless it is the one open (after what a crash left
// was put back: it may be this project). A loading screen until it is open, an error page at
// this URL if it can't be; never the start screen.

import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEditor } from "@/editor/useEditor";
import { ProjectError } from "./ProjectError";
import { ProjectLoading } from "./ProjectLoading";
import { useShowOpen } from "./useShowOpen";

export function DesignRoute() {
  const { id } = useParams({ from: "/design/$id" });
  const { files, ready } = useEditor();
  const navigate = useNavigate();
  const showOpen = useShowOpen();
  const openId = files.ref?.cloud?.id ?? null;

  const now = useRef({ files, openId });
  useEffect(() => {
    now.current = { files, openId };
  });
  // Once per id (StrictMode runs effects twice).
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || handled.current === id) return;
    handled.current = id;
    if (now.current.openId !== id) now.current.files.openCloud(id, showOpen);
  }, [ready, id, showOpen]);

  const error =
    files.openError?.key === `design:${id}` ? files.openError : null;
  if (error)
    return (
      <ProjectError
        title="Can't open this project"
        hint={
          navigator.onLine
            ? "It may have been deleted, or it belongs to another account than the one signed in here."
            : "This browser seems to be offline. Projects open from the cloud."
        }
        detail={error.message}
        onRetry={() => files.openCloud(id, showOpen)}
        onHome={() => void navigate({ to: "/" })}
      />
    );
  if (openId !== id)
    return <ProjectLoading text={files.busy ?? "Opening your project"} />;
  return null;
}
