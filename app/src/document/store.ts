// SPDX-License-Identifier: AGPL-3.0-or-later
// The open document: its entities, the undo and redo stacks, and its sync with the engine
// worker (docs/ARCHITECTURE.md, Document model). Every change is a command; each new state
// is sent to the worker, which validates it in Rust. A refused state rolls the document back
// to the last one Rust accepted, and says why. Drape-relevant changes re-drape, debounced.

import { useSyncExternalStore } from 'react';
import { applyCommand, type Command, CommandError, mergeCommands, revertCommand } from './commands';
import type { Entities } from './entities';
import { deepEqual, deepFreeze } from './json';

/** What the store needs from the engine (an `EngineSession`, or a fake in tests). */
export interface Engine {
  update(rev: number, entities: string): Promise<{ warnings: string[] }>;
  drape(rev: number, frameCamera: boolean): void;
  /** Called after a restarted worker has the last confirmed document again. */
  onReopened(cb: () => void): void;
}

/** The worker went away mid-request: not a refusal, the edit is sent again after the restart. */
export function isUnavailable(e: unknown): boolean {
  return e instanceof Error && e.name === 'WorkerCrashed';
}

export interface DocState {
  /** No document yet. */
  empty: boolean;
  fileName: string;
  entities: Entities;
  /** Bumped by every change, undo and redo. */
  rev: number;
  /** The document differs from the file as last opened or saved. */
  dirty: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** The last edit refused (by a command's checks or by Rust), shown until the next edit. */
  refused: string | null;
  /** Rust's warnings about the current document. */
  warnings: string[];
  /** Edits not yet confirmed by Rust (saving waits for them). */
  syncing: boolean;
}

interface Snapshot {
  rev: number;
  entities: Entities;
  undo: Command[];
  redo: Command[];
}

/** Debounce for re-drapes: a burst of edits (typing, a slider) drapes once. */
export const DRAPE_DELAY_MS = 250;

const EMPTY: Entities = { kind: 'project', garments: [], fabrics: [], avatars: [] };

export class DocumentStore {
  private listeners = new Set<() => void>();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private gesture: string | null = null;
  private saved: Entities = EMPTY;
  /** The newest state Rust accepted, and the stacks that went with it. */
  private confirmed: Snapshot = { rev: 0, entities: EMPTY, undo: [], redo: [] };
  private inFlight = false;
  private pending = false;
  private drapeDirty = false;
  private drapeTimer: ReturnType<typeof setTimeout> | undefined;
  private idleWaiters: (() => void)[] = [];

  state: DocState = {
    empty: true,
    fileName: '',
    entities: EMPTY,
    rev: 0,
    dirty: false,
    undoLabel: null,
    redoLabel: null,
    refused: null,
    warnings: [],
    syncing: false,
  };

