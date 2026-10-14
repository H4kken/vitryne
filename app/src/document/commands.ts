// SPDX-License-Identifier: AGPL-3.0-or-later
// Commands: the only way the document changes. A command records each entity it changes,
// before and after, so applying and reverting are exact (key order included), and checks
// that the document is where it expects before doing either. Builders check the JSON Schema
// of what they produce, so an invalid value never becomes a command.

import type { Cut, Fabric, Garment, Piece, Placement, Seam, Source, Vec3 } from '@/format/schema.gen';
import { findPreset } from '@/format/presets';
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
  thickness: ['thickness'],
  friction: ['friction'],
  stretchWarp: ['stretch', 'warp'],
  stretchWeft: ['stretch', 'weft'],
  stretchShear: ['stretch', 'shear'],
  bendingWarp: ['bending', 'warp'],
  bendingWeft: ['bending', 'weft'],
} as const satisfies Record<string, Path>;

export type FabricField = keyof typeof FABRIC_FIELDS;

export function fabricValue(f: Fabric, field: FabricField): number {
  const v = getIn(f, FABRIC_FIELDS[field]);
  if (v === undefined && field === 'thickness') return 0.5;
  return v as number;
}

export function setFabricValue(e: Entities, fabricId: string, field: FabricField, value: number): Command {
  if (!Number.isFinite(value)) throw new CommandError('a fabric value must be a number');
  return setValue(e, { kind: 'fabric', id: fabricId }, FABRIC_FIELDS[field], value, {
    label: 'Change the fabric',
    drape: true,
    coalesce: `fabric:${fabricId}:${field}`,
  });
}

/** Copies all physical properties of a preset onto an existing fabric. */
export function applyFabricPreset(e: Entities, fabricId: string, preset: Fabric): Command {
  const before = e.fabrics.find((f) => f.id === fabricId);
  if (!before) throw new CommandError(`no fabric ${fabricId}`);
  const after: Fabric = {
    ...before,
    name: preset.name,
    category: preset.category,
    density: preset.density,
    thickness: preset.thickness,
    stretch: { ...preset.stretch },
    bending: { ...preset.bending },
    friction: preset.friction,
    notes: preset.notes,
  };
  const problems = schemaErrors('fabric', after);
  if (problems.length) throw new CommandError(`Apply preset: ${problems.join('; ')}`);
  return {
    label: `Apply ${preset.name} preset`,
    drape: true,
    changes: [{ slot: { kind: 'fabric', id: fabricId }, before, after }],
  };
}

/** Changes a garment's default fabric. Adds preset fabric if needed. */
export function setGarmentFabric(e: Entities, garmentId: string, fabricId: string): Command {
  const g = garment(e, garmentId);
  if (g.fabric === fabricId) throw new CommandError('garment already has this fabric');
  const changes: Change[] = [];
  const preset = findPreset(fabricId);
  if (!e.fabrics.some((f) => f.id === fabricId) && preset) {
    changes.push({ slot: { kind: 'fabric', id: preset.id }, before: undefined, after: preset });
    if (e.project && !e.project.fabrics.includes(preset.id)) {
      changes.push({
        slot: { kind: 'project' },
        before: e.project,
        after: { ...e.project, fabrics: [...e.project.fabrics, preset.id] },
      });
    }
  }
  const afterGarment: Garment = { ...g, fabric: fabricId };
  changes.push({ slot: { kind: 'garment', id: garmentId }, before: g, after: afterGarment });
  return {
    label: 'Change garment fabric',
    drape: true,
    changes,
  };
}

