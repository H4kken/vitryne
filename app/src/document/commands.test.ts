// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { EXAMPLES, openExample, rustRefuses } from '@/test/rust';
import {
  addSeam,
  applyCommand,
  applyFabricPreset,
  type Command,
  CommandError,
  FABRIC_FIELDS,
  type FabricField,
  renameCut,
  renameFabric,
  renamePiece,
  renameProject,
  recoverChanges,
  removeSeam,
  renameSeam,
  reverseSeam,
  revertCommand,
  selfCollision,
  setCutFabric,
  setFabricValue,
  setLayout,
  setMirrored,
  setPieceFabric,
  setPlacement,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from './commands';
import { type Entities, mainGarment } from './entities';
import { deepFreeze } from './json';
import { COTTON_JERSEY, DENIM, FLEECE, ID_DENIM, ID_FLEECE, ID_POPLIN, POPLIN, WOOL_SUITING } from '@/format/presets';

/** One of each command, on a document. */
function everyCommand(e: Entities): Command[] {
  const g = mainGarment(e)!;
  const piece = g.pieces[0]!;
  const fabric = e.fabrics[0]!;
  return [
    renameProject(e, 'Renamed'),
    renamePiece(e, g.id, piece.id, 'front panel'),
    renameCut(e, g.id, piece.id, piece.cuts[0]!.id, 'left front'),
    renameCut(e, g.id, piece.id, piece.cuts[0]!.id, ''),
    renameSeam(e, g.id, g.seams![0]!.id, 'side'),
    renameFabric(e, fabric.id, 'Denim'),
    applyFabricPreset(e, fabric.id, DENIM),
    setCutFabric(e, g.id, piece.cuts[0]!.id, ID_DENIM),
    setPieceFabric(e, g.id, piece.id, ID_FLEECE),
    // Sewing: the first seam taken out, turned over, and put back as a new one.
    removeSeam(e, g.id, g.seams![0]!.id),
    reverseSeam(e, g.id, g.seams![0]!.id),
    addSeam(e, g.id, { a: g.seams![0]!.a, b: g.seams![0]!.b, pairing: g.seams![0]!.pairing }, '01a13cdb-cc00-7000-8000-000000000999', 'Again'),
    ...(Object.keys(FABRIC_FIELDS) as FabricField[]).map((f) => setFabricValue(e, fabric.id, f, 0.123)),
    setTargetVertices(e, 5000),
    setSelfCollision(e, !selfCollision(e)),
    setPlacement(e, g.id, piece.cuts[0]!.id, { ...piece.cuts[0]!.placement, angle: (piece.cuts[0]!.placement.angle ?? 0) + 0.1 }),
    setPlacement(e, g.id, piece.cuts[0]!.id, { type: 'wrap', region: 'torso', angle: 1, radius: 250, top: 1500 }, {
      min: [-600, 0, -300],
      max: [600, 1800, 400],
    }),
    setMirrored(e, g.id, piece.cuts[0]!.id, !piece.cuts[0]!.mirrored),
    setLayout(e, g.id, piece.cuts[0]!.id, { position: [120, -40], rotation: 0.5 }),
  ];
}

describe.each(EXAMPLES)('%s', (name) => {
  const { file, entities } = openExample(name);
  const frozen = deepFreeze(entities);

  it('every command applies, is accepted by Rust, and reverts to the identical document', () => {
    const before = JSON.stringify(frozen);
    for (const cmd of everyCommand(frozen)) {
      const after = applyCommand(frozen, cmd);
      expect(after).not.toBe(frozen);
      expect(rustRefuses(file, after), cmd.label).toBeNull();
      const back = revertCommand(after, cmd);
      expect(JSON.stringify(back), cmd.label).toBe(before);
    }
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('refuses invalid values before they become commands', () => {
    const fabric = frozen.fabrics[0]!.id;
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setFabricValue(frozen, fabric, 'density', v)).toThrow(CommandError);
    }
    expect(() => setFabricValue(frozen, fabric, 'friction', -0.01)).toThrow(CommandError);
    expect(() => setTargetVertices(frozen, 50)).toThrow(CommandError);
    expect(() => setTargetVertices(frozen, 5000.5)).toThrow(CommandError);
    expect(() => renameProject(frozen, frozen.project!.name!)).toThrow(/nothing changes/);
  });

  it('refuses placements Rust or the schema would refuse', () => {
    const g = mainGarment(frozen)!;
    const cut = g.pieces[0]!.cuts[0]!;
    expect(() => setPlacement(frozen, g.id, cut.id, { type: 'wrap', region: 'torso', angle: 0, radius: -5, top: 0 })).toThrow(CommandError);
    expect(() => setLayout(frozen, g.id, cut.id, { position: [Number.NaN, 0], rotation: 0 })).toThrow(CommandError);
    expect(() => setPlacement(frozen, g.id, cut.id, { ...cut.placement, angle: Number.NaN })).toThrow(/number/);
    // On itself: the schema allows it, Rust wouldn't.
    expect(() => setPlacement(frozen, g.id, cut.id, { type: 'follow', cut: cut.id, lift: 12 })).toThrow(/itself/);
  });

  it('refuses to apply or revert from a state it does not expect', () => {
    const a = setFabricValue(frozen, frozen.fabrics[0]!.id, 'friction', 0.9);
    const b = setFabricValue(frozen, frozen.fabrics[0]!.id, 'friction', 0.8);
    const after = applyCommand(frozen, a);
    expect(() => applyCommand(after, b)).toThrow(CommandError);
    expect(() => revertCommand(frozen, a)).toThrow(CommandError);
  });

  it('reads the effective simulation settings', () => {
    expect(targetVertices(frozen)).toBe(10_000);
    expect(selfCollision(frozen)).toBe(true);
    const off = applyCommand(frozen, setSelfCollision(frozen, false));
    expect(selfCollision(off)).toBe(false);
    // The examples set it on the garment, so that's where the edit goes.
    expect(mainGarment(off)!.simulation).toMatchObject({ engine: { self_collision: false } });
    expect(off.project).toBe(frozen.project);
  });
});

describe('recoverChanges', () => {
  it('puts a recovery copy back as one undoable step', () => {
    const { file, entities } = openExample('tshirt');
    const edited = applyCommand(entities, setFabricValue(entities, entities.fabrics[0]!.id, 'friction', 0.7));
    const renamed = applyCommand(edited, renameProject(edited, 'Mine'));
    const cmd = recoverChanges(entities, renamed);
    expect(cmd.changes).toHaveLength(2);
    const back = applyCommand(entities, cmd);
    expect(JSON.stringify(back)).toBe(JSON.stringify(renamed));
    expect(rustRefuses(file, back)).toBeNull();
    expect(JSON.stringify(revertCommand(back, cmd))).toBe(JSON.stringify(entities));
    expect(() => recoverChanges(entities, entities)).toThrow(/no changes/);
    const damaged = { ...renamed, fabrics: [{ ...renamed.fabrics[0]!, density: -1 }] };
    expect(() => recoverChanges(entities, damaged)).toThrow(/damaged/);
  });
});

describe('fabric presets and overrides', () => {
  it('applies every preset, validating schema and Rust compatibility', () => {
    const { file, entities } = openExample('tshirt');
    const fabric = entities.fabrics[0]!;
    for (const preset of [COTTON_JERSEY, DENIM, POPLIN, FLEECE, WOOL_SUITING]) {
      const cmd = applyFabricPreset(entities, fabric.id, preset);
      const applied = applyCommand(entities, cmd);
      expect(applied.fabrics[0]?.density).toBe(preset.density);
      expect(applied.fabrics[0]?.stretch.warp).toBe(preset.stretch.warp);
      expect(applied.fabrics[0]?.bending.warp).toBe(preset.bending.warp);
      expect(rustRefuses(file, applied)).toBeNull();
      const reverted = revertCommand(applied, cmd);
      expect(JSON.stringify(reverted)).toBe(JSON.stringify(entities));
    }
  });

  it('overrides cut and piece fabric, adding preset entity when needed, and undoes cleanly', () => {
    const { file, entities } = openExample('tshirt');
    const g = mainGarment(entities)!;
    const piece = g.pieces[0]!;
    const cut = piece.cuts[0]!;

    // Override one cut to denim
    const cutCmd = setCutFabric(entities, g.id, cut.id, ID_DENIM);
    const cutApplied = applyCommand(entities, cutCmd);
    expect(cutApplied.fabrics.some((f) => f.id === ID_DENIM)).toBe(true);
    expect(cutApplied.project?.fabrics.includes(ID_DENIM)).toBe(true);
    const updatedCut = mainGarment(cutApplied)!.pieces[0]!.cuts[0]!;
    expect(updatedCut.fabric).toBe(ID_DENIM);
    expect(rustRefuses(file, cutApplied)).toBeNull();

    // Revert cut override
    const cutReverted = revertCommand(cutApplied, cutCmd);
    expect(JSON.stringify(cutReverted)).toBe(JSON.stringify(entities));

    // Override entire piece
    const pieceCmd = setPieceFabric(entities, g.id, piece.id, ID_POPLIN);
    const pieceApplied = applyCommand(entities, pieceCmd);
    for (const c of mainGarment(pieceApplied)!.pieces[0]!.cuts) {
      expect(c.fabric).toBe(ID_POPLIN);
    }
    expect(rustRefuses(file, pieceApplied)).toBeNull();

    // Reset piece fabric to default
    const resetCmd = setPieceFabric(pieceApplied, g.id, piece.id, undefined);
    const resetApplied = applyCommand(pieceApplied, resetCmd);
    for (const c of mainGarment(resetApplied)!.pieces[0]!.cuts) {
      expect(c.fabric).toBeUndefined();
    }
    expect(rustRefuses(file, resetApplied)).toBeNull();
  });
});
