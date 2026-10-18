// SPDX-License-Identifier: AGPL-3.0-or-later
// `/new`: an import, a project from scratch or a file from disk until its first save gives it an
// id (a moment; the URL then moves to `/design/$id`). After a reload, the recovery copy puts it
// back; with nothing to put back, or another document open, the URL goes where that is.

import { useEffect } from "react";
import { useEditor } from "@/editor/useEditor";
import { docRoute } from "./docRoute";
import { ProjectLoading } from "./ProjectLoading";
import { useShowOpen } from "./useShowOpen";

export function NewRoute() {
  const { files, doc, ready } = useEditor();
  const showOpen = useShowOpen();
  const elsewhere = docRoute(files.ref, doc.empty).path !== "/new";
  useEffect(() => {
    if (ready && elsewhere && !files.busy) showOpen();
  }, [ready, elsewhere, files.busy, showOpen]);
  if (!ready || elsewhere)
    return <ProjectLoading text={files.busy ?? "Opening your project"} />;
  return null;
}
