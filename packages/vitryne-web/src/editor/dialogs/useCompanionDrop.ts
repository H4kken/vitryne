// SPDX-License-Identifier: AGPL-3.0-or-later
// Dropping the file that comes with a pattern (a garment.toml, the measurements) anywhere on the
// window while the import dialog is open, like the start screen's drop zone. The listeners sit on
// the window in the capture phase so the page behind the dialog never starts a second import.

import { useEffect, useState } from "react";
import type { TextFile } from "./ImportDialog";
import { isCompanion, type PatternKind } from "./importSource";

/** What the drop zone asks for, in words. */
export const WANTED: Record<PatternKind, string> = {
  dxf: "a garment.toml",
  drafted: "a measurements file (.vit, .vst, .smis or .smms)",
};

/**
 * Whether the drop zone is showing; `kind` is null while there is no import to add a file to.
 * The callbacks must be stable (state setters).
 */
export function useCompanionDrop(
  kind: PatternKind | null,
  onFile: (f: TextFile) => void,
  onProblem: (message: string | null) => void,
): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!kind) return;
    // dragenter and dragleave fire for every element the pointer crosses.
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      const f = [...(e.dataTransfer?.files ?? [])].find((x) =>
        isCompanion(kind, x.name),
      );
      if (!f) {
        onProblem(
          `That isn't ${WANTED[kind]}. Drop ${WANTED[kind]} anywhere on the page.`,
        );
        return;
      }
      onProblem(null);
      void f.text().then((text) => onFile({ name: f.name, text }));
    };
    const on: [string, (e: DragEvent) => void][] = [
      ["dragenter", enter],
      ["dragover", over],
      ["dragleave", leave],
      ["drop", drop],
    ];
    for (const [t, h] of on)
      window.addEventListener(t, h as EventListener, true);
    return () => {
      for (const [t, h] of on)
        window.removeEventListener(t, h as EventListener, true);
      setDragging(false);
    };
  }, [kind, onFile, onProblem]);

  return dragging;
}
