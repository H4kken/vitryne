// SPDX-License-Identifier: AGPL-3.0-or-later
// Commands: the only way the document changes. A command records each entity it changes,
// before and after, so applying and reverting are exact (key order included), and checks
// that the document is where it expects before doing either. Builders check the JSON Schema
// of what they produce, so an invalid value never becomes a command.

import type {
  Appearance,
  Cut,
  Edge,
  Fabric,
  Fold,
  Garment,
  Line,
  OutlineNode,
  Piece,
  Placement,
  Project,
  Seam,
  Source,
  Vec2,
  Vec3,
} from "@/format/schema.gen";
import { colorName, normalizeColor } from "@/format/colors";
import { matchingPreset } from "@/format/presets";
import {
  foldProblem,
  joinEdges,
  leavesPiece,
  moveNodes as movedNodes,
  outlineProblem,
  splitEdge,
} from "@/pattern/edit";
import { linePoints } from "@/pattern/geometry";
import {
  type Entities,
  getEntity,
  mainGarment,
  setEntity,
  type Slot,
  slotKey,
} from "./entities";
import { deepEqual, getIn, type Path, setIn } from "./json";
import { schemaErrors } from "./validate";

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
  /** What the editor tells the person about it: what else went, what now works differently. */
  note?: string;
}

/** A command that can't be built or can't apply: nothing changed. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

function swap(
  e: Entities,
  cmd: Command,
  from: "before" | "after",
  to: "before" | "after",
): Entities {
  let out = e;
  for (const c of cmd.changes) {
    const cur = getEntity(out, c.slot);
    if (cur !== c[from] && !deepEqual(cur, c[from])) {
      throw new CommandError(
        `${cmd.label}: the ${slotKey(c.slot)} is not in the state this command expects`,
      );
    }
    out = setEntity(out, c.slot, c[to]);
  }
  return out;
}

export function applyCommand(e: Entities, cmd: Command): Entities {
  return swap(e, cmd, "before", "after");
}

export function revertCommand(e: Entities, cmd: Command): Entities {
  // Changes revert in reverse order.
  return swap(
    e,
    { ...cmd, changes: [...cmd.changes].reverse() },
    "after",
    "before",
  );
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
export function setValue(
  e: Entities,
  slot: Slot,
  path: Path,
  value: unknown,
  o: Options,
): Command {
  const before = getEntity(e, slot);
  if (before === undefined)
    throw new CommandError(`${o.label}: no ${slotKey(slot)}`);
  if (deepEqual(getIn(before, path), value))
    throw new CommandError(`${o.label}: nothing changes`);
  const after = setIn(before, path, value);
  const problems = schemaErrors(slot.kind, after);
  if (problems.length)
    throw new CommandError(`${o.label}: ${problems.join("; ")}`);
  return {
    label: o.label,
    drape: o.drape,
    coalesce: o.coalesce,
    changes: [{ slot, before, after }],
  };
}

// ---- names and values ----------------------------------------------------------------------

export function renameProject(e: Entities, name: string): Command {
  return setValue(e, { kind: "project" }, ["name"], name, {
    label: "Rename the project",
    drape: false,
  });
}

function indexOf<T extends { id: string }>(
  list: readonly T[] | undefined,
  id: string,
  what: string,
): number {
  const i = list?.findIndex((x) => x.id === id) ?? -1;
  if (i < 0) throw new CommandError(`no ${what} ${id}`);
  return i;
}

function garment(e: Entities, id: string): Garment {
  const g = e.garments.find((x) => x.id === id);
  if (!g) throw new CommandError(`no garment ${id}`);
  return g;
}

export function renamePiece(
  e: Entities,
  garmentId: string,
  pieceId: string,
  name: string,
): Command {
  const i = indexOf(garment(e, garmentId).pieces, pieceId, "piece");
  return setValue(
    e,
    { kind: "garment", id: garmentId },
    ["pieces", i, "name"],
    name,
    { label: "Rename a piece", drape: false },
  );
}

export function renameCut(
  e: Entities,
  garmentId: string,
  pieceId: string,
  cutId: string,
  name: string,
): Command {
  const g = garment(e, garmentId);
  const i = indexOf(g.pieces, pieceId, "piece");
  const j = indexOf(g.pieces[i]?.cuts, cutId, "cut");
  // An empty name falls back to the piece's (FORMAT.md): store none rather than "".
  return setValue(
    e,
    { kind: "garment", id: garmentId },
    ["pieces", i, "cuts", j, "name"],
    name === "" ? undefined : name,
    {
      label: "Rename a cut",
      drape: false,
    },
  );
}

export function renameSeam(
  e: Entities,
  garmentId: string,
  seamId: string,
  name: string,
): Command {
  const i = indexOf(garment(e, garmentId).seams, seamId, "seam");
  return setValue(
    e,
    { kind: "garment", id: garmentId },
    ["seams", i, "name"],
    name === "" ? undefined : name,
    {
      label: "Rename a seam",
      drape: false,
    },
  );
}

export function renameFabric(
  e: Entities,
  fabricId: string,
  name: string,
): Command {
  return setValue(e, { kind: "fabric", id: fabricId }, ["name"], name, {
    label: "Rename a fabric",
    drape: false,
  });
}

/** The fabric values the properties panel edits, by path in the fabric. */
export const FABRIC_FIELDS = {
  density: ["density"],
  thickness: ["thickness"],
  friction: ["friction"],
  stretchWarp: ["stretch", "warp"],
  stretchWeft: ["stretch", "weft"],
  stretchShear: ["stretch", "shear"],
  bendingWarp: ["bending", "warp"],
  bendingWeft: ["bending", "weft"],
} as const satisfies Record<string, Path>;

export type FabricField = keyof typeof FABRIC_FIELDS;

export function fabricValue(f: Fabric, field: FabricField): number {
  const v = getIn(f, FABRIC_FIELDS[field]);
  if (v === undefined && field === "thickness") return 0.5;
  return v as number;
}

export function setFabricValue(
  e: Entities,
  fabricId: string,
  field: FabricField,
  value: number,
): Command {
  if (!Number.isFinite(value))
    throw new CommandError("a fabric value must be a number");
  return setValue(
    e,
    { kind: "fabric", id: fabricId },
    FABRIC_FIELDS[field],
    value,
    {
      label: "Change the fabric",
      drape: true,
      coalesce: `fabric:${fabricId}:${field}`,
    },
  );
}

// ---- fabrics: how a piece hangs and what colour it is (FORMAT.md, Fabric and Appearance) ----
//
// The editor's fabric is one thing to pick: a fabric part and the appearance it names
// (`fabric.appearance`). Pieces pick fabrics, never colours: a cut's or garment's own appearance
// (files from before format version 3) is taken away when its fabric changes or is recoloured,
// so what the person picks is what they see.

function appearanceById(
  e: Entities,
  id: string | undefined,
): Appearance | undefined {
  return id === undefined ? undefined : e.appearances?.find((a) => a.id === id);
}

