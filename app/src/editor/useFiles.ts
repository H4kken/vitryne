// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening and saving, and what protects the user's work: the unsaved-changes guard, the save
// that is only reported once Rust validated the document and the disk gave the bytes back,
// and the recovery copy.

import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverChanges } from '@/document/commands';
import { parseEntities } from '@/document/entities';
import type { DocState, DocumentStore } from '@/document/store';
import { dropRecovery, findRecovery, keepRecovery, type Recovery } from '@/storage/recovery';
import type { FileRef, ProjectStorage } from '@/storage/storage';
import { copyFileData, type FileData } from '@/worker/protocol';
import type { EngineSession } from '@/worker/session';

/** ok: a save (shown by the title); info: worth a card; error: what went wrong. */
export type Notice = { kind: 'ok' | 'info' | 'error'; text: string } | null;

/** How long the document must be still before its recovery copy is written. */
const RECOVERY_DELAY_MS = 1000;

export function useFiles(session: EngineSession, store: DocumentStore, storage: ProjectStorage, doc: DocState) {
  const [ref, setRef] = useState<FileRef | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** An action waiting for the user to decide about unsaved changes. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** The file as opened or last saved, for the recovery copy. */
  const original = useRef<FileData | null>(null);

  const fail = (what: string, e: unknown) => setNotice({ kind: 'error', text: `${what}: ${(e as Error).message ?? String(e)}` });

  const load = useCallback(
    async (r: FileRef, data: FileData) => {
      // Revisions keep growing across files, so a drape of the previous file is never newer.
      const rev = store.state.rev + 1;
      const { entities, warnings } = await session.open(copyFileData(data), rev);
      store.load(r.name, parseEntities(entities), warnings, rev);
      original.current = copyFileData(data);
      setRef(r);
      session.drape(rev, true);
      void dropRecovery();
      return entities;
    },
    [session, store],
  );

  /** Runs `action` now, or after the user decided what to do with unsaved changes. */
  const guarded = (action: () => Promise<void> | void) => {
    const run = () => void Promise.resolve(action()).catch((e: unknown) => fail('Could not open', e));
    if (store.state.dirty) setPending(() => run);
    else run();
  };

  const openWith = (pick: () => Promise<{ ref: FileRef; data: FileData } | null>) =>
    guarded(async () => {
      const o = await pick();
      if (!o) return;
      setBusy('Opening');
      try {
        await load(o.ref, o.data);
        setNotice(null);
      } finally {
        setBusy(null);
      }
    });

  const saveTo = async (target: 'same' | 'as') => {
    if (store.state.empty || busy) return;
    setBusy('Saving');
    try {
      // Only what Rust accepted is written: wait for edits still being checked.
      const { rev, entities } = await store.settled();
      // In place when the browser gave a handle; a download when it never does (same name);
      // otherwise (an example, a recovered copy, Save as) the user picks where, as a .vtry.
      const inPlace = target === 'same' && ref?.handle !== undefined;
      const download = target === 'same' && ref !== null && !ref.handle && !storage.savesInPlace && ref.form === 'zip';
      const data = await session.save(rev, inPlace && ref ? ref.form : 'zip');
      const name = ref?.name ?? `${store.state.entities.project?.name ?? 'project'}.vtry`;
      const saved =
        (inPlace || download) && ref
          ? await storage.save(ref, data)
          : await storage.saveAs(name.replace(/\.vtry$/, ''), data as Extract<FileData, { form: 'zip' }>);
      if (!saved) return;
      store.markSaved(saved.ref.name, entities);
      original.current = copyFileData(data);
      setRef(saved.ref);
      void dropRecovery();
      setNotice({ kind: 'ok', text: saved.how === 'verified' ? `Saved ${saved.ref.name}` : `Downloaded ${saved.ref.name}` });
    } catch (e) {
      fail('Not saved', e);
    } finally {
      setBusy(null);
    }
  };

  // The recovery copy follows the confirmed document while it has unsaved changes.
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
        keepRecovery({ fileName: doc.fileName, data, saved: JSON.stringify(store.savedEntities), current: JSON.stringify(entities) }),
      );
    }, RECOVERY_DELAY_MS);
    return () => clearTimeout(t);
  }, [doc.empty, doc.dirty, doc.syncing, doc.rev, doc.fileName, store]);

  // A copy left by a crash or a closed tab is offered once, at start.
  useEffect(() => {
    void findRecovery().then(setRecovery);
  }, []);

  const recover = async () => {
    const r = recovery;
    setRecovery(null);
    if (!r) return;
    setBusy('Recovering');
    try {
      await load({ name: r.fileName, form: r.data.form }, r.data);
      if (!store.execute((e) => recoverChanges(e, parseEntities(r.current)))) throw new Error(store.state.refused ?? 'refused');
      await dropRecovery(r.tab);
      setNotice({ kind: 'info', text: `Recovered your unsaved changes to ${r.fileName}. Save them to keep them.` });
    } catch (e) {
      fail('Could not recover', e);
    } finally {
      setBusy(null);
    }
  };

  const discardRecovery = () => {
    if (recovery) void dropRecovery(recovery.tab);
    setRecovery(null);
  };

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!doc.dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [doc.dirty]);

  return {
    ref,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    openFile: () => openWith(() => storage.openFile()),
    openFolder: () => openWith(() => storage.openFolder()),
    openData: (r: FileRef, data: () => Promise<FileData>) => openWith(async () => ({ ref: r, data: await data() })),
    close: () =>
      guarded(() => {
        store.close();
        session.closeDocument();
        original.current = null;
        setRef(null);
        setNotice(null);
        void dropRecovery();
      }),
    save: () => saveTo('same'),
    saveAs: () => saveTo('as'),
    /** The unsaved-changes question, while one is open. */
    unsaved: pending
      ? {
          save: async () => {
            await saveTo('same');
            if (!store.state.dirty) {
              setPending(null);
              pending();
            }
          },
          discard: () => {
            setPending(null);
            pending();
          },
          cancel: () => setPending(null),
        }
      : null,
    recovery: recovery ? { fileName: recovery.fileName, at: recovery.at, recover, discard: discardRecovery } : null,
  };
}
