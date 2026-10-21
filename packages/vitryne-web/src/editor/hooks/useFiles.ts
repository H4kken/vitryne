// SPDX-License-Identifier: AGPL-3.0-or-later
// Opening and saving, and what protects the user's work: autosave to the cloud (src/cloud/
// autosave.ts, run by useAutosaveTriggers) once Rust validated the document, one tab per cloud
// project (useProjectLock), and the recovery copy (useRecoveryCopy), which keeps what hasn't
// reached the cloud yet. Projects open and save in the folder form; a file from disk opens as a
// new project. Nothing is saved to disk.

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveStatus } from "@/cloud/autosave";
import type { CloudBackend, CloudUser } from "@/cloud/backend";
import {
  type CloudRef,
  collectUnused,
  copyName,
  duplicateProject,
  openProject,
  saveProject,
} from "@/cloud/projects";
import { recoverChanges, renameProject } from "@/document/commands";
import { parseEntities } from "@/document/entities";
import type { DocState, DocumentStore } from "@/document/store";
import { dropRecovery, findRecovery, type Recovery } from "@/storage/recovery";
import type { FileOpener, FileRef } from "@/storage/storage";
import { copyFileData, type FileData } from "@/worker/protocol";
import type { EngineSession } from "@/worker/session";
import { useProjectLock } from "./useProjectLock";
import { useAutosaveTriggers } from "./useAutosaveTriggers";
import { useRecoveryCopy } from "./useRecoveryCopy";

/** ok: a save (shown by the title); info: worth a card; error: what went wrong. */
export type Notice = { kind: "ok" | "info" | "error"; text: string } | null;

/** Unused parts are looked for at most this often (each look is a query). */
const COLLECT_EVERY_MS = 10 * 60 * 1000;

/** What saving needs from the cloud backend. */
export interface CloudAccess {
  user: CloudUser | null;
  backend(): Promise<CloudBackend>;
  refresh(): void;
}

/** A project or example a URL named that couldn't be opened: `key` is `design:<id>` or `example:<name>`. */
export type OpenError = { key: string; message: string } | null;

/** Why this tab can't edit the open cloud project: another tab has it, or took it over. */
export type Blocked = "elsewhere" | "taken" | null;

const errorText = (e: unknown) => (e as Error).message ?? String(e);

/** An anonymous user's draft (their one project), to save a new project over. */
async function draftOf(b: CloudBackend): Promise<CloudRef | null> {
  const [d] = await b.listProjects();
  return d ? { id: d.id, revision: d.revision, parts: [] } : null;
}

