// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing: a file picked or dropped. A .vtry opens as a new project; a DXF goes to the import
// dialog (a garment.toml with it is kept for it), whose pieces become a new project or are added
// to the open one.

import { useState } from "react";
import { type Addition, addPieces } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import type { EngineSession } from "@/worker/session";
import type { TextFile } from "../dialogs/ImportDialog";
import { fetchAvatar } from "../examples";
import { seed } from "../seed";
import type { useFiles } from "./useFiles";

/** Text files from a drop or a file input: a DXF, and a garment.toml if there is one. */
async function readPattern(
  files: FileList | File[],
): Promise<{ dxf: TextFile; sidecar: TextFile | null } | null> {
  const list = [...files];
  const dxf = list.find((f) => /\.dxf$/i.test(f.name));
  if (!dxf) return null;
  const toml = list.find((f) => /\.toml$/i.test(f.name));
  return {
    dxf: { name: dxf.name, text: await dxf.text() },
    sidecar: toml ? { name: toml.name, text: await toml.text() } : null,
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
  const [droppedSidecar, setDroppedSidecar] = useState<TextFile | null>(null);

  const startImport = async (list: FileList | File[]) => {
    const vtry = [...list].find((f) => /\.vtry$/i.test(f.name));
    if (vtry) return startNew(() => files.openVtry(vtry));
    const r = await readPattern(list);
    if (!r) {
      files.showError(
        "Not imported",
        new Error(
          "pick a DXF-AAMA pattern (.dxf) or a Vitryne project (.vtry)",
        ),
      );
      return;
    }
    // Pieces added to the open project aren't a new project; a new one replaces the draft.
    const show = () => {
      setDroppedSidecar(r.sidecar);
      setImportKey((k) => k + 1);
      setImporting(r.dxf);
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
    dxf: TextFile;
    sidecar: TextFile | null;
    choices: Record<string, unknown>;
    into: "new" | "add";
  }) => {
    const choices = JSON.stringify(r.choices);
    if (r.into === "add" && garment) {
      const a = JSON.parse(
        await session.importAddition({
          name: r.dxf.name,
          dxf: r.dxf.text,
          sidecar: r.sidecar?.text ?? "",
          choices,
          seed: seed(),
        }),
      ) as Addition;
      if (!store.execute((e) => addPieces(e, garment.id, a)))
        throw new Error(store.state.refused ?? "the pieces could not be added");
      if (a.notes.length) files.showInfo(a.notes.join(". "));
    } else {
      // With nothing open, starting the import already asked.
      if (!empty && !(await o.confirmReplace())) return;
      const avatar = await fetchAvatar();
      const name = `${r.dxf.name.replace(/\.dxf$/i, "")}.vtry`;
      await files.importNew(async (rev) => ({
        name,
        ...(await session.importNew(
          {
            name: r.dxf.name,
            dxf: r.dxf.text,
            sidecar: r.sidecar?.text ?? "",
            choices,
            avatar,
            seed: seed(),
          },
          rev,
        )),
      }));
      o.onNewProject();
    }
    setImporting(null);
  };

  return {
    /** The DXF in the import dialog. */
    importing,
    /** Bumped by each import, so the dialog starts afresh. */
    importKey,
    droppedSidecar,
    closeImport: () => setImporting(null),
    startImport,
    dropProps,
    runImport,
  };
}
