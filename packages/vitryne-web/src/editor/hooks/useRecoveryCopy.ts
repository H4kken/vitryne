// SPDX-License-Identifier: AGPL-3.0-or-later
import { type RefObject, useEffect } from "react";
import type { DocState, DocumentStore } from "@/document/store";
import { dropRecovery, keepRecovery } from "@/storage/recovery";
import type { FileRef } from "@/storage/storage";
import type { FileData } from "@/worker/protocol";

/** How long the document must be still before its recovery copy is written. */
const RECOVERY_DELAY_MS = 1000;

/**
 * The recovery copy (IndexedDB, never sent anywhere) follows the confirmed document while it has
 * changes not saved, and goes once they are.
 */
export function useRecoveryCopy(
  doc: DocState,
  store: DocumentStore,
  /** The file as opened or last saved. */
  original: RefObject<FileData | null>,
  ref: RefObject<FileRef | null>,
) {
  useEffect(() => {
    if (doc.empty) return;
    if (!doc.dirty) {
      void dropRecovery();
      return;
    }
    if (doc.syncing || !original.current) return;
    const data = original.current;
    const t = setTimeout(() => {
      void store.settled().then(({ entities }) =>
        keepRecovery({
          fileName: doc.fileName,
          cloud: ref.current?.cloud,
          data,
          saved: JSON.stringify(store.savedEntities),
          current: JSON.stringify(entities),
          unsaved: store.unsaved,
        }),
      );
    }, RECOVERY_DELAY_MS);
    return () => clearTimeout(t);
  }, [
    doc.empty,
    doc.dirty,
    doc.syncing,
    doc.rev,
    doc.fileName,
    store,
    original,
    ref,
  ]);
}