export function useFiles(
  session: EngineSession,
  store: DocumentStore,
  disk: FileOpener,
  doc: DocState,
  cloud: CloudAccess,
) {
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
  const [pending, setPending] = useState<{
    run: () => void;
    cancelled?: () => void;
  } | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [openError, setOpenError] = useState<OpenError>(null);
  /** The file as opened or last saved, for the recovery copy. */
  const original = useRef<FileData | null>(null);
  /** Bumped by every open and close: a save that finishes after one is about another document. */
  const generation = useRef(0);
  /** `generation` for rendering: what the URL follows (a new document, or the same one saved). */
  const [opened, setOpened] = useState(0);
  const nextDocument = () => setOpened(++generation.current);
  const { blocked, blockedNow, takeLock } = useProjectLock(
    ref?.cloud?.id ?? null,
  );
  const lastCollect = useRef(0);
  /** The anonymous user was told once that their draft is in the cloud. */

  const fail = (what: string, e: unknown) =>
    setNotice({ kind: "error", text: `${what}: ${errorText(e)}` });

  /**
   * Saves the confirmed document to the cloud: over the project it came from, as a new one
   * (`copy`, or never saved), or for an anonymous user over their draft. Throws what failed.
   */
  const pushToCloud = useCallback(
    async (copy: boolean, progress?: (text: string) => void) => {
      const c = cloudNow.current;
      const gen = generation.current;
      const { rev, entities } = await store.settled();
      const data = await session.save(rev, "folder");
      if (data.form !== "folder")
        throw new Error("internal: the worker did not give the folder form");
      const b = await c.backend();
      const r = refNow.current;
      const name =
        store.state.entities.project?.name ??
        r?.name.replace(/\.vtry$/, "") ??
        "project";
      let prev = copy ? null : (r?.cloud ?? null);
      if (!prev && !copy && b.user()?.anonymous) prev = await draftOf(b);
      const saved = await saveProject(
        b,
        name,
        data.files,
        prev,
        (p) =>
          p.total > 1 &&
          progress?.(`Saving to the cloud (${p.done} of ${p.total})`),
      );
      if (gen !== generation.current) return;
      store.markSaved(name, entities);
      original.current = copyFileData(data);
      setRef({ name, form: "folder", cloud: saved });
      if (!prev || prev.id !== saved.id) c.refresh();
      // Parts no project uses any more (older than a day), best effort.
      if (Date.now() - lastCollect.current > COLLECT_EVERY_MS) {
        lastCollect.current = Date.now();
        void collectUnused(b).catch(() => undefined);
      }
    },
    [session, store, setRef],
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "saved" });
  const [autosave] = useState(() => new Autosaver(setSaveStatus));
  useEffect(() => {
    autosave.connect(
      () => pushToCloud(false),
      () => !store.state.empty && store.state.dirty && !blockedNow.current,
    );
  }, [autosave, pushToCloud, store, blockedNow]);
  useEffect(() => () => autosave.dispose(), [autosave]);

  useAutosaveTriggers(autosave, doc, blocked, cloud.user);

  const load = useCallback(
    async (r: FileRef, data: FileData, opts: { unsaved?: boolean } = {}) => {
      // Revisions keep growing across files, so a drape of the previous file is never newer.
      const rev = store.state.rev + 1;
      const { entities, warnings } = await session.open(
        copyFileData(data),
        rev,
      );
      nextDocument();
      autosave.reset();
      setOpenError(null);
      store.load(r.name, parseEntities(entities), warnings, rev, opts);
      original.current = copyFileData(data);
      // A document not in the cloud yet becomes a project at its first save.
      setRef(opts.unsaved ? null : r);
      session.drape(rev, true);
      void dropRecovery();
      return entities;
    },
    [session, store, autosave, setRef],
  );

  /** Runs `action` now, or once the changes are saved, or after the user decided about them. */
  const guarded = (
    action: () => Promise<void> | void,
    cancelled?: () => void,
  ) => {
    const run = () =>
      void Promise.resolve(action()).catch((e: unknown) =>
        fail("Could not open", e),
      );
    if (!store.state.dirty) return run();
    if (blockedNow.current) return setPending(() => ({ run, cancelled }));
    void autosave
      .flush()
      .then((saved) =>
        saved ? run() : setPending(() => ({ run, cancelled })),
      );
  };

  /**
   * A project made from an imported pattern, or from scratch: a new cloud project at once.
   * `told`: what the person is told once it is open (default: how to go on after an import;
   * null: nothing).
   */
  const importNew = (
    make: (rev: number) => Promise<{
      name: string;
      entities: string;
      notes: string[];
      zip: ArrayBuffer;
    }>,
    told?: string | null,
  ) =>
    new Promise<void>((resolve, reject) => {
      guarded(
        async () => {
          try {
            setBusy(told === undefined ? "Importing" : "Creating");
            const rev = store.state.rev + 1;
            const m = await make(rev);
            nextDocument();
            autosave.reset();
            store.load(m.name, parseEntities(m.entities), m.notes, rev, {
              unsaved: true,
            });
            original.current = { form: "zip", bytes: m.zip.slice(0) };
            setRef(null);
            session.drape(rev, true);
            void dropRecovery();
            setNotice(
              told === null
                ? null
                : {
                    kind: "info",
                    text:
                      told ??
                      `Imported ${m.name}. Pick Select in the 3D view to move a piece, or the Pieces panel to change where it starts.`,
                  },
            );
            resolve();
          } catch (e) {
            reject(e as Error);
          } finally {
            setBusy(null);
          }
        },
        () => reject(new Error("cancelled")),
      );
    });

  /** A file from disk, which becomes a new cloud project at once (an example waits for an edit). */
  const openWith = (
    pick: () => Promise<{ ref: FileRef; data: FileData } | null>,
  ) =>
    guarded(async () => {
      const o = await pick();
      if (!o) return;
      setBusy("Opening");
      try {
        await load(o.ref, o.data, { unsaved: true });
        setNotice(null);
      } finally {
        setBusy(null);
      }
    });

  /** A copy of the open project, opened in its place (an account only); the original keeps its last save. */
  const duplicate = () =>
    guarded(async () => {
      const id = refNow.current?.cloud?.id;
      if (!id) return;
      setBusy("Duplicating");
      try {
        const copy = await duplicateProject(await cloud.backend(), id);
        cloud.refresh();
        await loadCloud(copy.id);
        setNotice({
          kind: "info",
          text: `This is ${copy.name}, a copy. The original is in your projects.`,
        });
      } catch (e) {
        fail("Not duplicated", e);
      } finally {
        setBusy(null);
      }
    });

  /** After a conflict: this tab's version as a new project named "(copy)", the other kept. */
  const saveCopy = async () => {
    setBusy("Saving a copy");
    try {
      const name = store.state.entities.project?.name;
      if (name) store.execute((e) => renameProject(e, copyName(name)));
      await pushToCloud(true, setBusy);
      autosave.resume();
    } catch (e) {
      fail("Not saved", e);
    } finally {
      setBusy(null);
    }
  };

  const loadCloud = async (id: string) => {
    setBusy("Opening from the cloud");
    try {
      const o = await openProject(await cloudNow.current.backend(), id);
      await load({ name: o.name, form: "folder", cloud: o.ref }, o.data);
      setNotice(null);
    } finally {
      setBusy(null);
    }
  };

  /** A failed open is kept in `openError` (its page says why); `cancelled`: the user kept what was open. */
  const openCloud = (id: string, cancelled?: () => void) =>
    guarded(() => {
      setOpenError(null);
      return loadCloud(id).catch((e: unknown) =>
        setOpenError({ key: `design:${id}`, message: errorText(e) }),
      );
    }, cancelled);

  /** A bundled example, not saved until it is changed; failures and `cancelled` as `openCloud`. */
  const openExample = (
    name: string,
    file: string,
    bytes: () => Promise<ArrayBuffer>,
    cancelled?: () => void,
  ) =>
    guarded(async () => {
      setOpenError(null);
      setBusy("Opening");
      try {
        const data: FileData = { form: "zip", bytes: await bytes() };
        await load({ name: file, form: "zip", example: name }, data);
        setNotice(null);
      } catch (e) {
        setOpenError({ key: `example:${name}`, message: errorText(e) });
      } finally {
        setBusy(null);
      }
    }, cancelled);

  useRecoveryCopy(doc, store, original, refNow);

  const recoverNow = useCallback(
    async (r: Recovery, auto: boolean) => {
      setRecovery(null);
      setBusy("Recovering");
      try {
        await load(
          { name: r.fileName, form: r.data.form, cloud: r.cloud },
          r.data,
          { unsaved: r.unsaved },
        );
        // An import never edited has nothing to put back but itself.
        if (
          r.current !== r.saved &&
          !store.execute((e) => recoverChanges(e, parseEntities(r.current)))
        ) {
          throw new Error(store.state.refused ?? "refused");
        }
        await dropRecovery(r.tab);
        setNotice({
          kind: "info",
          text: `${auto ? "Put back" : "Recovered"} your changes to ${r.fileName} that hadn't reached the cloud yet. They are being saved.`,
        });
      } catch (e) {
        fail("Could not recover", e);
      } finally {
        setBusy(null);
      }
    },
    [load, store],
  );

  // A copy left by a crash, a closed tab or a lost connection, once at start: put back by itself
  // when nothing else saved the project since (or it never reached the cloud), otherwise offered.
  const started = useRef<Promise<void> | null>(null);
  const startup = () =>
    (started.current ??= findRecovery().then(async (r) => {
      if (!r) return;
      try {
        const current = r.cloud
          ? (await (await cloudNow.current.backend()).getProject(r.cloud.id))
              .revision
          : null;
        if (!r.cloud || current === r.cloud.revision)
          return recoverNow(r, true);
      } catch {
        // Offline, or the project is gone: ask.
      }
      setRecovery(r);
    }));
  const startupNow = useRef(startup);
  useEffect(() => {
    void startupNow.current();
  }, []);

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
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [doc.dirty]);

  /** The project saved elsewhere since this tab opened it: the person picks a version. */
  const conflictId =
    saveStatus.kind === "stopped" && saveStatus.reason === "conflict"
      ? (ref?.cloud?.id ?? null)
      : null;
  const conflict = conflictId
    ? {
        /** The project as saved elsewhere; this tab's changes are dropped. */
        reload: () =>
          void loadCloud(conflictId).catch((e: unknown) =>
            fail("Could not open", e),
          ),
        /** This tab's version over the other one. */
        keepMine: async () => {
          try {
            const latest = await (await cloud.backend()).getProject(conflictId);
            const r = refNow.current;
            if (r?.cloud)
              setRef({
                ...r,
                cloud: { ...r.cloud, revision: latest.revision },
              });
            autosave.resume();
          } catch (e) {
            fail("Not saved", e);
          }
        },
        /** This tab's version as a new project, the other one kept (an account only). */
        saveCopy: () => void saveCopy(),
      }
    : null;

  return {
    ref,
    /** Changes with every open and close (not with a save). */
    opened,
    /** Resolves once the recovery copy left at start was put back (or offered). */
    started: () => startupNow.current(),
    busy,
    notice,
    /** Where autosave is. */
    saveStatus,
    /** Another tab has the open project. */
    blocked,
    conflict,
    dismissNotice: () => setNotice(null),
    showError: fail,
    showInfo: (text: string) => setNotice({ kind: "info", text }),
    /** A .vtry picked or dropped: a new project. */
    openVtry: (file: File) =>
      openWith(async () => ({
        ref: { name: file.name, form: "zip" },
        data: { form: "zip", bytes: await file.arrayBuffer() },
      })),
    openFolder: () => openWith(() => disk.openFolder()),
    openExample,
    /** Why the project or example the URL names couldn't be opened. */
    openError,
    close: (undone?: () => void) =>
      guarded(() => {
        nextDocument();
        autosave.reset();
        setOpenError(null);
        store.close();
        session.closeDocument();
        original.current = null;
        setRef(null);
        setNotice(null);
        void dropRecovery();
      }, undone),
    /** This tab takes the open project over from another (and reopens it as last saved). */
    takeOver: async () => {
      const id = refNow.current?.cloud?.id;
      if (!id) return;
      if (!(await takeLock(id))) return;
      await loadCloud(id).catch((e: unknown) => fail("Could not open", e));
    },
    /** Projects moved to another id (an anonymous user's, into the account they signed in to). */
    projectsMoved: (ids: Record<string, string>) => {
      const r = refNow.current;
      const to = r?.cloud && ids[r.cloud.id];
      if (r?.cloud && to)
        setRef({ ...r, cloud: { ...r.cloud, id: to, revision: 1 } });
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
    /** Saves what is waiting now (it would be in a moment anyway). */
    save: () => void autosave.flush(),
    duplicate,
    openCloud,
    /** The question about changes that didn't reach the cloud, while one is open. */
    unsaved: pending
      ? {
          save: async () => {
            await autosave.flush();
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
    recovery: recovery
      ? {
          fileName: recovery.fileName,
          at: recovery.at,
          recover: () => recoverNow(recovery, false),
          discard: discardRecovery,
        }
      : null,
  };
}
