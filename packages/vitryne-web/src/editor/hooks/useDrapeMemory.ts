// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";
import { setDrapeView } from "@/document/commands";
import type { DocumentStore, DocState } from "@/document/store";
import type { EngineSession, EngineState } from "@/worker/session";

/**
 * The drape's controls (paused, fast) are saved with the project: a project left paused opens
 * paused. A project that says nothing opens paused, so an import waits for Play (nothing is sewn
 * yet and the pieces are rarely placed well). Only a change of the controls is written, never
 * the state a project was just opened in.
 */
export function useDrapeMemory(
  session: EngineSession,
  store: DocumentStore,
  doc: DocState,
  engine: EngineState,
) {
  const opened = useRef(0);
  const { paused, fast } = engine.controls;
  const saved = doc.entities.view?.drape;
  const savedPaused = saved?.paused ?? true;
  const savedFast = saved?.fast ?? false;
  useEffect(() => {
    if (doc.empty) {
      opened.current = 0;
      return;
    }
    if (opened.current !== doc.loads) {
      opened.current = doc.loads;
      session.setControls({ paused: savedPaused, fast: savedFast });
      return;
    }
    if (paused !== savedPaused || fast !== savedFast)
      store.executeQuiet((e) => setDrapeView(e, { paused, fast }));
  }, [
    session,
    store,
    doc.empty,
    doc.loads,
    paused,
    fast,
    savedPaused,
    savedFast,
  ]);
}