function fabricById(e: Entities, id: string | undefined): Fabric | undefined {
  return id === undefined ? undefined : e.fabrics.find((f) => f.id === id);
}

/** A fabric's colour (its appearance's), or none (the app's own). */
export function fabricColor(e: Entities, f: Fabric): string | undefined {
  return appearanceById(e, f.appearance)?.color;
}

/** The fabric a cut is cut from: its own, else the garment's. */
export function cutFabric(
  e: Entities,
  g: Garment,
  cut: Cut,
): Fabric | undefined {
  return fabricById(e, cut.fabric ?? g.fabric);
}

/**
 * The colour a cut shows, the nearest one set (FORMAT.md, Appearance): its own appearance, its
 * own fabric's, the garment's appearance, the garment fabric's; else none (the app's).
 */
export function cutColor(
  e: Entities,
  g: Garment,
  cut: Cut,
): string | undefined {
  const fabricLook = (id: string | undefined) =>
    appearanceById(e, fabricById(e, id)?.appearance);
  return (
    appearanceById(e, cut.appearance) ??
    (cut.fabric === undefined ? undefined : fabricLook(cut.fabric)) ??
    appearanceById(e, g.appearance) ??
    fabricLook(g.fabric)
  )?.color;
}

/** How many cuts are cut from a fabric, and whether it is a garment's default. */
export function fabricUse(
  e: Entities,
  fabricId: string,
): { cuts: number; garmentDefault: boolean } {
  let cuts = 0;
  let garmentDefault = false;
  for (const g of e.garments) {
    if (g.fabric === fabricId) garmentDefault = true;
    for (const p of g.pieces)
      for (const c of p.cuts) if ((c.fabric ?? g.fabric) === fabricId) cuts++;
  }
  return { cuts, garmentDefault };
}

/** A fabric's name from its colour and kind ("Navy denim"), or the kind's alone. */
export function fabricName(color: string | undefined, preset: Fabric): string {
  const named = color === undefined ? undefined : colorName(color);
  return named === undefined || named === color
    ? preset.name
    : `${named} ${preset.name.charAt(0).toLowerCase()}${preset.name.slice(1)}`;
}

/** Whether `f`'s name is the one `fabricName` would give it (so it may follow its kind and colour). */
function hasMadeName(e: Entities, f: Fabric): boolean {
  const kind = matchingPreset(f);
  return kind !== undefined && f.name === fabricName(fabricColor(e, f), kind);
}

/** Every reference to an appearance, by id: how many (garments, cuts and fabrics). */
function appearanceUses(
  gs: readonly Garment[],
  fs: readonly Fabric[],
): Map<string, number> {
  const uses = new Map<string, number>();
  const count = (id: string | undefined) =>
    id !== undefined && uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const f of fs) count(f.appearance);
  for (const g of gs) {
    count(g.appearance);
    for (const p of g.pieces) for (const c of p.cuts) count(c.appearance);
  }
  return uses;
}

function checked<T>(kind: Slot["kind"], label: string, v: T): T {
  const problems = schemaErrors(kind, v);
  if (problems.length)
    throw new CommandError(`${label}: ${problems.join("; ")}`);
  return v;
}

/**
 * The changes taking `e` to `next` for the garments, fabrics and appearances, with the project's
 * lists following. Appearances only a removed reference used are dropped, unless `keep`.
 */
function fabricChanges(
  e: Entities,
  label: string,
  next: {
    garments?: readonly Garment[];
    fabrics?: readonly Fabric[];
    appearances?: readonly Appearance[];
  },
): Change[] {
  const garments = next.garments ?? e.garments;
  const fabrics = next.fabrics ?? e.fabrics;
  const used = appearanceUses(garments, fabrics);
  const was = appearanceUses(e.garments, e.fabrics);
  // An appearance nothing uses any more goes; one nothing used before stays (a file's own).
  const appearances = (next.appearances ?? e.appearances ?? []).filter(
    (a) => used.has(a.id) || !was.has(a.id),
  );

  const changes: Change[] = [];
  const diff = <T extends { id: string }>(
    kind: "garment" | "fabric" | "appearance",
    before: readonly T[],
    after: readonly T[],
  ) => {
    const old = new Map(before.map((x) => [x.id, x]));
    const now = new Set(after.map((x) => x.id));
    for (const x of after) {
      const b = old.get(x.id);
      if (b !== x && !deepEqual(b, x))
        changes.push({
          slot: { kind, id: x.id },
          before: b,
          after: checked(kind, label, x),
        });
    }
    for (const [id, b] of old)
      if (!now.has(id))
        changes.push({ slot: { kind, id }, before: b, after: undefined });
  };
  diff("appearance", e.appearances ?? [], appearances);
  diff("fabric", e.fabrics, fabrics);
  diff("garment", e.garments, garments);
  if (changes.length === 0) throw new CommandError(`${label}: nothing changes`);

  if (e.project) {
    // The project's lists keep their order: gone ids leave, new ones go last.
    const listed = (was: readonly string[], now: readonly { id: string }[]) => {
      const ids = new Set(now.map((x) => x.id));
      const kept = was.filter((id) => ids.has(id));
      return [...kept, ...[...ids].filter((id) => !kept.includes(id))];
    };
    let project: Project = e.project;
    const fids = listed(project.fabrics, fabrics);
    if (!deepEqual(project.fabrics, fids))
      project = setIn(project, ["fabrics"], fids);
    const aids = listed(project.appearances ?? [], appearances);
    if (!deepEqual(project.appearances ?? [], aids))
      project = setIn(project, ["appearances"], aids.length ? aids : undefined);
    if (project !== e.project)
      changes.push({
        slot: { kind: "project" },
        before: e.project,
        after: project,
      });
  }
  return changes;
}

/** Takes away the own appearance of the cuts `which` picks (and the garment's, if `garment`). */
function dropLooks(
  g: Garment,
  which: (c: Cut) => boolean,
  garment = false,
): Garment {
  let out = g;
  if (garment && g.appearance !== undefined)
    out = setIn(out, ["appearance"], undefined) as Garment;
  g.pieces.forEach((p, i) =>
    p.cuts.forEach((c, j) => {
      if (c.appearance !== undefined && which(c))
        out = setIn(
          out,
          ["pieces", i, "cuts", j, "appearance"],
          undefined,
        ) as Garment;
    }),
  );
  return out;
}

export interface NewIds {
  fabric: string;
  appearance: string;
}

const randomIds = (): NewIds => ({
  fabric: crypto.randomUUID(),
  appearance: crypto.randomUUID(),
});

/** The physical values of `from` (its kind), on `f`. */
function withPhysics(f: Fabric, from: Fabric): Fabric {
  const out: Fabric = {
    ...f,
    category: from.category,
    density: from.density,
    stretch: { ...from.stretch },
    bending: { ...from.bending },
    friction: from.friction,
  };
  if (from.thickness !== undefined) out.thickness = from.thickness;
  else delete out.thickness;
  if (from.notes !== undefined) out.notes = from.notes;
  else delete out.notes;
  return out;
}

