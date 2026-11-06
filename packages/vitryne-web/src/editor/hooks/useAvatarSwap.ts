// SPDX-License-Identifier: AGPL-3.0-or-later
// Putting the project on another body: Rust works out the new entities (the avatar, the cuts put
// on it where they were, the collision boxes), and the document takes them as one edit.

import { useCallback, useEffect, useState } from "react";
import { swapAvatar } from "@/document/commands";
import { parseEntities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { type BodyOption, fetchBody, listBodies } from "@/lib/bodies";
import type { EngineSession } from "@/worker/session";

export function useAvatarSwap(o: {
  session: EngineSession;
  store: DocumentStore;
  showInfo: (text: string) => void;
}) {
  const { session, store, showInfo } = o;
  const [bodies, setBodies] = useState<BodyOption[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listBodies().then(
      (b) => live && setBodies(b),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback(
    async (body: BodyOption) => {
      if (loading) return;
      setLoading(body.slug);
      setError(null);
      try {
        // The worker's document must be the one on screen before it is changed.
        const { rev } = await store.settled();
        const { avatar, glb } = await fetchBody(body.slug);
        const r = await session.swapAvatar(avatar, glb, rev);
        if (store.state.rev !== rev)
          throw new Error("The project changed meanwhile. Try again.");
        const next = parseEntities(r.entities);
        let note: string | undefined;
        const done = store.execute((e) => {
          const cmd = swapAvatar(e, next, r.notes);
          note = cmd.note;
          return cmd;
        });
        if (!done) throw new Error(store.state.refused ?? "Not changed.");
        if (note) showInfo(`${note}.`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(null);
      }
    },
    [loading, session, store, showInfo],
  );

  return { bodies, loading, error, choose };
}