  constructor(
    private readonly engine: Engine,
    private readonly opts: { freeze: boolean; drapeDelayMs: number } = { freeze: import.meta.env.DEV, drapeDelayMs: DRAPE_DELAY_MS },
  ) {
    engine.onReopened(() => {
      if (!this.state.empty && this.state.rev !== this.confirmed.rev && !this.inFlight) this.sync();
    });
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private publish(patch: Partial<DocState>) {
    const next = { ...this.state, ...patch };
    if (this.opts.freeze) deepFreeze(next.entities);
    next.dirty = !next.empty && next.entities !== this.saved && !deepEqual(next.entities, this.saved);
    next.undoLabel = this.undoStack.at(-1)?.label ?? null;
    next.redoLabel = this.redoStack.at(-1)?.label ?? null;
    next.syncing = this.inFlight || this.pending;
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** A document just opened (already in the worker, at revision `rev`). */
  load(fileName: string, entities: Entities, warnings: string[], rev: number) {
    clearTimeout(this.drapeTimer);
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.saved = entities;
    this.confirmed = { rev, entities, undo: [], redo: [] };
    this.drapeDirty = false;
    this.publish({ empty: false, fileName, entities, rev, refused: null, warnings });
  }

  /** Back to nothing open (the caller asked about unsaved changes first). */
  close() {
    clearTimeout(this.drapeTimer);
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.saved = EMPTY;
    this.drapeDirty = false;
    this.publish({ empty: true, fileName: '', entities: EMPTY, rev: this.state.rev + 1, refused: null, warnings: [] });
  }

  /** The document as last opened or saved. */
  get savedEntities(): Entities {
    return this.saved;
  }

  /** The document as just saved: it is the file now. */
  markSaved(fileName: string, entities: Entities) {
    this.saved = entities;
    this.publish({ fileName });
  }

  // ---- changes --------------------------------------------------------------------------

  /**
   * Applies a command built by one of `commands.ts`'s builders. `build` gets the current
   * entities; if it throws a `CommandError` nothing changes and the reason is shown.
   */
  execute(build: (e: Entities) => Command): boolean {
    if (this.state.empty) return false;
    let cmd: Command;
    let entities: Entities;
    try {
      cmd = build(this.state.entities);
      entities = applyCommand(this.state.entities, cmd);
    } catch (e) {
      if (e instanceof CommandError) {
        this.publish({ refused: e.message });
        return false;
      }
      throw e;
    }
    const top = this.undoStack.at(-1);
    if (top && cmd.coalesce && this.gesture === cmd.coalesce && top.coalesce === cmd.coalesce) {
      this.undoStack[this.undoStack.length - 1] = mergeCommands(top, cmd);
    } else {
      this.undoStack.push(cmd);
    }
    this.redoStack = [];
    this.changed(entities, cmd.drape);
    return true;
  }

  /** Commands with this coalesce key merge into one undo step until `endGesture`. */
  beginGesture(key: string) {
    this.gesture = key;
  }

  endGesture() {
    this.gesture = null;
  }

  dismissRefused() {
    this.publish({ refused: null });
  }

  undo() {
    const cmd = this.undoStack.at(-1);
    if (!cmd) return;
    this.gesture = null;
    const entities = revertCommand(this.state.entities, cmd);
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.changed(entities, cmd.drape);
  }

  redo() {
    const cmd = this.redoStack.at(-1);
    if (!cmd) return;
    this.gesture = null;
    const entities = applyCommand(this.state.entities, cmd);
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.changed(entities, cmd.drape);
  }

  private changed(entities: Entities, drape: boolean) {
    if (drape) this.drapeDirty = true;
    this.publish({ entities, rev: this.state.rev + 1, refused: null });
    this.sync();
  }

  // ---- the worker -----------------------------------------------------------------------

  /** Sends the newest state; one request at a time, intermediate states are skipped. */
  private sync() {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    const snap: Snapshot = {
      rev: this.state.rev,
      entities: this.state.entities,
      undo: [...this.undoStack],
      redo: [...this.redoStack],
    };
    this.inFlight = true;
    this.pending = false;
    this.publish({});
    this.engine.update(snap.rev, JSON.stringify(snap.entities)).then(
      ({ warnings }) => {
        this.inFlight = false;
        this.confirmed = snap;
        if (this.pending) this.sync();
        else {
          this.publish({ warnings });
          this.scheduleDrape();
          this.notifyIdle();
        }
      },
      (e: Error) => {
        this.inFlight = false;
        if (isUnavailable(e)) {
          // Kept: `onReopened` sends it again.
          this.pending = false;
          this.publish({});
          return;
        }
        this.pending = false;
        this.rollback(e.message);
        this.notifyIdle();
      },
    );
  }

  /** Back to the last state Rust accepted (the worker still holds it). */
  private rollback(reason: string) {
    const c = this.confirmed;
    this.undoStack = [...c.undo];
    this.redoStack = [...c.redo];
    this.gesture = null;
    this.confirmed = { ...c, rev: this.state.rev + 1 };
    this.publish({ entities: c.entities, rev: this.state.rev + 1, refused: `The change was undone: ${reason}` });
    this.scheduleDrape();
  }

  private scheduleDrape() {
    if (!this.drapeDirty) return;
    clearTimeout(this.drapeTimer);
    this.drapeTimer = setTimeout(() => {
      this.drapeDirty = false;
      this.engine.drape(this.confirmed.rev, false);
    }, this.opts.drapeDelayMs);
  }

  private notifyIdle() {
    if (this.inFlight || this.pending) return;
    for (const w of this.idleWaiters.splice(0)) w();
  }

  /** Resolves once Rust has confirmed every edit; gives the confirmed revision and entities. */
  async settled(): Promise<{ rev: number; entities: Entities }> {
    if (this.inFlight || this.pending) await new Promise<void>((r) => this.idleWaiters.push(r));
    return { rev: this.confirmed.rev, entities: this.confirmed.entities };
  }
}

export function useDocument(store: DocumentStore): DocState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
