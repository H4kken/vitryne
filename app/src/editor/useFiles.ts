// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening and saving, and what protects the user's work: autosave to the cloud (src/cloud/
// autosave.ts) once Rust validated the document, one tab per cloud project (lock.ts), and the
// recovery copy, which keeps what hasn't reached the cloud yet. Cloud projects open and save in
// the folder form. Without a cloud backend (local mode), saving is to disk, by hand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Autosaver, type SaveStatus } from '@/cloud/autosave';
import type { CloudBackend, CloudUser } from '@/cloud/backend';
import { ProjectLock } from '@/cloud/lock';
import { type CloudRef, collectUnused, openProject, saveProject } from '@/cloud/projects';
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
/** Unused parts are looked for at most this often (each look is a query). */
const COLLECT_EVERY_MS = 10 * 60 * 1000;

/** What saving to the cloud needs from cloud mode (null in local mode). */
export interface CloudAccess {
  user: CloudUser | null;
  backend(): Promise<CloudBackend>;
  refresh(): void;
}

/** Why this tab can't edit the open cloud project: another tab has it, or took it over. */
export type Blocked = 'elsewhere' | 'taken' | null;

/** An anonymous user's draft (their one project), to save a new project over. */
async function draftOf(b: CloudBackend): Promise<CloudRef | null> {
  const [d] = await b.listProjects();
  return d ? { id: d.id, revision: d.revision, parts: [] } : null;
}

