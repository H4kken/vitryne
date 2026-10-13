// SPDX-License-Identifier: AGPL-3.0-or-later
// Commands: the only way the document changes. A command records each entity it changes,
// before and after, so applying and reverting are exact (key order included), and checks
// that the document is where it expects before doing either. Builders check the JSON Schema
// of what they produce, so an invalid value never becomes a command.

import type { Fabric, Garment } from '@/format/schema.gen';
import { type Entities, getEntity, mainGarment, setEntity, type Slot, slotKey } from './entities';
import { deepEqual, getIn, type Path, setIn } from './json';
import { schemaErrors } from './validate';

export interface Change {
  slot: Slot;
  before: unknown;
  after: unknown;
}

export interface Command {
  label: string;
  /** Whether the drape depends on what it changes (a fabric value does, a name doesn't). */
  drape: boolean;
  changes: Change[];
  /**
   * Consecutive commands with the same key, within one gesture (a slider drag), merge into one
   * undo step.
   */
  coalesce?: string;
}

/** A command that can't be built or can't apply: nothing changed. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

function swap(e: Entities, cmd: Command, from: 'before' | 'after', to: 'before' | 'after'): Entities {
  let out = e;
  for (const c of cmd.changes) {
    const cur = getEntity(out, c.slot);
    if (cur !== c[from] && !deepEqual(cur, c[from])) {
      throw new CommandError(`${cmd.label}: the ${slotKey(c.slot)} is not in the state this command expects`);
    }
    out = setEntity(out, c.slot, c[to]);
  }
  return out;
}

export function applyCommand(e: Entities, cmd: Command): Entities {
  return swap(e, cmd, 'before', 'after');
}

export function revertCommand(e: Entities, cmd: Command): Entities {
  // Changes revert in reverse order.
  return swap(e, { ...cmd, changes: [...cmd.changes].reverse() }, 'after', 'before');
}

/** `a` then `b` as one command (`b` must start where `a` ends). */
export function mergeCommands(a: Command, b: Command): Command {
  const changes = a.changes.map((c) => ({ ...c }));
  for (const c of b.changes) {
    const prev = changes.find((x) => slotKey(x.slot) === slotKey(c.slot));
    if (prev) prev.after = c.after;
    else changes.push({ ...c });
  }
  return { ...b, label: b.label, drape: a.drape || b.drape, changes };
}

interface Options {
  label: string;
  drape: boolean;
  coalesce?: string;
}

/** Sets `path` in the entity at `slot` to `value` (`undefined` removes it). */
export function setValue(e: Entities, slot: Slot, path: Path, value: unknown, o: Options): Command {
  const before = getEntity(e, slot);
  if (before === undefined) throw new CommandError(`${o.label}: no ${slotKey(slot)}`);
  if (deepEqual(getIn(before, path), value)) throw new CommandError(`${o.label}: nothing changes`);
  const after = setIn(before, path, value);
  const problems = schemaErrors(slot.kind, after);
  if (problems.length) throw new CommandError(`${o.label}: ${problems.join('; ')}`);
  return { label: o.label, drape: o.drape, coalesce: o.coalesce, changes: [{ slot, before, after }] };
}

// ---- the edits of M6 -----------------------------------------------------------------------

export function renameProject(e: Entities, name: string): Command {
  return setValue(e, { kind: 'project' }, ['name'], name, { label: 'Rename the project', drape: false });
}

function indexOf<T extends { id: string }>(list: readonly T[] | undefined, id: string, what: string): number {
  const i = list?.findIndex((x) => x.id === id) ?? -1;
  if (i < 0) throw new CommandError(`no ${what} ${id}`);
  return i;
}

function garment(e: Entities, id: string): Garment {
  const g = e.garments.find((x) => x.id === id);
  if (!g) throw new CommandError(`no garment ${id}`);
  return g;
}

export function renamePiece(e: Entities, garmentId: string, pieceId: string, name: string): Command {
  const i = indexOf(garment(e, garmentId).pieces, pieceId, 'piece');
  return setValue(e, { kind: 'garment', id: garmentId }, ['pieces', i, 'name'], name, { label: 'Rename a piece', drape: false });
}

export function renameCut(e: Entities, garmentId: string, pieceId: string, cutId: string, name: string): Command {
  const g = garment(e, garmentId);
  const i = indexOf(g.pieces, pieceId, 'piece');
  const j = indexOf(g.pieces[i]?.cuts, cutId, 'cut');
  // An empty name falls back to the piece's (FORMAT.md): store none rather than "".
  return setValue(e, { kind: 'garment', id: garmentId }, ['pieces', i, 'cuts', j, 'name'], name === '' ? undefined : name, {
    label: 'Rename a cut',
    drape: false,
  });
}

export function renameSeam(e: Entities, garmentId: string, seamId: string, name: string): Command {
  const i = indexOf(garment(e, garmentId).seams, seamId, 'seam');
  return setValue(e, { kind: 'garment', id: garmentId }, ['seams', i, 'name'], name === '' ? undefined : name, {
    label: 'Rename a seam',
    drape: false,
  });
}

