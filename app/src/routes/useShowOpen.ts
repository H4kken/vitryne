// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useEditor } from "@/editor/hooks/useEditor";
import { docRoute } from "./docRoute";

/** Puts the open document's URL back, without a history entry (an open or close that didn't happen). */
export function useShowOpen(): () => void {
  const { files, doc } = useEditor();
  const navigate = useNavigate();
  const now = useRef({ ref: files.ref, empty: doc.empty, navigate });
  useEffect(() => {
    now.current = { ref: files.ref, empty: doc.empty, navigate };
  });
  return useCallback(() => {
    const { ref, empty, navigate } = now.current;
    void navigate({ ...docRoute(ref, empty), replace: true });
  }, []);
}