/**
 * Adds a fabric of kind `preset` in `color` (#rrggbb), named `name` (default: `fabricName`).
 * Nothing uses it yet, so nothing re-drapes.
 */
export function addFabric(
  e: Entities,
  spec: { preset: Fabric; color: string; name?: string },
  ids: NewIds = randomIds(),
): Command {
  const c = normalizeColor(spec.color);
  if (c === undefined)
    throw new CommandError(`${spec.color} is not a colour (#rrggbb)`);
  const name = spec.name?.trim() || fabricName(c, spec.preset);
  const fabric = withPhysics(
    { ...spec.preset, id: ids.fabric, name, appearance: ids.appearance },
    spec.preset,
  );
  return {
    label: "Add a fabric",
    drape: false,
    changes: fabricChanges(e, "Add a fabric", {
      fabrics: [...e.fabrics, fabric],
      appearances: [
        ...(e.appearances ?? []),
        { id: ids.appearance, name: colorName(c), color: c },
      ],
    }),
  };
}

/** A fabric of another project, with its look, to copy into this one. */
export interface FabricSource {
  /** The project it comes from (its `libraryRef.library`). */
  library: string;
  fabric: Fabric;
  appearance?: Appearance;
}

/**
 * Copies a fabric (and its appearance) from another project: new ids, and a `libraryRef` saying
 * where it came from (FORMAT.md, common: the copy is what's used).
 */
export function importFabric(
  e: Entities,
  src: FabricSource,
  ids: NewIds = randomIds(),
): Command {
  const ref = (entity: string) => ({ library: src.library, entity });
  const fabric: Fabric = {
    ...src.fabric,
    id: ids.fabric,
    libraryRef: ref(src.fabric.id),
  };
  delete fabric.appearance;
  const appearances = [...(e.appearances ?? [])];
  if (src.appearance) {
    fabric.appearance = ids.appearance;
    appearances.push({
      ...src.appearance,
      id: ids.appearance,
      libraryRef: ref(src.appearance.id),
    });
  }
  return {
    label: `Add ${fabric.name}`,
    drape: false,
    changes: fabricChanges(e, `Add ${fabric.name}`, {
      fabrics: [...e.fabrics, fabric],
      appearances,
    }),
  };
}

/**
 * Recolours a fabric. Its appearance is recoloured in place when nothing else uses it (so a
 * colour picker's drag is one appearance), else it gets a new one made with `newId`. The cuts
 * of this fabric lose their own appearances, and so does a garment whose default it is. A name
 * made from the colour follows it. No re-drape: the worker recolours the drape shown.
 */
export function setFabricColor(
  e: Entities,
  fabricId: string,
  color: string,
  newId: () => string = () => crypto.randomUUID(),
): Command {
  const label = "Change a fabric's colour";
  const f = fabricById(e, fabricId);
  if (!f) throw new CommandError(`no fabric ${fabricId}`);
  const c = normalizeColor(color);
  if (c === undefined)
    throw new CommandError(`${color} is not a colour (#rrggbb)`);

  const appearances = [...(e.appearances ?? [])];
  const k = appearances.findIndex((a) => a.id === f.appearance);
  const own = appearances[k];
  let id: string;
  if (own && appearanceUses(e.garments, e.fabrics).get(own.id) === 1) {
    appearances[k] = { ...own, color: c, name: colorName(c) };
    id = own.id;
  } else {
    id = newId();
    appearances.push({ id, name: colorName(c), color: c });
  }
  let fabric: Fabric = { ...f, appearance: id };
  const kind = matchingPreset(f);
  if (kind && hasMadeName(e, f))
    fabric = { ...fabric, name: fabricName(c, kind) };
  const garments = e.garments.map((g) =>
    dropLooks(
      g,
      (cut) => (cut.fabric ?? g.fabric) === fabricId,
      g.fabric === fabricId,
    ),
  );
  return {
    label,
    drape: false,
    coalesce: `fabric-color:${fabricId}`,
    changes: fabricChanges(e, label, {
      garments,
      fabrics: e.fabrics.map((x) => (x.id === fabricId ? fabric : x)),
      appearances,
    }),
  };
}

/** Gives a fabric the physical values of a preset (its kind); a name made from the kind follows. */
export function applyFabricPreset(
  e: Entities,
  fabricId: string,
  preset: Fabric,
): Command {
  const before = fabricById(e, fabricId);
  if (!before) throw new CommandError(`no fabric ${fabricId}`);
  let after = withPhysics(before, preset);
  if (hasMadeName(e, before) || matchingPreset(before) === undefined)
    after = { ...after, name: fabricName(fabricColor(e, before), preset) };
  const label = `Make it ${preset.name.toLowerCase()}`;
  if (deepEqual(before, after))
    throw new CommandError(`${label}: nothing changes`);
  return {
    label,
    drape: fabricUse(e, fabricId).cuts > 0,
    changes: [
      {
        slot: { kind: "fabric", id: fabricId },
        before,
        after: checked("fabric", label, after),
      },
    ],
  };
}

/** Removes a fabric no cut uses and no garment has as its default (and its look, if only its). */
export function deleteFabric(e: Entities, fabricId: string): Command {
  const f = fabricById(e, fabricId);
  if (!f) throw new CommandError(`no fabric ${fabricId}`);
  const use = fabricUse(e, fabricId);
  if (use.garmentDefault || use.cuts > 0)
    throw new CommandError(
      `${f.name} is in use: give its pieces another fabric first`,
    );
  return {
    label: `Delete ${f.name}`,
    drape: false,
    changes: fabricChanges(e, `Delete ${f.name}`, {
      fabrics: e.fabrics.filter((x) => x.id !== fabricId),
    }),
  };
}

/** The garment's default fabric: the one of every cut that names none. Its look comes with it. */
export function setDefaultFabric(
  e: Entities,
  garmentId: string,
  fabricId: string,
): Command {
  const g = garment(e, garmentId);
  if (!fabricById(e, fabricId)) throw new CommandError(`no fabric ${fabricId}`);
  if (g.fabric === fabricId)
    throw new CommandError("the garment already has this fabric");
  const after = dropLooks(
    { ...g, fabric: fabricId },
    (c) => c.fabric === undefined,
    true,
  );
  return {
    label: "Change the garment's fabric",
    drape: true,
    changes: fabricChanges(e, "Change the garment's fabric", {
      garments: e.garments.map((x) => (x.id === g.id ? after : x)),
    }),
  };
}

