// SPDX-License-Identifier: AGPL-3.0-or-later
// The URL follows the open document where nothing else moved it: each route opens what its URL
// names (src/routes/), and this hook covers the rest. A document getting an id (an example or a
// new project's first save, or moving into an account) replaces the URL; another document opened
// from inside the editor (an import, a duplicate, closing) adds a history entry. At start, what
// a crash left and was put back is shown at its own URL when the URL was `/`.

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { FileRef } from "@/storage/storage";
import { docRoute } from "@/routes/docRoute";

export function useFollowOpen(
  files: { ref: FileRef | null; opened: number },
  empty: boolean,
  ready: boolean,
) {
  const navigate = useNavigate();
  const path = useLocation({ select: (l) => l.pathname });
  const route = docRoute(files.ref, empty);

  const now = useRef({ path, route, navigate });
  useEffect(() => {
    now.current = { path, route, navigate };
  });

  const shown = useRef<{ opened: number; path: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    const last = shown.current;
    shown.current = { opened: files.opened, path: route.path };
    const { path, route: to, navigate } = now.current;
    if (path === to.path) return;
    if (!last) {
      if (path === "/") void navigate({ ...to, replace: true });
      return;
    }
    if (last.opened === files.opened && last.path === to.path) return;
    const saved = last.opened === files.opened;
    // The URL was moved elsewhere meanwhile: that route decides.
    if (saved && path !== last.path) return;
    void navigate({ ...to, replace: saved });
  }, [ready, files.opened, route.path]);
}
