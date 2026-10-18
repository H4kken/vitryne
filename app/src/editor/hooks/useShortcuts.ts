// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's keys: save, open a file, undo and redo; Delete takes the picked pieces out;
// space, F and R pause, speed up and restart the drape.

import { type RefObject, useEffect } from "react";
import { findCut, removeCuts } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import type { FlatTool, Selection } from "@/pattern/PatternPanel";
import type { EngineSession } from "@/worker/session";

export function useShortcuts(o: {
  session: EngineSession;
  store: DocumentStore;
  save: () => void;
  showInfo: (text: string) => void;
  /** The file input that Cmd-O opens. */
  fileInput: RefObject<HTMLInputElement | null>;
  show2d: boolean;
  flatTool: FlatTool;
  garment: Garment | undefined;
  selection: Selection;
  /** The picked pieces were taken out. */
  onRemoved: () => void;
}) {
  const {
    session,
    store,
    save,
    showInfo,
    fileInput,
    show2d,
    flatTool,
    garment,
    selection,
    onRemoved,
  } = o;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        // Let a field being edited commit first.
        if (typing) (e.target as HTMLElement).blur();
        save();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (mod && !typing && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing || mod) return;
      // Delete takes the picked pieces out, in 2D or 3D; the 2D tools that pick points or
      // lines keep it for those.
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !(
          show2d &&
          (flatTool === "points" || flatTool === "draw" || flatTool === "marks")
        )
      ) {
        const g = garment;
        const s = selection;
        if (!g || !s) return;
        e.preventDefault();
        const ids = [s.cutId, ...(s.also ?? [])].filter(
          (id) => !!findCut(g, id),
        );
        let note: string | undefined;
        const done = store.execute((x) => {
          const cmd = removeCuts(x, g.id, ids);
          note = cmd.note;
          return cmd;
        });
        if (done) {
          onRemoved();
          if (note) showInfo(`${note}.`);
        }
        return;
      }
      const c = session.state.controls;
      if (e.key === " ") session.setControls({ paused: !c.paused });
      else if (k === "f") session.setControls({ fast: !c.fast });
      else if (k === "r") session.resetDrape();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    session,
    store,
    save,
    showInfo,
    fileInput,
    show2d,
    flatTool,
    garment,
    selection,
    onRemoved,
  ]);
}