/** Gives the cuts `cutIds` of a garment a fabric, or the garment's (`undefined`); their own looks go. */
function setCutsFabric(
  e: Entities,
  g: Garment,
  cutIds: readonly string[],
  fabricId: string | undefined,
  label: string,
): Command {
  if (fabricId !== undefined && !fabricById(e, fabricId))
    throw new CommandError(`no fabric ${fabricId}`);
  const which = new Set(cutIds);
  // The garment's own fabric is stored as none: the cut then follows it.
  const value = fabricId === g.fabric ? undefined : fabricId;
  let after = g;
  for (const id of cutIds) {
    const [i, j] = cutAt(g, id);
    after = setIn(after, ["pieces", i, "cuts", j, "fabric"], value) as Garment;
  }
  after = dropLooks(after, (c) => which.has(c.id));
  return {
    label,
    drape: true,
    changes: fabricChanges(e, label, {
      garments: e.garments.map((x) => (x.id === g.id ? after : x)),
    }),
  };
}

/** One cut's fabric, or the garment's (`undefined`). */
export function setCutFabric(
  e: Entities,
  garmentId: string,
  cutId: string,
  fabricId: string | undefined,
): Command {
  const g = garment(e, garmentId);
  return setCutsFabric(
    e,
    g,
    [cutId],
    fabricId,
    fabricId ? "Change a piece's fabric" : "Use the garment's fabric",
  );
}

/** The fabric of every cut of a piece, or the garment's (`undefined`). */
export function setPieceFabric(
  e: Entities,
  garmentId: string,
  pieceId: string,
  fabricId: string | undefined,
): Command {
  const g = garment(e, garmentId);
  const piece = g.pieces[indexOf(g.pieces, pieceId, "piece")];
  return setCutsFabric(
    e,
    g,
    (piece?.cuts ?? []).map((c) => c.id),
    fabricId,
    fabricId ? "Change a piece's fabric" : "Use the garment's fabric",
  );
}

// ---- simulation settings: the garment's value wins over the project's (FORMAT.md) ----------

interface SimulationLike {
  targetVertices?: number;
  engine?: Record<string, unknown>;
}

function simulations(e: Entities): {
  project?: SimulationLike;
  garment?: SimulationLike;
  garmentId?: string;
} {
  const g = mainGarment(e);
  return {
    project: e.project?.simulation as SimulationLike | undefined,
    garment: g?.simulation as SimulationLike | undefined,
    garmentId: g?.id,
  };
}

/** Engine defaults (vitryne-solver `SimSettings::default()`, `DEFAULT_TARGET_VERTICES`). */
export const DEFAULT_TARGET_VERTICES = 10_000;
const DEFAULT_SELF_COLLISION = false;

export function targetVertices(e: Entities): number {
  const s = simulations(e);
  return (
    s.garment?.targetVertices ??
    s.project?.targetVertices ??
    DEFAULT_TARGET_VERTICES
  );
}

export function selfCollision(e: Entities): boolean {
  const s = simulations(e);
  const v =
    s.garment?.engine?.self_collision ?? s.project?.engine?.self_collision;
  return typeof v === "boolean" ? v : DEFAULT_SELF_COLLISION;
}

/** Where a simulation setting is set: the garment if it sets it, else the project. */
function settingSlot(e: Entities, inGarment: boolean): Slot {
  const s = simulations(e);
  if (inGarment && s.garmentId) return { kind: "garment", id: s.garmentId };
  if (!e.project)
    throw new CommandError("only a project has simulation settings");
  return { kind: "project" };
}

export function setTargetVertices(e: Entities, n: number): Command {
  if (!Number.isInteger(n))
    throw new CommandError("the vertex count must be a whole number");
  const slot = settingSlot(
    e,
    simulations(e).garment?.targetVertices !== undefined,
  );
  return setValue(e, slot, ["simulation", "targetVertices"], n, {
    label: "Change the mesh resolution",
    drape: true,
    coalesce: "simulation:targetVertices",
  });
}

export function setSelfCollision(e: Entities, on: boolean): Command {
  const slot = settingSlot(
    e,
    simulations(e).garment?.engine?.self_collision !== undefined,
  );
  return setValue(e, slot, ["simulation", "engine", "self_collision"], on, {
    label: on ? "Turn self-collision on" : "Turn self-collision off",
    drape: true,
  });
}

// ---- where cuts start on the body, and where they sit in the flat view ---------------------

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

export function findCut(
  g: Garment,
  cutId: string,
): { piece: Piece; cut: Cut } | undefined {
  for (const piece of g.pieces) {
    const cut = piece.cuts.find((c) => c.id === cutId);
    if (cut) return { piece, cut };
  }
  return undefined;
}

/**
 * The garment's stack with new cuts on top (outermost), in the order given, but a cut that goes
 * on another never before it (Figma puts a new layer on top the same way).
 */
export function stackWith(g: Garment, added: readonly Cut[]): string[] {
  const out = [...g.stack];
  const left = [...added];
  while (left.length) {
    const k = left.findIndex(
      (c) =>
        c.placement.type !== "follow" ||
        !left.some((o) => o.id === c.placement.cut),
    );
    const [c] = left.splice(Math.max(k, 0), 1);
    if (c) out.push(c.id);
  }
  return out;
}

/**
 * The stack after `cutId` goes on `onId`: when it (and the cuts placed on it) comes before it,
 * they move together to just above `onId`, in the order they had; otherwise nothing moves.
 */
export function stackAfterFollow(
  g: Garment,
  cutId: string,
  onId: string,
): string[] {
  const at = (id: string) => g.stack.indexOf(id);
  if (at(cutId) > at(onId)) return g.stack;
  const block = followers(g, cutId);
  const moved = g.stack.filter((id) => block.has(id));
  const rest = g.stack.filter((id) => !block.has(id));
  rest.splice(rest.indexOf(onId) + 1, 0, ...moved);
  return rest;
}

/** `cutId` and the cuts placed on it, directly or not: it can't go on top of any of them. */
export function followers(g: Garment, cutId: string): Set<string> {
  const out = new Set<string>([cutId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const piece of g.pieces) {
      for (const c of piece.cuts) {
        if (
          !out.has(c.id) &&
          c.placement.type === "follow" &&
          c.placement.cut &&
          out.has(c.placement.cut)
        ) {
          out.add(c.id);
          grew = true;
        }
      }
    }
  }
  return out;
}

/** A change to one garment, built by `edit` (which may throw a `CommandError`). */
function editGarment(
  e: Entities,
  garmentId: string,
  edit: (g: Garment) => Garment,
  o: Options,
): Command {
  const before = garment(e, garmentId);
  const after = edit(before);
  if (deepEqual(before, after))
    throw new CommandError(`${o.label}: nothing changes`);
  const problems = schemaErrors("garment", after);
  if (problems.length)
    throw new CommandError(`${o.label}: ${problems.join("; ")}`);
  return {
    label: o.label,
    drape: o.drape,
    coalesce: o.coalesce,
    changes: [{ slot: { kind: "garment", id: garmentId }, before, after }],
  };
}