/** Overrides or resets one cut's fabric. Adds preset fabric if needed. */
export function setCutFabric(e: Entities, garmentId: string, cutId: string, fabricId: string | undefined): Command {
  const g = garment(e, garmentId);
  const found = findCut(g, cutId);
  if (!found) throw new CommandError(`no cut ${cutId}`);
  if (found.cut.fabric === fabricId) throw new CommandError('cut already has this fabric');
  const [i, j] = cutAt(g, cutId);

  const changes: Change[] = [];
  if (fabricId) {
    const preset = findPreset(fabricId);
    if (!e.fabrics.some((f) => f.id === fabricId) && preset) {
      changes.push({ slot: { kind: 'fabric', id: preset.id }, before: undefined, after: preset });
      if (e.project && !e.project.fabrics.includes(preset.id)) {
        changes.push({
          slot: { kind: 'project' },
          before: e.project,
          after: { ...e.project, fabrics: [...e.project.fabrics, preset.id] },
        });
      }
    }
  }

  const afterGarment = setIn(g, ['pieces', i, 'cuts', j, 'fabric'], fabricId);
  const problems = schemaErrors('garment', afterGarment);
  if (problems.length) throw new CommandError(`Change cut fabric: ${problems.join('; ')}`);
  changes.push({ slot: { kind: 'garment', id: garmentId }, before: g, after: afterGarment });
  return {
    label: fabricId ? 'Change cut fabric' : 'Reset cut fabric to default',
    drape: true,
    changes,
  };
}

