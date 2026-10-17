// SPDX-License-Identifier: AGPL-3.0-or-later
// The open cloud project's thumbnail, for its card on the start screen: once per drape, after
// it has run for a few simulated seconds (the fabric has mostly fallen), the worker renders a
// small image from the garment's own camera and it is stored with the project
// (`saveThumbnail`: not an edit, so no new revision). Best effort: a failure waits for the next
// drape.

import { useEffect, useRef } from "react";
import { saveThumbnail } from "@/cloud/projects";
import type { EngineSession, EngineState } from "@/worker/session";
import type { CloudAccess } from "./useFiles";

const WIDTH = 480;
const HEIGHT = 360;
/** Simulated seconds of a drape before its picture is taken. */
const AFTER_S = 3;

export function useThumbnails(
  session: EngineSession,
  engine: EngineState,
  projectId: string | null,
  editable: boolean,
  cloud: CloudAccess,
) {
  const rev = engine.drape?.rev ?? null;
  const key = projectId && rev !== null ? `${projectId}:${rev}` : null;
  const ready =
    !!key &&
    editable &&
    !engine.controls.placing &&
    (engine.stats?.simTime ?? 0) >= AFTER_S;
  const taken = useRef<string | null>(null);
  const cloudNow = useRef(cloud);
  useEffect(() => {
    cloudNow.current = cloud;
  });

  // The stats shown when the drape changed are the previous drape's: wait for newer ones.
  const statsAtChange = useRef<{ key: string | null; stats: unknown }>({
    key: null,
    stats: null,
  });
  useEffect(() => {
    statsAtChange.current = { key, stats: engine.stats };
    // Only when the drape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (
      !ready ||
      !projectId ||
      taken.current === key ||
      engine.stats === statsAtChange.current.stats
    )
      return;
    taken.current = key;
    void (async () => {
      const { image, type } = await session.thumbnail(WIDTH, HEIGHT);
      await saveThumbnail(
        await cloudNow.current.backend(),
        projectId,
        image,
        type,
      );
      cloudNow.current.refresh();
    })().catch((e: unknown) => console.warn("thumbnail not saved:", e));
  }, [ready, key, projectId, session, engine.stats]);
}