/**
 * Where a cut starts on the body. `bounds`: a new collision box for the garment, when the
 * cut needs a bigger one there (Rust's `rewrap` says). `coalesce`: a drag of one field.
 */
export function setPlacement(
  e: Entities,
  garmentId: string,
  cutId: string,
  placement: Placement,
  bounds?: Bounds,
  coalesce?: string,
): Command {
  for (const k of [
    "angle",
    "radius",
    "top",
    "rotation",
    "tube",
    "lift",
  ] as const) {
    const v = placement[k];
    if (v !== undefined && !Number.isFinite(v))
      throw new CommandError(`a placement's ${k} must be a number`);
  }
  if (placement.type === "follow") {
    const g = garment(e, garmentId);
    if (!placement.cut || !findCut(g, placement.cut))
      throw new CommandError("it must go on a piece of this garment");
    if (followers(g, cutId).has(placement.cut))
      throw new CommandError(
        "a piece can't go on itself, or on a piece that goes on it",
      );
  }
  return editGarment(
    e,
    garmentId,
    (g) => {
      const [i, j] = cutAt(g, cutId);
      let out = setIn(g, ["pieces", i, "cuts", j, "placement"], placement);
      if (placement.type === "follow" && placement.cut) {
        const stack = stackAfterFollow(g, cutId, placement.cut);
        if (stack !== g.stack) out = setIn(out, ["stack"], stack);
      }
      if (bounds) out = setIn(out, ["simulation", "collisionBounds"], bounds);
      return out;
    },
    { label: "Move a piece on the body", drape: true, coalesce },
  );
}

/** A cut becomes the mirror image of the piece, or stops being it. */
export function setMirrored(
  e: Entities,
  garmentId: string,
  cutId: string,
  mirrored: boolean,
): Command {
  return editGarment(
    e,
    garmentId,
    (g) => {
      const [i, j] = cutAt(g, cutId);
      // `false` is the default: store none rather than false.
      return setIn(
        g,
        ["pieces", i, "cuts", j, "mirrored"],
        mirrored || undefined,
      );
    },
    { label: "Flip a piece", drape: true },
  );
}

/** Where a cut sits in the flat view (FORMAT.md, Cuts: display only). */
export interface Layout {
  position: [number, number];
  rotation: number;
}

export function setLayout(
  e: Entities,
  garmentId: string,
  cutId: string,
  layout: Layout,
): Command {
  return setLayouts(e, garmentId, { [cutId]: layout });
}

/** Where several cuts sit in the flat view, as one edit (a group of cuts moved together). */
export function setLayouts(
  e: Entities,
  garmentId: string,
  layouts: Readonly<Record<string, Layout>>,
): Command {
  const ids = Object.keys(layouts);
  if (
    !ids.length ||
    !ids.every((id) => {
      const l = layouts[id] as Layout;
      return [...l.position, l.rotation].every(Number.isFinite);
    })
  )
    throw new CommandError("a layout must be numbers");
  return editGarment(
    e,
    garmentId,
    (g) => {
      for (const cutId of ids) {
        const layout = layouts[cutId] as Layout;
        const [i, j] = cutAt(g, cutId);
        const old = g.pieces[i]?.cuts[j]?.layout;
        // Unknown members of the layout stay.
        let l: Record<string, unknown> = { ...(old ?? {}) };
        l = setIn(l, ["position"], layout.position);
        l = setIn(
          l,
          ["rotation"],
          layout.rotation === 0 ? undefined : layout.rotation,
        );
        g = setIn(g, ["pieces", i, "cuts", j, "layout"], l);
      }
      return g;
    },
    {
      label: "Arrange the pieces",
      drape: false,
      coalesce: `layout:${[...ids].sort().join(",")}`,
    },
  );
}

// ---- sewing --------------------------------------------------------------------------------

type Run = Seam["a"][number];

