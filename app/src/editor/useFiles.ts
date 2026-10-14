// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening and saving, and what protects the user's work: the unsaved-changes guard, the save
// that is only reported once Rust validated the document and the disk (or the cloud) has it,
// and the recovery copy. Cloud projects (src/cloud/) open and save in the folder form.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudBackend } from '@/cloud/backend';
import { collectUnused, openProject, saveProject } from '@/cloud/projects';
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

/** What saving to the cloud needs from cloud mode (null in local mode). */
export interface CloudAccess {
  backend(): Promise<CloudBackend>;
  refresh(): void;
}

export function useFiles(session: EngineSession, store: DocumentStore, storage: ProjectStorage, doc: DocState, cloud: CloudAccess | null) {
  const [ref, setRef] = useState<FileRef | null>(null);
  /** `ref` for the recovery copy, which shouldn't restart its timer when a save changes it. */
  const refNow = useRef<FileRef | null>(null);
  /** The page is about to be left on purpose (a sign-in redirect): no "leave site?" question. */
  const leaving = useRef(false);
  useEffect(() => {
    refNow.current = ref;
  }, [ref]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** An action waiting for the user to decide about unsaved changes. */
  const [pending, setPending] = useState<{ run: () => void; cancelled?: () => void } | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** The file as opened or last saved, for the recovery copy. */
  const original = useRef<FileData | null>(null);

  const fail = (what: string, e: unknown) => setNotice({ kind: 'error', text: `${what}: ${(e as Error).message ?? String(e)}` });

  const load = useCallback(
    async (r: FileRef, data: FileData, opts: { unsaved?: boolean } = {}) => {
      // Revisions keep growing across files, so a drape of the previous file is never newer.
      const rev = store.state.rev + 1;
      const { entities, warnings } = await session.open(copyFileData(data), rev);
      store.load(r.name, parseEntities(entities), warnings, rev, opts);
      original.current = copyFileData(data);
      // A never-saved document has no file: saving asks where.
      setRef(opts.unsaved ? null : r);
      session.drape(rev, true);
      void dropRecovery();
      return entities;
    },
    [session, store],
  );

  /** A project made from an imported pattern: unsaved until the user saves it. */
  const importNew = (make: (rev: number) => Promise<{ name: string; entities: string; notes: string[]; zip: ArrayBuffer }>) =>
    new Promise<void>((resolve, reject) => {
      guarded(async () => {
        try {
          setBusy('Importing');
          const rev = store.state.rev + 1;
          const m = await make(rev);
          store.load(m.name, parseEntities(m.entities), m.notes, rev, { unsaved: true });
          original.current = { form: 'zip', bytes: m.zip.slice(0) };
          setRef(null);
          session.drape(rev, true);
          void dropRecovery();
          setNotice({
            kind: 'info',
            text: `Imported ${m.name}. Pick Select in the 3D view to move a piece, or the Pieces panel to change where it starts. Save to keep it.`,
          });
          resolve();
        } catch (e) {
          reject(e as Error);
        } finally {
          setBusy(null);
        }
      }, () => reject(new Error('cancelled')));
    });

  /** Runs `action` now, or after the user decided what to do with unsaved changes. */
  const guarded = (action: () => Promise<void> | void, cancelled?: () => void) => {
    const run = () => void Promise.resolve(action()).catch((e: unknown) => fail('Could not open', e));
    if (store.state.dirty) setPending(() => ({ run, cancelled }));
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

  /** Saves over the cloud project it came from, or as a new one (`copy`, or not from the cloud). */
  const saveToCloud = async (copy: boolean) => {
    if (store.state.empty || busy || !cloud) return;
    setBusy('Saving to the cloud');
    try {
      const { rev, entities } = await store.settled();
      const data = await session.save(rev, 'folder');
      if (data.form !== 'folder') throw new Error('internal: the worker did not give the folder form');
      const b = await cloud.backend();
      const first = b.user() === null;
      const name = store.state.entities.project?.name ?? ref?.name.replace(/\.vtry$/, '') ?? 'project';
      const prev = copy ? null : (ref?.cloud ?? null);
      const saved = await saveProject(b, name, data.files, prev, (p) => p.total > 1 && setBusy(`Saving to the cloud (${p.done} of ${p.total})`));
      store.markSaved(name, entities);
      original.current = copyFileData(data);
      setRef({ name, form: 'folder', cloud: saved });
      void dropRecovery();
      setNotice(
        first
          ? { kind: 'info', text: `Saved ${name} to the cloud. To open it on another device too, add your email (Cloud, top right).` }
          : { kind: 'ok', text: `Saved ${name} to the cloud` },
      );
      cloud.refresh();
      // Parts no project uses any more (older than a day), best effort.
      void collectUnused(b).catch(() => undefined);
    } catch (e) {
      fail('Not saved', e);
    } finally {
      setBusy(null);
    }
  };

  const openCloud = (id: string) =>
    guarded(async () => {
      if (!cloud) return;
      setBusy('Opening from the cloud');
      try {
        const o = await openProject(await cloud.backend(), id);
        await load({ name: o.name, form: 'folder', cloud: o.ref }, o.data);
        setNotice(null);
      } finally {
        setBusy(null);
      }
    });

  const saveTo = async (target: 'same' | 'as') => {
    if (store.state.empty || busy) return;
    if (target === 'same' && ref?.cloud) return saveToCloud(false);
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
        keepRecovery({
          fileName: doc.fileName,
          cloud: refNow.current?.cloud,
          data,
          saved: JSON.stringify(store.savedEntities),
          current: JSON.stringify(entities),
          unsaved: store.unsaved,
        }),
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
      await load({ name: r.fileName, form: r.data.form, cloud: r.cloud }, r.data, { unsaved: r.unsaved });
      // An import never edited has nothing to put back but itself.
      if (r.current !== r.saved && !store.execute((e) => recoverChanges(e, parseEntities(r.current)))) {
        throw new Error(store.state.refused ?? 'refused');
      }
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
    const stop = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [doc.dirty]);

  return {
    ref,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    showError: fail,
    showInfo: (text: string) => setNotice({ kind: 'info', text }),
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
    importNew,
    /** Leaves the page (`go`), after the unsaved-changes question if there are changes. */
    leavePage: (go: () => Promise<void>) =>
      guarded(async () => {
        leaving.current = true;
        try {
          await go();
        } catch (e) {
          leaving.current = false;
          throw e;
        }
      }),
    save: () => saveTo('same'),
    saveAs: () => saveTo('as'),
    saveToCloud: () => saveToCloud(false),
    saveCopyToCloud: () => saveToCloud(true),
    openCloud,
    /** The unsaved-changes question, while one is open. */
    unsaved: pending
      ? {
          save: async () => {
            await saveTo('same');
            if (!store.state.dirty) {
              setPending(null);
              pending.run();
            }
          },
          discard: () => {
            setPending(null);
            pending.run();
          },
          cancel: () => {
            setPending(null);
            pending.cancelled?.();
          },
        }
      : null,
    recovery: recovery ? { fileName: recovery.fileName, at: recovery.at, recover, discard: discardRecovery } : null,
  };
}
