// SPDX-License-Identifier: AGPL-3.0-or-later
// The URL follows the open project, and the open project follows the URL (a reload, a bookmark,
// back and forward). Only a cloud project has a URL, `/design/$id`; everything else (the start
// screen, an example or an import before its first save, a file from disk) is `/`. Opening
// another document adds a history entry; the same document getting an id (its first save, or
// moving into an account) replaces the entry.

import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

interface Files {
  ref: { cloud?: { id: string } } | null;
  opened: number;
  started(): Promise<void>;
  openCloud(id: string, undone?: () => void): void;
  close(undone?: () => void): void;
}

export function useProjectRoute(files: Files, empty: boolean) {
  const navigate = useNavigate();
  const urlId = useParams({ strict: false }).id ?? null;
  const openId = files.ref?.cloud?.id ?? null;

  const now = useRef({ files, empty, openId, urlId, navigate });
  useEffect(() => {
    now.current = { files, empty, openId, urlId, navigate };
  });

  /** The URL of what is open, without a history entry (an open that didn't happen). */
  const showOpen = () => {
    const { openId, navigate } = now.current;
    void (openId
      ? navigate({ to: "/design/$id", params: { id: openId }, replace: true })
      : navigate({ to: "/", replace: true }));
  };

  // The open project → the URL.
  const shown = useRef<{ opened: number; id: string | null } | null>(null);
  useEffect(() => {
    const last = shown.current;
    shown.current = { opened: files.opened, id: openId };
    // At start the URL decides (below).
    if (!last || (last.opened === files.opened && last.id === openId)) return;
    const { urlId, navigate } = now.current;
    if (openId === urlId) return;
    const replace = last.opened === files.opened;
    void (openId
      ? navigate({ to: "/design/$id", params: { id: openId }, replace })
      : navigate({ to: "/", replace }));
  }, [files.opened, openId]);

  // The URL → the open project.
  const handled = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (handled.current === urlId) return;
    handled.current = urlId;
    // What a crash left is put back first: it may be this very project.
    void now.current.files.started().then(() => {
      const { files, empty, openId, urlId: still } = now.current;
      if (still !== urlId || openId === urlId) return;
      if (urlId) files.openCloud(urlId, showOpen);
      else if (!empty && openId) files.close(showOpen);
    });
  }, [urlId]);
}