/** `cloud`: null in local mode, undefined while that isn't known yet. */
export function useFiles(session: EngineSession, store: DocumentStore, storage: ProjectStorage, doc: DocState, cloud: CloudAccess | null | undefined) {
  const [ref, setRefState] = useState<FileRef | null>(null);
  /** `ref` now, for saves and the recovery copy (a state update lands only at the next render). */
  const refNow = useRef<FileRef | null>(null);
  const setRef = useCallback((r: FileRef | null) => {
    refNow.current = r;
    setRefState(r);
  }, []);
  const cloudNow = useRef(cloud);
  useEffect(() => {
    cloudNow.current = cloud;
  });
  /** The page is about to be left on purpose (a sign-in redirect): no "leave site?" question. */
  const leaving = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** An action waiting for the user to decide about changes not saved. */
  const [pending, setPending] = useState<{ run: () => void; cancelled?: () => void } | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** The file as opened or last saved, for the recovery copy. */
  const original = useRef<FileData | null>(null);
  /** Bumped by every open and close: a save that finishes after one is about another document. */
  const generation = useRef(0);
  /** Which project this tab can't edit, and why. */
  const [blockedOn, setBlockedOn] = useState<{ id: string; why: Exclude<Blocked, null> } | null>(null);
  const blockedNow = useRef<Blocked>(null);
  const lock = useMemo(() => new ProjectLock(), []);
  const lastCollect = useRef(0);
  /** The anonymous user was told once that their draft is in the cloud. */
  const toldDraft = useRef(false);

  const fail = (what: string, e: unknown) => setNotice({ kind: 'error', text: `${what}: ${(e as Error).message ?? String(e)}` });

  /**
   * Saves the confirmed document to the cloud: over the project it came from, as a new one
   * (`copy`, or never saved), or for an anonymous user over their draft. Throws what failed.
   */
  const pushToCloud = useCallback(
    async (copy: boolean, progress?: (text: string) => void) => {
      const c = cloudNow.current;
      if (!c) throw new Error('no cloud backend is configured');
      const gen = generation.current;
      const { rev, entities } = await store.settled();
      const data = await session.save(rev, 'folder');
      if (data.form !== 'folder') throw new Error('internal: the worker did not give the folder form');
      const b = await c.backend();
      const r = refNow.current;
      const name = store.state.entities.project?.name ?? r?.name.replace(/\.vtry$/, '') ?? 'project';
      let prev = copy ? null : (r?.cloud ?? null);
      if (!prev && !copy && b.user()?.anonymous) prev = await draftOf(b);
      const saved = await saveProject(b, name, data.files, prev, (p) => p.total > 1 && progress?.(`Saving to the cloud (${p.done} of ${p.total})`));
      if (gen !== generation.current) return;
      store.markSaved(name, entities);
      original.current = copyFileData(data);
      setRef({ name, form: 'folder', cloud: saved });
      if (b.user()?.anonymous && !toldDraft.current) {
        toldDraft.current = true;
        setNotice({ kind: 'info', text: `${name} is saved as your draft in this browser. Create a free account (Cloud, top right) to keep it for good and open it anywhere.` });
      }
      if (!prev || prev.id !== saved.id) c.refresh();
      // Parts no project uses any more (older than a day), best effort.
      if (Date.now() - lastCollect.current > COLLECT_EVERY_MS) {
        lastCollect.current = Date.now();
        void collectUnused(b).catch(() => undefined);
      }
    },
    [session, store, setRef],
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'saved' });
  const [autosave] = useState(() => new Autosaver(setSaveStatus));
  useEffect(() => {
    autosave.connect(
      () => pushToCloud(false),
      () => !!cloudNow.current && !store.state.empty && store.state.dirty && !blockedNow.current,
    );
  }, [autosave, pushToCloud, store]);
  useEffect(() => () => autosave.dispose(), [autosave]);

  // One tab per cloud project.
  const cloudId = ref?.cloud?.id ?? null;
  const blocked: Blocked = blockedOn && blockedOn.id === cloudId ? blockedOn.why : null;
  useEffect(() => {
    blockedNow.current = blocked;
  }, [blocked]);
  useEffect(() => {
    if (!cloudId) {
      lock.drop();
      return;
    }
    let live = true;
    void lock
      .take(cloudId, false, () => live && setBlockedOn({ id: cloudId, why: 'taken' }))
      .then((got) => live && !got && setBlockedOn({ id: cloudId, why: 'elsewhere' }));
    return () => {
      live = false;
    };
  }, [cloudId, lock]);
  useEffect(() => () => lock.drop(), [lock]);

  // Every change Rust confirmed is autosaved (cloud mode).
  useEffect(() => {
    if (cloud) autosave.changed();
  }, [cloud, autosave, doc.rev, doc.dirty, doc.syncing, doc.empty, blocked]);

  // Leaving the tab (or the page) saves what is waiting.
  useEffect(() => {
    const now = () => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    document.addEventListener('visibilitychange', now);
    window.addEventListener('pagehide', now);
    return () => {
      document.removeEventListener('visibilitychange', now);
      window.removeEventListener('pagehide', now);
    };
  }, [autosave]);

  // A project a sign-in stopped (it needed an account): saved once there is one.
  const accountUser = cloud?.user && !cloud.user.anonymous ? cloud.user.id : null;
  useEffect(() => {
    if (accountUser && autosave.status.kind === 'stopped' && autosave.status.reason === 'account') autosave.resume();
  }, [accountUser, autosave]);

  const load = useCallback(
    async (r: FileRef, data: FileData, opts: { unsaved?: boolean } = {}) => {
      // Revisions keep growing across files, so a drape of the previous file is never newer.
      const rev = store.state.rev + 1;
      const { entities, warnings } = await session.open(copyFileData(data), rev);
      generation.current++;
      autosave.reset();
      store.load(r.name, parseEntities(entities), warnings, rev, opts);
      original.current = copyFileData(data);
      // A never-saved document has no file: saving asks where (local mode) or makes a project.
      setRef(opts.unsaved ? null : r);
      session.drape(rev, true);
      void dropRecovery();
      return entities;
    },
    [session, store, autosave, setRef],
  );

  /** Runs `action` now, or once the changes are saved, or after the user decided about them. */
  const guarded = (action: () => Promise<void> | void, cancelled?: () => void) => {
    const run = () => void Promise.resolve(action()).catch((e: unknown) => fail('Could not open', e));
    if (!store.state.dirty) return run();
    if (cloudNow.current && !blockedNow.current) {
      void autosave.flush().then((saved) => (saved ? run() : setPending(() => ({ run, cancelled }))));
      return;
    }
    setPending(() => ({ run, cancelled }));
  };

  /** A project made from an imported pattern: saved at once in cloud mode, by hand in local mode. */
  const importNew = (make: (rev: number) => Promise<{ name: string; entities: string; notes: string[]; zip: ArrayBuffer }>) =>
    new Promise<void>((resolve, reject) => {
      guarded(async () => {
        try {
          setBusy('Importing');
          const rev = store.state.rev + 1;
          const m = await make(rev);
          generation.current++;
          autosave.reset();
          store.load(m.name, parseEntities(m.entities), m.notes, rev, { unsaved: true });
          original.current = { form: 'zip', bytes: m.zip.slice(0) };
          setRef(null);
          session.drape(rev, true);
          void dropRecovery();
          setNotice({
            kind: 'info',
            text: `Imported ${m.name}. Pick Select in the 3D view to move a piece, or the Pieces panel to change where it starts.${cloudNow.current ? '' : ' Save to keep it.'}`,
          });
          resolve();
        } catch (e) {
          reject(e as Error);
        } finally {
          setBusy(null);
        }
      }, () => reject(new Error('cancelled')));
    });

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

  /** By hand (the menu): saves over the cloud project it came from, or as a new one (`copy`, or not from the cloud). */
  const saveToCloud = async (copy: boolean) => {
    if (store.state.empty || busy || !cloud) return;
    setBusy('Saving to the cloud');
    try {
      await pushToCloud(copy, setBusy);
      autosave.resume();
    } catch (e) {
      fail('Not saved', e);
    } finally {
      setBusy(null);
    }
  };

  const loadCloud = async (id: string) => {
    const c = cloudNow.current;
    if (!c) return;
    setBusy('Opening from the cloud');
    try {
      const o = await openProject(await c.backend(), id);
      await load({ name: o.name, form: 'folder', cloud: o.ref }, o.data);
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  const openCloud = (id: string) => guarded(() => loadCloud(id));

  const saveTo = async (target: 'same' | 'as') => {
    if (store.state.empty || busy) return;
    // Cloud mode saves by itself; a save by hand only says it is done now.
    if (target === 'same' && cloud) {
      await autosave.flush();
      return;
    }
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

  // The recovery copy follows the confirmed document while it has changes not saved.
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

  const recoverNow = useCallback(
    async (r: Recovery, auto: boolean) => {
      setRecovery(null);
      setBusy('Recovering');
      try {
        await load({ name: r.fileName, form: r.data.form, cloud: r.cloud }, r.data, { unsaved: r.unsaved });
        // An import never edited has nothing to put back but itself.
        if (r.current !== r.saved && !store.execute((e) => recoverChanges(e, parseEntities(r.current)))) {
          throw new Error(store.state.refused ?? 'refused');
        }
        await dropRecovery(r.tab);
        const c = cloudNow.current;
        setNotice({
          kind: 'info',
          text: c
            ? `${auto ? 'Put back' : 'Recovered'} your changes to ${r.fileName} that hadn't reached the cloud yet. They are being saved.`
            : `Recovered your unsaved changes to ${r.fileName}. Save them to keep them.`,
        });
      } catch (e) {
        fail('Could not recover', e);
      } finally {
        setBusy(null);
      }
    },
    [load, store],
  );

  // A copy left by a crash, a closed tab or a lost connection, once at start. In cloud mode it is
  // put back by itself when nothing else saved the project since (or it never reached the cloud);
  // otherwise it is offered.
  const mode = cloud === undefined ? undefined : !!cloud;
  const started = useRef(false);
  useEffect(() => {
    if (started.current || mode === undefined) return;
    started.current = true;
    void findRecovery().then(async (r) => {
      const c = cloudNow.current;
      if (!r || !c) return setRecovery(r);
      try {
        const current = r.cloud ? (await (await c.backend()).getProject(r.cloud.id)).revision : null;
        if (!r.cloud || current === r.cloud.revision) return void recoverNow(r, true);
      } catch {
        // Offline, or the project is gone: ask.
      }
      setRecovery(r);
    });
  }, [mode, recoverNow]);

  const discardRecovery = () => {
    if (recovery) void dropRecovery(recovery.tab);
    setRecovery(null);
  };

  // Closing or reloading the tab with changes not saved asks first.
  useEffect(() => {
    if (!doc.dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [doc.dirty]);

  /** The project saved elsewhere since this tab opened it: the person picks a version. */
  const conflictId = saveStatus.kind === 'stopped' && saveStatus.reason === 'conflict' ? (ref?.cloud?.id ?? null) : null;
  const conflict =
    conflictId && cloud
      ? {
          /** The project as saved elsewhere; this tab's changes are dropped. */
          reload: () => void loadCloud(conflictId).catch((e: unknown) => fail('Could not open', e)),
          /** This tab's version over the other one. */
          keepMine: async () => {
            try {
              const latest = await (await cloud.backend()).getProject(conflictId);
              const r = refNow.current;
              if (r?.cloud) setRef({ ...r, cloud: { ...r.cloud, revision: latest.revision } });
              autosave.resume();
            } catch (e) {
              fail('Not saved', e);
            }
          },
          /** This tab's version as a new project, the other one kept (an account only). */
          saveCopy: () => void saveToCloud(true),
        }
      : null;

  return {
    ref,
    busy,
    notice,
    /** Cloud mode: where autosave is. */
    saveStatus,
    /** Cloud mode: another tab has the open project. */
    blocked,
    conflict,
    dismissNotice: () => setNotice(null),
    showError: fail,
    showInfo: (text: string) => setNotice({ kind: 'info', text }),
    openFile: () => openWith(() => storage.openFile()),
    openFolder: () => openWith(() => storage.openFolder()),
    openData: (r: FileRef, data: () => Promise<FileData>) => openWith(async () => ({ ref: r, data: await data() })),
    close: () =>
      guarded(() => {
        generation.current++;
        autosave.reset();
        store.close();
        session.closeDocument();
        original.current = null;
        setRef(null);
        setNotice(null);
        void dropRecovery();
      }),
    /** This tab takes the open project over from another (and reopens it as last saved). */
    takeOver: async () => {
      const id = refNow.current?.cloud?.id;
      if (!id) return;
      if (!(await lock.take(id, true, () => setBlockedOn({ id, why: 'taken' })))) return;
      setBlockedOn(null);
      blockedNow.current = null;
      await loadCloud(id).catch((e: unknown) => fail('Could not open', e));
    },
    /** Projects moved to another id (an anonymous user's, into the account they signed in to). */
    projectsMoved: (ids: Record<string, string>) => {
      const r = refNow.current;
      const to = r?.cloud && ids[r.cloud.id];
      if (r?.cloud && to) setRef({ ...r, cloud: { ...r.cloud, id: to, revision: 1 } });
      autosave.resume();
    },
    /** After a stop that wasn't a conflict (a quota, a sign-out): try again. */
    retrySave: () => autosave.resume(),
    importNew,
    /** Leaves the page (`go`), once the changes are saved or the user decided about them. */
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
    /** The question about changes not saved (to disk, or not yet to the cloud), while one is open. */
    unsaved: pending
      ? {
          /** Cloud mode: the changes didn't reach the cloud (they are kept in this browser until the project closes). */
          cloud: !!cloud,
          save: async () => {
            if (cloud) await autosave.flush();
            else await saveTo('same');
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
    recovery: recovery ? { fileName: recovery.fileName, at: recovery.at, recover: () => recoverNow(recovery, false), discard: discardRecovery } : null,
  };
}
