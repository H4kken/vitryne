// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing: a file picked or dropped. A .vtry opens as a new project; a pattern goes to the
// import dialog: a DXF (with a garment.toml if one came with it) or a Valentina pattern (with
// its measurements file), whose pieces become a new project or are added to the open one.

import { useState } from "react";
import { type Addition, addPieces } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import type { EngineSession } from "@/worker/session";
import type { TextFile } from "../dialogs/ImportDialog";
import {
  importSource,
  isCompanion,
  patternKind,
} from "../dialogs/importSource";
import { fetchAvatar } from "../examples";
import { seed } from "../seed";
import type { useFiles } from "./useFiles";

/**
 * Text files from a drop or a file input: a pattern, and the file that goes with it if there is
 * one (a garment.toml for a DXF, measurements for a Valentina pattern).
 */
async function readPattern(
  files: FileList | File[],
): Promise<{ pattern: TextFile; companion: TextFile | null } | null> {
  const list = [...files];
  const pattern = list.find((f) => patternKind(f.name));
  const kind = pattern && patternKind(pattern.name);
  if (!pattern || !kind) return null;
  // Several patterns dropped together: the file named like the pattern goes with it.
  const stem = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
  const others = list.filter((f) => isCompanion(kind, f.name));
  const other =
    others.find((f) => stem(f.name) === stem(pattern.name)) ?? others[0];
  return {
    pattern: { name: pattern.name, text: await pattern.text() },
    companion: other ? { name: other.name, text: await other.text() } : null,
  };
}

export function useImport(o: {
  session: EngineSession;
  store: DocumentStore;
  files: ReturnType<typeof useFiles>;
  garment: Garment | undefined;
  empty: boolean;
  /** Runs `go` once the person agreed to replace their draft. */
  startNew: (go: () => void) => void;
  confirmReplace: () => Promise<boolean>;
  /** The import became a new project. */
  onNewProject: () => void;
}) {
  const { session, store, files, garment, empty, startNew } = o;
  const [importing, setImporting] = useState<TextFile | null>(null);
  const [importKey, setImportKey] = useState(0);
  const [droppedCompanion, setDroppedCompanion] = useState<TextFile | null>(
    null,
  );

  const startImport = async (list: FileList | File[]) => {
    const vtry = [...list].find((f) => /\.vtry$/i.test(f.name));
    if (vtry) return startNew(() => files.openVtry(vtry));
    const r = await readPattern(list);
    if (!r) {
      files.showError(
        "Not imported",
        new Error(
          "pick a pattern (DXF-AAMA .dxf, or Valentina .val or Seamly2D .sm2d with its measurements file) or a Vitryne project (.vtry)",
        ),
      );
      return;
    }
    // Pieces added to the open project aren't a new project; a new one replaces the draft.
    const show = () => {
      setDroppedCompanion(r.companion);
      setImportKey((k) => k + 1);
      setImporting(r.pattern);
    };
    if (empty) startNew(show);
    else show();
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.items].some((i) => i.kind === "file"))
        e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      void startImport(e.dataTransfer.files);
    },
  };

  const runImport = async (r: {
    pattern: TextFile;
    companion: TextFile | null;
    size: number[] | null;
    choices: Record<string, unknown>;
    into: "new" | "add";
  }) => {
    const choices = JSON.stringify(r.choices);
    const source = importSource(r.pattern, r.companion, r.size);
    if (r.into === "add" && garment) {
      const a = JSON.parse(
        await session.importAddition({ source, choices, seed: seed() }),
      ) as Addition;
      if (!store.execute((e) => addPieces(e, garment.id, a)))
        throw new Error(store.state.refused ?? "the pieces could not be added");
      if (a.notes.length) files.showInfo(a.notes.join(". "));
    } else {
      // With nothing open, starting the import already asked.
      if (!empty && !(await o.confirmReplace())) return;
      const avatar = await fetchAvatar();
      const name = `${r.pattern.name.replace(/\.(dxf|val|sm2d)$/i, "")}.vtry`;
      await files.importNew(async (rev) => ({
        name,
        ...(await session.importNew(
          { source, choices, avatar, seed: seed() },
          rev,
        )),
      }));
      o.onNewProject();
    }
    setImporting(null);
    setDroppedCompanion(null);
  };

  return {
    /** The pattern in the import dialog. */
    importing,
    /** Bumped by each import, so the dialog starts afresh. */
    importKey,
    droppedCompanion,
    closeImport: () => {
      setImporting(null);
      setDroppedCompanion(null);
    },
    startImport,
    dropProps,
    runImport,
  };
}