/** Overrides or resets all cuts of a piece to a fabric. Adds preset fabric if needed. */
export function setPieceFabric(e: Entities, garmentId: string, pieceId: string, fabricId: string | undefined): Command {
  const g = garment(e, garmentId);
  const pieceIndex = indexOf(g.pieces, pieceId, 'piece');
  const piece = g.pieces[pieceIndex];
  if (!piece) throw new CommandError(`no piece ${pieceId}`);
  const allMatch = piece.cuts.every((c) => c.fabric === fabricId);
  if (allMatch) throw new CommandError('piece already has this fabric');

  const changes: Change[] = [];
  if (fabricId) {
    const preset = findPreset(fabricId);
    if (!e.fabrics.some((f) => f.id === fabricId) && preset) {
      changes.push({ slot: { kind: 'fabric', id: preset.id }, before: undefined, after: preset });
      if (e.project && !e.project.fabrics.includes(preset.id)) {
        changes.push({
          slot: { kind: 'project' },
          before: e.project,
          after: { ...e.project, fabrics: [...e.project.fabrics, preset.id] },
        });
      }
    }
  }

  let afterGarment = g;
  for (let j = 0; j < piece.cuts.length; j++) {
    afterGarment = setIn(afterGarment, ['pieces', pieceIndex, 'cuts', j, 'fabric'], fabricId);
  }
  const problems = schemaErrors('garment', afterGarment);
  if (problems.length) throw new CommandError(`Change piece fabric: ${problems.join('; ')}`);
  changes.push({ slot: { kind: 'garment', id: garmentId }, before: g, after: afterGarment });
  return {
    label: fabricId ? 'Change piece fabric' : 'Reset piece fabric to default',
    drape: true,
    changes,
  };
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

// ---- M7: where cuts start on the body, and where they sit in the flat view -----------------

/** A collision box, mm (`garment.simulation.collisionBounds`). */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** The piece and cut indices of a cut in its garment. */
function cutAt(g: Garment, cutId: string): [number, number] {
  for (const [i, piece] of g.pieces.entries()) {
    const j = piece.cuts.findIndex((c) => c.id === cutId);
    if (j >= 0) return [i, j];
  }
  throw new CommandError(`no cut ${cutId}`);
}

export function findCut(g: Garment, cutId: string): { piece: Piece; cut: Cut } | undefined {
  for (const piece of g.pieces) {
    const cut = piece.cuts.find((c) => c.id === cutId);
    if (cut) return { piece, cut };
  }
  return undefined;
}

/** `cutId` and the cuts placed on it, directly or not: it can't go on top of any of them. */
export function followers(g: Garment, cutId: string): Set<string> {
  const out = new Set<string>([cutId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const piece of g.pieces) {
      for (const c of piece.cuts) {
        if (!out.has(c.id) && c.placement.type === 'follow' && c.placement.cut && out.has(c.placement.cut)) {
          out.add(c.id);
          grew = true;
        }
      }
    }
  }
  return out;
}

/** A change to one garment, built by `edit` (which may throw a `CommandError`). */
function editGarment(e: Entities, garmentId: string, edit: (g: Garment) => Garment, o: Options): Command {
  const before = garment(e, garmentId);
  const after = edit(before);
  if (deepEqual(before, after)) throw new CommandError(`${o.label}: nothing changes`);
  const problems = schemaErrors('garment', after);
  if (problems.length) throw new CommandError(`${o.label}: ${problems.join('; ')}`);
  return { label: o.label, drape: o.drape, coalesce: o.coalesce, changes: [{ slot: { kind: 'garment', id: garmentId }, before, after }] };
}

/**
 * Where a cut starts on the body. `bounds`: a new collision box for the garment, when the
 * cut needs a bigger one there (Rust's `rewrap` says). `coalesce`: a drag of one field.
 */
export function setPlacement(e: Entities, garmentId: string, cutId: string, placement: Placement, bounds?: Bounds, coalesce?: string): Command {
  for (const k of ['angle', 'radius', 'top', 'rotation', 'tube', 'lift'] as const) {
    const v = placement[k];
    if (v !== undefined && !Number.isFinite(v)) throw new CommandError(`a placement's ${k} must be a number`);
  }
  if (placement.type === 'follow') {
    const g = garment(e, garmentId);
    if (!placement.cut || !findCut(g, placement.cut)) throw new CommandError('it must go on a piece of this garment');
    if (followers(g, cutId).has(placement.cut)) throw new CommandError("a piece can't go on itself, or on a piece that goes on it");
  }
  return editGarment(
    e,
    garmentId,
    (g) => {
      const [i, j] = cutAt(g, cutId);
      let out = setIn(g, ['pieces', i, 'cuts', j, 'placement'], placement);
      if (bounds) out = setIn(out, ['simulation', 'collisionBounds'], bounds);
      return out;
    },
    { label: 'Move a piece on the body', drape: true, coalesce },
  );
}

/** A cut becomes the mirror image of the piece, or stops being it. */
export function setMirrored(e: Entities, garmentId: string, cutId: string, mirrored: boolean): Command {
  return editGarment(
    e,
    garmentId,
    (g) => {
      const [i, j] = cutAt(g, cutId);
      // `false` is the default: store none rather than false.
      return setIn(g, ['pieces', i, 'cuts', j, 'mirrored'], mirrored || undefined);
    },
    { label: 'Flip a piece', drape: true },
  );
}

/** Where a cut sits in the flat view (FORMAT.md, Cuts: display only). */
export interface Layout {
  position: [number, number];
  rotation: number;
}

export function setLayout(e: Entities, garmentId: string, cutId: string, layout: Layout): Command {
  if (![...layout.position, layout.rotation].every(Number.isFinite)) throw new CommandError('a layout must be numbers');
  return editGarment(
    e,
    garmentId,
    (g) => {
      const [i, j] = cutAt(g, cutId);
      const old = g.pieces[i]?.cuts[j]?.layout;
      // Unknown members of the layout stay.
      let l: Record<string, unknown> = { ...(old ?? {}) };
      l = setIn(l, ['position'], layout.position);
      l = setIn(l, ['rotation'], layout.rotation === 0 ? undefined : layout.rotation);
      return setIn(g, ['pieces', i, 'cuts', j, 'layout'], l);
    },
    { label: 'Arrange the pieces', drape: false, coalesce: `layout:${cutId}` },
  );
}

// ---- M8: sewing ----------------------------------------------------------------------------

type Run = Seam['a'][number];

/** The same stretch of outline, walked the other way (FORMAT.md: to reverse a side, write its runs the other way). */
function reversedRuns(runs: readonly Run[]): [Run, ...Run[]] {
  const out = [...runs].reverse().map((r) => {
    const flipped: Run = { ...r, from: r.to, to: r.from };
    if (r.direction !== undefined) flipped.direction = r.direction === 'ccw' ? 'cw' : 'ccw';
    return flipped;
  });
  return out as [Run, ...Run[]];
}

/**
 * A seam the user accepted, or two whole edges they picked (Rust's `seams::SeamProposal`, which
 * only ever holds whole edges of one cut or chains of them). docs/PATENTS.md: nothing here is
 * built from a point the user placed on an edge.
 */
export interface SeamDraft {
  a: Run[];
  b: Run[];
  pairing?: 'nodes' | 'length';
}

export function addSeam(e: Entities, garmentId: string, draft: SeamDraft, id: string, name?: string): Command {
  if (!draft.a.length || !draft.b.length) throw new CommandError('a seam needs two sides');
  const g = garment(e, garmentId);
  const cuts = new Set(g.pieces.flatMap((p) => p.cuts.map((c) => c.id)));
  for (const r of [...draft.a, ...draft.b]) {
    if (!cuts.has(r.cut)) throw new CommandError('the seam is on a piece that is not in this garment');
  }
  const seam: Seam = {
    id,
    ...(name ? { name } : {}),
    a: draft.a as Seam['a'],
    b: draft.b as Seam['b'],
    ...(draft.pairing ? { pairing: draft.pairing } : {}),
  };
  return editGarment(e, garmentId, (x) => setIn(x, ['seams'], [...(x.seams ?? []), seam]), { label: 'Sew two edges', drape: true });
}

export function removeSeam(e: Entities, garmentId: string, seamId: string): Command {
  const g = garment(e, garmentId);
  indexOf(g.seams, seamId, 'seam');
  return editGarment(
    e,
    garmentId,
    (x) =>
      setIn(
        x,
        ['seams'],
        (x.seams ?? []).filter((s) => s.id !== seamId),
      ),
    { label: 'Remove a seam', drape: true },
  );
}

/** Which way side `b` runs against side `a`: flipping it twists the seam the other way. */
export function reverseSeam(e: Entities, garmentId: string, seamId: string): Command {
  const g = garment(e, garmentId);
  const i = indexOf(g.seams, seamId, 'seam');
  const seam = (g.seams ?? [])[i];
  if (!seam) throw new CommandError(`no seam ${seamId}`);
  return editGarment(e, garmentId, (x) => setIn(x, ['seams', i, 'b'], reversedRuns(seam.b)), { label: 'Reverse a seam', drape: true });
}

/** What an import adds to a garment (Rust `import::Addition`). */
export interface Addition {
  pieces: Piece[];
  seams: Seam[];
  source: Source;
  bounds: Bounds;
  notes: string[];
}

/** Imported pieces, seams and their source, added to a garment; its collision box grows to cover them. */
export function addPieces(e: Entities, garmentId: string, a: Addition): Command {
  if (!a.pieces.length) throw new CommandError('nothing to import');
  return editGarment(
    e,
    garmentId,
    (g) => {
      let out = setIn(g, ['pieces'], [...g.pieces, ...a.pieces]);
      if (a.seams.length) out = setIn(out, ['seams'], [...(g.seams ?? []), ...a.seams]);
      out = setIn(out, ['sources'], [...(g.sources ?? []), a.source]);
      const own = g.simulation?.collisionBounds;
      const box: Bounds = own
        ? {
            min: own.min.map((x, k) => Math.min(x, a.bounds.min[k] ?? x)) as Vec3,
            max: own.max.map((x, k) => Math.max(x, a.bounds.max[k] ?? x)) as Vec3,
          }
        : a.bounds;
      if (!own || !deepEqual(own.min, box.min) || !deepEqual(own.max, box.max)) {
        out = setIn(out, ['simulation', 'collisionBounds'], own ? { ...own, min: box.min, max: box.max } : box);
      }
      return out;
    },
    { label: 'Import pieces', drape: true },
  );
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