export function renameFabric(e: Entities, fabricId: string, name: string): Command {
  return setValue(e, { kind: 'fabric', id: fabricId }, ['name'], name, { label: 'Rename a fabric', drape: false });
}

/** The fabric values the properties panel edits, by path in the fabric. */
export const FABRIC_FIELDS = {
  density: ['density'],
  friction: ['friction'],
  stretchWarp: ['stretch', 'warp'],
  stretchWeft: ['stretch', 'weft'],
  stretchShear: ['stretch', 'shear'],
  bendingWarp: ['bending', 'warp'],
  bendingWeft: ['bending', 'weft'],
} as const satisfies Record<string, Path>;

export type FabricField = keyof typeof FABRIC_FIELDS;

export function fabricValue(f: Fabric, field: FabricField): number {
  return getIn(f, FABRIC_FIELDS[field]) as number;
}

export function setFabricValue(e: Entities, fabricId: string, field: FabricField, value: number): Command {
  if (!Number.isFinite(value)) throw new CommandError('a fabric value must be a number');
  return setValue(e, { kind: 'fabric', id: fabricId }, FABRIC_FIELDS[field], value, {
    label: 'Change the fabric',
    drape: true,
    coalesce: `fabric:${fabricId}:${field}`,
  });
}

// ---- simulation settings: the garment's value wins over the project's (FORMAT.md) ----------

interface SimulationLike {
  targetVertices?: number;
  engine?: Record<string, unknown>;
}

function simulations(e: Entities): { project?: SimulationLike; garment?: SimulationLike; garmentId?: string } {
  const g = mainGarment(e);
  return { project: e.project?.simulation as SimulationLike | undefined, garment: g?.simulation as SimulationLike | undefined, garmentId: g?.id };
}

/** Engine defaults (drape-core `SimSettings::default()`, `DEFAULT_TARGET_VERTICES`). */
export const DEFAULT_TARGET_VERTICES = 10_000;
const DEFAULT_SELF_COLLISION = false;

export function targetVertices(e: Entities): number {
  const s = simulations(e);
  return s.garment?.targetVertices ?? s.project?.targetVertices ?? DEFAULT_TARGET_VERTICES;
}

export function selfCollision(e: Entities): boolean {
  const s = simulations(e);
  const v = s.garment?.engine?.self_collision ?? s.project?.engine?.self_collision;
  return typeof v === 'boolean' ? v : DEFAULT_SELF_COLLISION;
}

/** Where a simulation setting is set: the garment if it sets it, else the project. */
function settingSlot(e: Entities, inGarment: boolean): Slot {
  const s = simulations(e);
  if (inGarment && s.garmentId) return { kind: 'garment', id: s.garmentId };
  if (!e.project) throw new CommandError('only a project has simulation settings');
  return { kind: 'project' };
}

export function setTargetVertices(e: Entities, n: number): Command {
  if (!Number.isInteger(n)) throw new CommandError('the vertex count must be a whole number');
  const slot = settingSlot(e, simulations(e).garment?.targetVertices !== undefined);
  return setValue(e, slot, ['simulation', 'targetVertices'], n, {
    label: 'Change the mesh resolution',
    drape: true,
    coalesce: 'simulation:targetVertices',
  });
}

export function setSelfCollision(e: Entities, on: boolean): Command {
  const slot = settingSlot(e, simulations(e).garment?.engine?.self_collision !== undefined);
  return setValue(e, slot, ['simulation', 'engine', 'self_collision'], on, {
    label: on ? 'Turn self-collision on' : 'Turn self-collision off',
    drape: true,
  });
}

/**
 * From the `saved` document to `current` (the same entities, other values): a recovery copy
 * put back, as one undoable step.
 */
export function recoverChanges(saved: Entities, current: Entities): Command {
  const changes: Change[] = [];
  const slots: Slot[] = [
    ...(saved.project ? [{ kind: 'project' } as const] : []),
    ...(saved.view ? [{ kind: 'view' } as const] : []),
    ...saved.garments.map((g) => ({ kind: 'garment', id: g.id }) as const),
    ...saved.fabrics.map((f) => ({ kind: 'fabric', id: f.id }) as const),
    ...saved.avatars.map((a) => ({ kind: 'avatar', id: a.id }) as const),
  ];
  for (const slot of slots) {
    const before = getEntity(saved, slot);
    const after = getEntity(current, slot);
    if (after === undefined) throw new CommandError(`the recovery copy has no ${slotKey(slot)}`);
    if (deepEqual(before, after)) continue;
    const problems = schemaErrors(slot.kind, after);
    if (problems.length) throw new CommandError(`the recovery copy is damaged: ${problems.join('; ')}`);
    changes.push({ slot, before, after });
  }
  if (!changes.length) throw new CommandError('the recovery copy has no changes');
  return { label: 'Recover unsaved changes', drape: true, changes };
}