/** The same stretch of outline, walked the other way (FORMAT.md: to reverse a side, write its runs the other way). */
function reversedRuns(runs: readonly Run[]): [Run, ...Run[]] {
  const out = [...runs].reverse().map((r) => {
    const flipped: Run = { ...r, from: r.to, to: r.from };
    if (r.direction !== undefined)
      flipped.direction = r.direction === "ccw" ? "cw" : "ccw";
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
  pairing?: "nodes" | "length";
}

export function addSeam(
  e: Entities,
  garmentId: string,
  draft: SeamDraft,
  id: string,
  name?: string,
): Command {
  if (!draft.a.length || !draft.b.length)
    throw new CommandError("a seam needs two sides");
  const g = garment(e, garmentId);
  const cuts = new Set(g.pieces.flatMap((p) => p.cuts.map((c) => c.id)));
  for (const r of [...draft.a, ...draft.b]) {
    if (!cuts.has(r.cut))
      throw new CommandError(
        "the seam is on a piece that is not in this garment",
      );
  }
  const seam: Seam = {
    id,
    ...(name ? { name } : {}),
    a: draft.a as Seam["a"],
    b: draft.b as Seam["b"],
    ...(draft.pairing ? { pairing: draft.pairing } : {}),
  };
  return editGarment(
    e,
    garmentId,
    (x) => setIn(x, ["seams"], [...(x.seams ?? []), seam]),
    { label: "Sew two edges", drape: true },
  );
}

export function removeSeam(
  e: Entities,
  garmentId: string,
  seamId: string,
): Command {
  const g = garment(e, garmentId);
  indexOf(g.seams, seamId, "seam");
  return editGarment(
    e,
    garmentId,
    (x) =>
      setIn(
        x,
        ["seams"],
        (x.seams ?? []).filter((s) => s.id !== seamId),
      ),
    { label: "Remove a seam", drape: true },
  );
}

/** Which way side `b` runs against side `a`: flipping it twists the seam the other way. */
export function reverseSeam(
  e: Entities,
  garmentId: string,
  seamId: string,
): Command {
  const g = garment(e, garmentId);
  const i = indexOf(g.seams, seamId, "seam");
  const seam = (g.seams ?? [])[i];
  if (!seam) throw new CommandError(`no seam ${seamId}`);
  return editGarment(
    e,
    garmentId,
    (x) => setIn(x, ["seams", i, "b"], reversedRuns(seam.b)),
    { label: "Reverse a seam", drape: true },
  );
}

// ---- editing points (an outline's nodes and edges) -----------------------------------------

function pieceIndex(g: Garment, pieceId: string): [number, Piece] {
  const i = indexOf(g.pieces, pieceId, "piece");
  const piece = g.pieces[i];
  if (!piece) throw new CommandError(`no piece ${pieceId}`);
  return [i, piece];
}

function nodeIndex(piece: Piece, nodeId: string): number {
  return indexOf(piece.outline, nodeId, "point");
}

/** How many edges a seam side walks (Rust's pairing compares these). */
function sideEdges(g: Garment, runs: readonly Run[]): number {
  let n = 0;
  for (const r of runs) {
    const piece = findCut(g, r.cut)?.piece;
    if (!piece) continue;
    if (r.line !== undefined) {
      const nodes = piece.lines?.find((l) => l.id === r.line)?.nodes ?? [];
      const i = nodes.findIndex((x) => x.id === r.from);
      const j = nodes.findIndex((x) => x.id === r.to);
      if (i >= 0 && j >= 0) n += Math.abs(i - j);
      continue;
    }
    const m = piece.outline.length;
    const i = piece.outline.findIndex((x) => x.id === r.from);
    const j = piece.outline.findIndex((x) => x.id === r.to);
    if (i >= 0 && j >= 0)
      n += r.direction === "cw" ? (i - j + m) % m : (j - i + m) % m;
  }
  return n;
}

function seamTitle(s: Seam): string {
  return s.name ? `The seam “${s.name}”` : "A seam";
}

/**
 * Seams whose pairing changes from `before` to `after` (FORMAT.md, Seams: with `nodes`
 * pairing, sides through the same number of points meet point to point, else by length).
 */
function pairingNotes(before: Garment, after: Garment): string[] {
  const out: string[] = [];
  for (const s of after.seams ?? []) {
    const old = before.seams?.find((x) => x.id === s.id);
    if (!old || s.pairing === "length") continue;
    const was = sideEdges(before, old.a) === sideEdges(before, old.b);
    const now = sideEdges(after, s.a) === sideEdges(after, s.b);
    if (was && !now)
      out.push(
        `${seamTitle(s)} now matches its sides by length: one side has a point the other hasn't`,
      );
    else if (!was && now)
      out.push(`${seamTitle(s)} now matches its sides point to point`);
  }
  return out;
}

/**
 * The piece's outline replaced, checked as Rust will (FORMAT.md: a simple, counter-clockwise
 * polygon, its folds still inside it; folds whose ends went are the caller's to remove).
 */
function withOutline(
  g: Garment,
  i: number,
  outline: OutlineNode[],
  label: string,
): Garment {
  const why = outlineProblem(outline);
  if (why) throw new CommandError(`${label}: ${why}`);
  const has = new Set(outline.map((n) => n.id));
  for (const f of g.pieces[i]?.folds ?? []) {
    if (!has.has(f.from) || !has.has(f.to)) continue;
    const bad = foldProblem(outline, f.from, f.to);
    if (bad) throw new CommandError(`${label}: ${bad}`);
  }
  return setIn(g, ["pieces", i, "outline"], outline);
}

function finitePoint(p: readonly number[]): boolean {
  return p.length === 2 && p.every(Number.isFinite);
}

/** Outline nodes moved to new places (piece frame, mm); a drag is one of these. */
export function moveNodes(
  e: Entities,
  garmentId: string,
  pieceId: string,
  to: Readonly<Record<string, Vec2>>,
): Command {
  const ids = Object.keys(to);
  if (!ids.length) throw new CommandError("no point to move");
  if (!Object.values(to).every(finitePoint))
    throw new CommandError("a point's place must be numbers");
  const label = ids.length === 1 ? "Move a point" : "Move points";
  const [i, piece] = pieceIndex(garment(e, garmentId), pieceId);
  for (const id of ids) nodeIndex(piece, id);
  return editGarment(
    e,
    garmentId,
    (g) =>
      withOutline(
        g,
        i,
        movedNodes(piece.outline, new Map(Object.entries(to))),
        label,
      ),
    { label, drape: true },
  );
}

/**
 * A new node `id` on the edge from node `fromId`, where it passes nearest to `at`: a plain
 * point, or a notch (`type`).
 */
export function insertNode(
  e: Entities,
  garmentId: string,
  pieceId: string,
  fromId: string,
  at: Vec2,
  id: string,
  type: "point" | "notch" = "point",
): Command {
  const label = type === "notch" ? "Add a notch" : "Add a point";
  if (!finitePoint(at))
    throw new CommandError("a point's place must be numbers");
  const before = garment(e, garmentId);
  const [i, piece] = pieceIndex(before, pieceId);
  let outline = splitEdge(piece.outline, nodeIndex(piece, fromId), at, id);
  if (!outline)
    throw new CommandError(`${label}: too close to the end of the edge`);
  if (type !== "point")
    outline = outline.map((n) => (n.id === id ? { ...n, type } : n));
  const cmd = editGarment(
    e,
    garmentId,
    (g) => withOutline(g, i, outline, label),
    { label, drape: true },
  );
  const notes = pairingNotes(before, cmd.changes[0]?.after as Garment);
  return notes.length ? { ...cmd, note: notes.join(". ") } : cmd;
}

/**
 * Node `nodeId` taken off the outline; its two edges become one. Seams that start or end
 * there and folds that end there go with it, in the same command, and the note says so.
 */
export function removeNode(
  e: Entities,
  garmentId: string,
  pieceId: string,
  nodeId: string,
): Command {
  const label = "Delete a point";
  const before = garment(e, garmentId);
  const [i, piece] = pieceIndex(before, pieceId);
  const k = nodeIndex(piece, nodeId);
  if (piece.outline.length <= 3)
    throw new CommandError(`${label}: a piece needs at least three points`);
  const cuts = new Set(piece.cuts.map((c) => c.id));
  const uses = (r: Run) =>
    r.line === undefined &&
    cuts.has(r.cut) &&
    (r.from === nodeId || r.to === nodeId);
  const goneSeams = (before.seams ?? []).filter((s) =>
    [...s.a, ...s.b].some(uses),
  );
  const goneFolds = (piece.folds ?? []).filter(
    (f) => f.from === nodeId || f.to === nodeId,
  );
  const cmd = editGarment(
    e,
    garmentId,
    (g) => {
      let out = withOutline(g, i, joinEdges(piece.outline, k), label);
      if (goneSeams.length)
        out = setIn(
          out,
          ["seams"],
          (g.seams ?? []).filter((s) => !goneSeams.includes(s)),
        );
      if (goneFolds.length) {
        const folds = (piece.folds ?? []).filter((f) => !goneFolds.includes(f));
        out = setIn(
          out,
          ["pieces", i, "folds"],
          folds.length ? folds : undefined,
        );
      }
      return out;
    },
    { label, drape: true },
  );
  const notes: string[] = [];
  const named = goneSeams.map((s) => s.name).filter((x) => x !== undefined);
  if (goneSeams.length)
    notes.push(
      goneSeams.length === 1
        ? `${seamTitle(goneSeams[0] as Seam)} started or ended there and was removed`
        : `${goneSeams.length} seams that started or ended there were removed${named.length ? ` (${named.join(", ")})` : ""}`,
    );
  if (goneFolds.length)
    notes.push(
      goneFolds.length === 1
        ? "The fold that ended there was removed"
        : `${goneFolds.length} folds that ended there were removed`,
    );
  notes.push(...pairingNotes(before, cmd.changes[0]?.after as Garment));
  return notes.length ? { ...cmd, note: notes.join(". ") } : cmd;
}

const NODE_TYPE_NAMES = {
  corner: "a corner",
  notch: "a notch",
  point: "a plain point",
} as const;

/** A node made a corner (it ends a whole edge for sewing), a notch or a plain point. */
export function setNodeType(
  e: Entities,
  garmentId: string,
  pieceId: string,
  nodeId: string,
  type: OutlineNode["type"],
): Command {
  const [i, piece] = pieceIndex(garment(e, garmentId), pieceId);
  return setValue(
    e,
    { kind: "garment", id: garmentId },
    ["pieces", i, "outline", nodeIndex(piece, nodeId), "type"],
    type,
    { label: `Make a point ${NODE_TYPE_NAMES[type]}`, drape: false },
  );
}

/** The edge from node `nodeId` replaced: made straight, made a curve, or a curve reshaped. */
export function setEdge(
  e: Entities,
  garmentId: string,
  pieceId: string,
  nodeId: string,
  edge: Edge,
): Command {
  const [i, piece] = pieceIndex(garment(e, garmentId), pieceId);
  const k = nodeIndex(piece, nodeId);
  const old = piece.outline[k]?.edge;
  const label =
    edge.type === "polyline"
      ? "Straighten an edge"
      : old?.type === "cubic"
        ? "Shape a curve"
        : "Curve an edge";
  const pts = edge.type === "cubic" ? edge.controls : edge.points;
  if (!pts.every(finitePoint))
    throw new CommandError(`${label}: a point's place must be numbers`);
  return editGarment(
    e,
    garmentId,
    (g) =>
      withOutline(
        g,
        i,
        piece.outline.map((n, j) => (j === k ? { ...n, edge } : n)),
        label,
      ),
    { label, drape: true },
  );
}

// ---- internal lines, folds and the grain line -----------------------------------------------

/** Every id used in a garment, to refuse a new entity that reuses one. */
function garmentIds(g: Garment): Set<string> {
  const ids = new Set<string>([g.id, ...(g.seams ?? []).map((s) => s.id)]);
  for (const p of g.pieces) {
    ids.add(p.id);
    for (const n of p.outline) ids.add(n.id);
    for (const c of p.cuts) ids.add(c.id);
    for (const f of p.folds ?? []) ids.add(f.id);
    for (const l of p.lines ?? []) {
      ids.add(l.id);
      for (const n of l.nodes) ids.add(n.id);
    }
  }
  return ids;
}

/** An internal line drawn on a piece: an open path that stays inside it. */
export function addLine(
  e: Entities,
  garmentId: string,
  pieceId: string,
  line: Line,
): Command {
  const label = "Add a line";
  const g = garment(e, garmentId);
  const [i, piece] = pieceIndex(g, pieceId);
  const pts = [
    ...line.nodes.map((n) => n.position),
    ...line.nodes.flatMap((n) =>
      n.edge ? (n.edge.type === "cubic" ? n.edge.controls : n.edge.points) : [],
    ),
  ];
  if (!pts.every(finitePoint))
    throw new CommandError(`${label}: a point's place must be numbers`);
  if (line.nodes.some((n, k) => !n.edge !== (k === line.nodes.length - 1)))
    throw new CommandError(
      `${label}: each point but the last has an edge to the next`,
    );
  if (leavesPiece(piece.outline, linePoints(line)))
    throw new CommandError(`${label}: a line must stay inside the piece`);
  const ids = garmentIds(g);
  const own = [line.id, ...line.nodes.map((n) => n.id)];
  if (own.some((id) => ids.has(id)) || new Set(own).size !== own.length)
    throw new CommandError(`${label}: an id is used twice`);
  return editGarment(
    e,
    garmentId,
    (x) => setIn(x, ["pieces", i, "lines"], [...(piece.lines ?? []), line]),
    // Lines only reach the drape when sewn, and a new one isn't.
    { label, drape: false },
  );
}

/** An internal line taken off its piece; seams sewn on it go with it, and the note says so. */
export function removeLine(
  e: Entities,
  garmentId: string,
  pieceId: string,
  lineId: string,
): Command {
  const label = "Delete a line";
  const g = garment(e, garmentId);
  const [i, piece] = pieceIndex(g, pieceId);
  indexOf(piece.lines, lineId, "line");
  const cuts = new Set(piece.cuts.map((c) => c.id));
  const gone = (g.seams ?? []).filter((s) =>
    [...s.a, ...s.b].some((r) => r.line === lineId && cuts.has(r.cut)),
  );
  const lines = (piece.lines ?? []).filter((l) => l.id !== lineId);
  const cmd = editGarment(
    e,
    garmentId,
    (x) => {
      let out = setIn(
        x,
        ["pieces", i, "lines"],
        lines.length ? lines : undefined,
      );
      if (gone.length)
        out = setIn(
          out,
          ["seams"],
          (x.seams ?? []).filter((s) => !gone.includes(s)),
        );
      return out;
    },
    { label, drape: gone.length > 0 },
  );
  if (!gone.length) return cmd;
  return {
    ...cmd,
    note:
      gone.length === 1
        ? `${seamTitle(gone[0] as Seam)} was sewn on it and was removed`
        : `${gone.length} seams sewn on it were removed`,
  };
}

/** A fold line between two outline nodes of a piece; it must run inside the piece. */
export function addFold(
  e: Entities,
  garmentId: string,
  pieceId: string,
  fold: Fold,
): Command {
  const label = "Add a fold";
  const g = garment(e, garmentId);
  const [i, piece] = pieceIndex(g, pieceId);
  const why = foldProblem(piece.outline, fold.from, fold.to);
  if (why) throw new CommandError(`${label}: ${why}`);
  const same = (piece.folds ?? []).some(
    (f) =>
      (f.from === fold.from && f.to === fold.to) ||
      (f.from === fold.to && f.to === fold.from),
  );
  if (same) throw new CommandError(`${label}: the piece already folds there`);
  if (garmentIds(g).has(fold.id))
    throw new CommandError(`${label}: an id is used twice`);
  return editGarment(
    e,
    garmentId,
    (x) => setIn(x, ["pieces", i, "folds"], [...(piece.folds ?? []), fold]),
    // Folds are for re-folding at DXF export; the cloth is cut and draped unfolded.
    { label, drape: false },
  );
}

export function removeFold(
  e: Entities,
  garmentId: string,
  pieceId: string,
  foldId: string,
): Command {
  const g = garment(e, garmentId);
  const [i, piece] = pieceIndex(g, pieceId);
  indexOf(piece.folds, foldId, "fold");
  const folds = (piece.folds ?? []).filter((f) => f.id !== foldId);
  return editGarment(
    e,
    garmentId,
    (x) => setIn(x, ["pieces", i, "folds"], folds.length ? folds : undefined),
    { label: "Delete a fold", drape: false },
  );
}

/** A piece's grain line drawn (its direction is the fabric's warp), or reset to +y (`undefined`). */
export function setGrain(
  e: Entities,
  garmentId: string,
  pieceId: string,
  grain: Piece["grain"],
): Command {
  const label = grain ? "Set the grain line" : "Reset the grain line";
  if (grain) {
    if (!finitePoint(grain.from) || !finitePoint(grain.to))
      throw new CommandError(`${label}: a point's place must be numbers`);
    const len = Math.hypot(
      grain.to[0] - grain.from[0],
      grain.to[1] - grain.from[1],
    );
    if (len < 1) throw new CommandError(`${label}: the line is too short`);
  }
  const [i] = pieceIndex(garment(e, garmentId), pieceId);
  return setValue(
    e,
    { kind: "garment", id: garmentId },
    ["pieces", i, "grain"],
    grain,
    // The engine is isotropic for now (warp and weft averaged): the grain line is kept, not draped.
    { label, drape: false },
  );
}

/**
 * A drawn piece added to a garment, its cuts already placed (Rust's `place_piece`). `bounds`: a
 * new collision box for the garment, when the piece needs a bigger one.
 */
export function addPiece(
  e: Entities,
  garmentId: string,
  piece: Piece,
  bounds?: Bounds,
): Command {
  const label = "Add a piece";
  const why = outlineProblem(piece.outline);
  if (why) throw new CommandError(`${label}: ${why}`);
  const g = garment(e, garmentId);
  const ids = new Set([
    ...g.pieces.flatMap((p) => [
      p.id,
      ...p.cuts.map((c) => c.id),
      ...p.outline.map((n) => n.id),
    ]),
    ...(g.seams ?? []).map((s) => s.id),
  ]);
  const own = [
    piece.id,
    ...piece.cuts.map((c) => c.id),
    ...piece.outline.map((n) => n.id),
  ];
  if (own.some((id) => ids.has(id)) || new Set(own).size !== own.length)
    throw new CommandError(`${label}: an id is used twice`);
  return editGarment(
    e,
    garmentId,
    (x) => {
      let out = setIn(x, ["pieces"], [...x.pieces, piece]);
      out = setIn(out, ["stack"], stackWith(x, piece.cuts));
      if (bounds) out = setIn(out, ["simulation", "collisionBounds"], bounds);
      return out;
    },
    { label, drape: true },
  );
}

/**
 * Cuts taken out of a garment, as one edit: a piece with no cut left goes too, and so do the
 * seams that sew any of them and the cuts placed on them (a pocket on a front taken out), which
 * the note says.
 */
export function removeCuts(
  e: Entities,
  garmentId: string,
  cutIds: readonly string[],
): Command {
  const g = garment(e, garmentId);
  for (const id of cutIds) cutAt(g, id);
  const asked = new Set(cutIds);
  const gone = new Set<string>();
  for (const id of cutIds) for (const f of followers(g, id)) gone.add(f);
  const pieces = g.pieces
    .map((p) => ({ ...p, cuts: p.cuts.filter((c) => !gone.has(c.id)) }))
    .filter((p) => p.cuts.length > 0);
  const seams = (g.seams ?? []).filter(
    (s) => ![...s.a, ...s.b].some((r) => gone.has(r.cut)),
  );
  const piecesGone = g.pieces.length - pieces.length;
  const label =
    gone.size === 1 && piecesGone === 1
      ? "Delete a piece"
      : gone.size === 1
        ? "Delete a cut"
        : "Delete pieces";
  const lost = (g.seams ?? []).length - seams.length;
  const also = gone.size - asked.size;
  const notes: string[] = [];
  if (also)
    notes.push(
      also === 1
        ? "The cut placed on it was removed too"
        : `${also} cuts placed on them were removed too`,
    );
  if (lost)
    notes.push(
      lost === 1
        ? "The seam that sewed it was removed"
        : `${lost} seams that sewed them were removed`,
    );
  const cmd = editGarment(
    e,
    garmentId,
    (x) => {
      let out = setIn(x, ["pieces"], pieces);
      out = setIn(
        out,
        ["stack"],
        x.stack.filter((id) => !gone.has(id)),
      );
      if (x.seams) out = setIn(out, ["seams"], seams);
      return out;
    },
    { label, drape: true },
  );
  return notes.length ? { ...cmd, note: notes.join(". ") } : cmd;
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
export function addPieces(
  e: Entities,
  garmentId: string,
  a: Addition,
): Command {
  if (!a.pieces.length) throw new CommandError("nothing to import");
  return editGarment(
    e,
    garmentId,
    (g) => {
      let out = setIn(g, ["pieces"], [...g.pieces, ...a.pieces]);
      out = setIn(
        out,
        ["stack"],
        stackWith(
          g,
          a.pieces.flatMap((p) => p.cuts),
        ),
      );
      if (a.seams.length)
        out = setIn(out, ["seams"], [...(g.seams ?? []), ...a.seams]);
      out = setIn(out, ["sources"], [...(g.sources ?? []), a.source]);
      const own = g.simulation?.collisionBounds;
      const box: Bounds = own
        ? {
            min: own.min.map((x, k) =>
              Math.min(x, a.bounds.min[k] ?? x),
            ) as Vec3,
            max: own.max.map((x, k) =>
              Math.max(x, a.bounds.max[k] ?? x),
            ) as Vec3,
          }
        : a.bounds;
      if (
        !own ||
        !deepEqual(own.min, box.min) ||
        !deepEqual(own.max, box.max)
      ) {
        out = setIn(
          out,
          ["simulation", "collisionBounds"],
          own ? { ...own, min: box.min, max: box.max } : box,
        );
      }
      return out;
    },
    { label: "Import pieces", drape: true },
  );
}

/**
 * From the `saved` document to `current` (the same entities, other values): a recovery copy
 * put back, as one undoable step.
 */
export function recoverChanges(saved: Entities, current: Entities): Command {
  const changes: Change[] = [];
  const slots: Slot[] = [
    ...(saved.project ? [{ kind: "project" } as const] : []),
    ...(saved.view ? [{ kind: "view" } as const] : []),
    ...saved.garments.map((g) => ({ kind: "garment", id: g.id }) as const),
    ...saved.fabrics.map((f) => ({ kind: "fabric", id: f.id }) as const),
    ...saved.avatars.map((a) => ({ kind: "avatar", id: a.id }) as const),
  ];
  for (const slot of slots) {
    const before = getEntity(saved, slot);
    const after = getEntity(current, slot);
    if (after === undefined)
      throw new CommandError(`the recovery copy has no ${slotKey(slot)}`);
    if (deepEqual(before, after)) continue;
    const problems = schemaErrors(slot.kind, after);
    if (problems.length)
      throw new CommandError(
        `the recovery copy is damaged: ${problems.join("; ")}`,
      );
    changes.push({ slot, before, after });
  }
  if (!changes.length)
    throw new CommandError("the recovery copy has no changes");
  return { label: "Recover unsaved changes", drape: true, changes };
}
