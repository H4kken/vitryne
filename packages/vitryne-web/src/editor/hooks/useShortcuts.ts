// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's keys: save, open a file, undo and redo, copy and paste the picked pieces; Delete takes the picked pieces out;
// space, F and R pause, speed up and restart the drape; in the flat view V, A, P, M and S pick
// the Select, Edit points, Draw, Marks and Sew tools; in the 3D view 1 and 2 pick Select and Pinch.

import { type RefObject, useEffect } from "react";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";

import type { PointerTool } from "@/worker/protocol";
import type { EngineSession } from "@/worker/session";
import type { FlatTool } from "@/pattern/panel/types";

/** By physical key (`code`), not the character: on an AZERTY keyboard the digit row types & and é
 * without Shift, so `key` is never "1" or "2" there. */
const DRAPE_TOOL_KEYS: Record<string, PointerTool | undefined> = {
  Digit1: "select",
  Numpad1: "select",
  Digit2: "pinch",
  Numpad2: "pinch",
};

const FLAT_TOOL_KEYS: Record<string, FlatTool | undefined> = {
  v: "select",
  a: "points",
  p: "draw",
  m: "marks",
  s: "sew",
};

export function useShortcuts(o: {
  session: EngineSession;
  store: DocumentStore;
  save: () => void;
  /** The file input that Cmd-O opens. */
  fileInput: RefObject<HTMLInputElement | null>;
  show2d: boolean;
  show3d: boolean;
  setTool: (t: PointerTool) => void;
  flatTool: FlatTool;
  setFlatTool: (t: FlatTool) => void;
  /** The Sew tool picked (it also opens the seams and clears the selection). */
  onSew: () => void;
  garment: Garment | undefined;
  /** Takes the picked pieces out; false if there are none. */
  removePicked: () => boolean;
  /** Copy and paste the picked pieces; false if there was nothing to do. */
  copyPicked: () => boolean;
  pastePicked: () => boolean;
}) {
  const {
    session,
    store,
    save,
    fileInput,
    show2d,
    show3d,
    setTool,
    flatTool,
    setFlatTool,
    onSew,
    garment,
    removePicked,
    copyPicked,
    pastePicked,
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
      if (mod && !typing && !e.shiftKey && (k === "c" || k === "v")) {
        // Not over selected text on the page: that copy is the browser's.
        if (k === "c" && window.getSelection()?.toString()) return;
        if (k === "c" ? copyPicked() : pastePicked()) e.preventDefault();
        return;
      }
      if (typing || mod || e.altKey) return;
      // The flat view's tools, one letter each.
      // Not under a dialog or menu, nor with nothing open.
      const over =
        e.target instanceof Element &&
        !!e.target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
      const tool =
        show2d && !over && !e.shiftKey && garment
          ? FLAT_TOOL_KEYS[k]
          : undefined;
      const drapeTool =
        show3d && !over && !e.shiftKey ? DRAPE_TOOL_KEYS[e.code] : undefined;
      if (drapeTool) {
        e.preventDefault();
        setTool(drapeTool);
        return;
      }
      if (tool) {
        e.preventDefault();
        if (tool === "sew") onSew();
        else setFlatTool(tool);
        return;
      }
      // Delete takes the picked pieces out, in 2D or 3D; the 2D tools that pick points or
      // lines keep it for those.
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !(
          show2d &&
          (flatTool === "points" || flatTool === "draw" || flatTool === "marks")
        )
      ) {
        if (!removePicked()) return;
        e.preventDefault();
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
    fileInput,
    show2d,
    show3d,
    setTool,
    flatTool,
    setFlatTool,
    onSew,
    garment,
    removePicked,
    copyPicked,
    pastePicked,
  ]);
}
