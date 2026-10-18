// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { EXAMPLES, openExample, rustRefuses } from "@/test/rust";
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
  removeCuts,
  renameSeam,
  reverseSeam,
  revertCommand,
  selfCollision,
  cutColor,
  pieceColor,
  setColor,
  setCutFabric,
  setFabricValue,
  setLayout,
  setLayouts,
  setMirrored,
  setPieceFabric,
  setPlacement,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from "./commands";
import { type Entities, mainGarment } from "./entities";
import { deepFreeze } from "./json";
import {
  COTTON_JERSEY,
  DENIM,
  FLEECE,
  ID_DENIM,
  ID_FLEECE,
  ID_POPLIN,
  POPLIN,
  WOOL_SUITING,
} from "@/format/presets";

/** One of each command, on a document. */
function everyCommand(e: Entities): Command[] {
  const g = mainGarment(e)!;
  const piece = g.pieces[0]!;
  const fabric = e.fabrics[0]!;
  return [
    renameProject(e, "Renamed"),
    renamePiece(e, g.id, piece.id, "front panel"),
    renameCut(e, g.id, piece.id, piece.cuts[0]!.id, "left front"),
    renameCut(e, g.id, piece.id, piece.cuts[0]!.id, ""),
    renameSeam(e, g.id, g.seams![0]!.id, "side"),
    renameFabric(e, fabric.id, "Denim"),
    applyFabricPreset(e, fabric.id, DENIM),
    setCutFabric(e, g.id, piece.cuts[0]!.id, ID_DENIM),
    setPieceFabric(e, g.id, piece.id, ID_FLEECE),
    // Sewing: the first seam taken out, turned over, and put back as a new one.
    removeSeam(e, g.id, g.seams![0]!.id),
    reverseSeam(e, g.id, g.seams![0]!.id),
    addSeam(
      e,
      g.id,
      { a: g.seams![0]!.a, b: g.seams![0]!.b, pairing: g.seams![0]!.pairing },
      "01a13cdb-cc00-7000-8000-000000000999",
      "Again",
    ),
    ...(Object.keys(FABRIC_FIELDS) as FabricField[]).map((f) =>
      setFabricValue(e, fabric.id, f, 0.123),
    ),
    setTargetVertices(e, 5000),
    setSelfCollision(e, !selfCollision(e)),
    setPlacement(e, g.id, piece.cuts[0]!.id, {
      ...piece.cuts[0]!.placement,
      angle: (piece.cuts[0]!.placement.angle ?? 0) + 0.1,
    }),
    setPlacement(
      e,
      g.id,
      piece.cuts[0]!.id,
      { type: "wrap", region: "torso", angle: 1, radius: 250, top: 1500 },
      {
        min: [-600, 0, -300],
        max: [600, 1800, 400],
      },
    ),
    setMirrored(e, g.id, piece.cuts[0]!.id, !piece.cuts[0]!.mirrored),
    setLayout(e, g.id, piece.cuts[0]!.id, {
      position: [120, -40],
      rotation: 0.5,
    }),
    removeCuts(e, g.id, [piece.cuts[0]!.id]),
    removeCuts(
      e,
      g.id,
      g.pieces.flatMap((p) => p.cuts.map((c) => c.id)),
    ),
    setLayouts(e, g.id, {
      [piece.cuts[0]!.id]: { position: [10, 20], rotation: 0 },
      [g.pieces[1]!.cuts[0]!.id]: { position: [-30, 40], rotation: 0.25 },
    }),
    setColor(e, g.id, { kind: "garment" }, "#1F2A44", () => ID_A),
    setColor(
      e,
      g.id,
      { kind: "piece", pieceId: piece.id },
      "#b5282e",
      () => ID_B,
    ),
  ];
}

const ID_A = "01a13cdb-cc05-7000-8000-00000000000a";
const ID_B = "01a13cdb-cc05-7000-8000-00000000000b";
const ID_C = "01a13cdb-cc05-7000-8000-00000000000c";

describe.each(EXAMPLES)("%s", (name) => {
  const { file, entities } = openExample(name);
  const frozen = deepFreeze(entities);

  it("every command applies, is accepted by Rust, and reverts to the identical document", () => {
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

  it("refuses invalid values before they become commands", () => {
    const fabric = frozen.fabrics[0]!.id;
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setFabricValue(frozen, fabric, "density", v)).toThrow(
        CommandError,
      );
    }
    expect(() => setFabricValue(frozen, fabric, "friction", -0.01)).toThrow(
      CommandError,
    );
    expect(() => setTargetVertices(frozen, 50)).toThrow(CommandError);
    expect(() => setTargetVertices(frozen, 5000.5)).toThrow(CommandError);
    expect(() => renameProject(frozen, frozen.project!.name!)).toThrow(
      /nothing changes/,
    );
  });

  it("refuses placements Rust or the schema would refuse", () => {
    const g = mainGarment(frozen)!;
    const cut = g.pieces[0]!.cuts[0]!;
    expect(() =>
      setPlacement(frozen, g.id, cut.id, {
        type: "wrap",
        region: "torso",
        angle: 0,
        radius: -5,
        top: 0,
      }),
    ).toThrow(CommandError);
    expect(() =>
      setLayout(frozen, g.id, cut.id, {
        position: [Number.NaN, 0],
        rotation: 0,
      }),
    ).toThrow(CommandError);
    expect(() =>
      setPlacement(frozen, g.id, cut.id, {
        ...cut.placement,
        angle: Number.NaN,
      }),
    ).toThrow(/number/);
    // On itself: the schema allows it, Rust wouldn't.
    expect(() =>
      setPlacement(frozen, g.id, cut.id, {
        type: "follow",
        cut: cut.id,
        lift: 12,
      }),
    ).toThrow(/itself/);
  });

  it("deletes cuts with their seams, and a piece with its last cut", () => {
    const g = mainGarment(frozen)!;
    const piece = g.pieces.find((p) =>
      (g.seams ?? []).some((s) =>
        [...s.a, ...s.b].some((r) => p.cuts.some((c) => c.id === r.cut)),
      ),
    )!;
    const ids = piece.cuts.map((c) => c.id);
    const cmd = removeCuts(frozen, g.id, ids);
    const after = mainGarment(applyCommand(frozen, cmd))!;
    expect(after.pieces.some((p) => p.id === piece.id)).toBe(false);
    const cuts = new Set(after.pieces.flatMap((p) => p.cuts.map((c) => c.id)));
    for (const s of after.seams ?? [])
      for (const r of [...s.a, ...s.b]) expect(cuts.has(r.cut)).toBe(true);
    expect(cmd.note).toMatch(/seam/);
    expect(() => removeCuts(frozen, g.id, ["nope"])).toThrow(CommandError);
  });

  it("refuses to apply or revert from a state it does not expect", () => {
    const a = setFabricValue(frozen, frozen.fabrics[0]!.id, "friction", 0.9);
    const b = setFabricValue(frozen, frozen.fabrics[0]!.id, "friction", 0.8);
    const after = applyCommand(frozen, a);
    expect(() => applyCommand(after, b)).toThrow(CommandError);
    expect(() => revertCommand(frozen, a)).toThrow(CommandError);
  });

  it("reads the effective simulation settings", () => {
    expect(targetVertices(frozen)).toBe(10_000);
    expect(selfCollision(frozen)).toBe(true);
    const off = applyCommand(frozen, setSelfCollision(frozen, false));
    expect(selfCollision(off)).toBe(false);
    // The examples set it on the garment, so that's where the edit goes.
    expect(mainGarment(off)!.simulation).toMatchObject({
      engine: { self_collision: false },
    });
    expect(off.project).toBe(frozen.project);
  });
});

describe("colours", () => {
  const { file, entities } = openExample("tshirt");
  const e0 = deepFreeze(entities);
  const g0 = mainGarment(e0)!;
  const [front, other] = [g0.pieces[0]!, g0.pieces[1]!];
  const ids = [ID_A, ID_B, ID_C];
  const next = () => ids.shift()!;
  const run = (e: Entities, cmd: Command) => {
    const after = applyCommand(e, cmd);
    expect(rustRefuses(file, after), cmd.label).toBeNull();
    expect(cmd.drape).toBe(false);
    return after;
  };

  it("colours the garment, then a piece over it, and takes them away again", () => {
    expect(cutColor(e0, g0, front.cuts[0]!)).toBeUndefined();
    let e = run(e0, setColor(e0, g0.id, { kind: "garment" }, "#1F2A44", next));
    expect(e.appearances).toEqual([
      { id: ID_A, name: "Navy", color: "#1f2a44" },
    ]);
    expect(e.project!.appearances).toEqual([ID_A]);
    let g = mainGarment(e)!;
    expect(
      g.pieces
        .flatMap((p) => p.cuts)
        .every((c) => cutColor(e, g, c) === "#1f2a44"),
    ).toBe(true);

    // Only the garment uses it: recoloured in place, no new appearance.
    e = run(e, setColor(e, g.id, { kind: "garment" }, "#3b5a80", next));
    expect(e.appearances).toEqual([
      { id: ID_A, name: "Denim blue", color: "#3b5a80" },
    ]);

    // A piece of the garment's colour shares its appearance; one of its own gets a new one.
    e = run(
      e,
      setColor(e, g.id, { kind: "piece", pieceId: other.id }, "#3b5a80", next),
    );
    expect(e.appearances).toHaveLength(1);
    e = run(
      e,
      setColor(
        e,
        mainGarment(e)!.id,
        { kind: "piece", pieceId: front.id },
        "#c0643f",
        next,
      ),
    );
    g = mainGarment(e)!;
    expect(e.appearances).toHaveLength(2);
    expect(pieceColor(e, g.pieces[0]!)).toBe("#c0643f");
    expect(cutColor(e, g, g.pieces[2]!.cuts[0]!)).toBe("#3b5a80");

    // Now shared, the garment's appearance isn't changed in place: the piece keeps its colour.
    e = run(e, setColor(e, g.id, { kind: "garment" }, "#f4f2ec", next));
    g = mainGarment(e)!;
    expect(pieceColor(e, g.pieces[1]!)).toBe("#3b5a80");
    expect(e.appearances!.map((a) => a.color).sort()).toEqual([
      "#3b5a80",
      "#c0643f",
      "#f4f2ec",
    ]);

    // Taking colours away removes the appearances nothing uses.
    for (const p of g.pieces) {
      if (pieceColor(e, p))
        e = run(
          e,
          setColor(e, g.id, { kind: "piece", pieceId: p.id }, undefined),
        );
    }
    e = run(e, setColor(e, g.id, { kind: "garment" }, undefined));
    expect(e.appearances).toBeUndefined();
    expect(e.project!.appearances).toBeUndefined();
    expect(JSON.stringify(e)).toBe(JSON.stringify(e0));
  });

  it("refuses what is not a colour, or changes nothing", () => {
    expect(() => setColor(e0, g0.id, { kind: "garment" }, "navy")).toThrow(
      CommandError,
    );
    expect(() => setColor(e0, g0.id, { kind: "garment" }, undefined)).toThrow(
      /nothing changes/,
    );
    const e = applyCommand(
      e0,
      setColor(e0, g0.id, { kind: "garment" }, "#1f2a44", () => ID_C),
    );
    expect(() => setColor(e, g0.id, { kind: "garment" }, "#1F2A44")).toThrow(
      /nothing changes/,
    );
  });
});

describe("recoverChanges", () => {
  it("puts a recovery copy back as one undoable step", () => {
    const { file, entities } = openExample("tshirt");
    const edited = applyCommand(
      entities,
      setFabricValue(entities, entities.fabrics[0]!.id, "friction", 0.7),
    );
    const renamed = applyCommand(edited, renameProject(edited, "Mine"));
    const cmd = recoverChanges(entities, renamed);
    expect(cmd.changes).toHaveLength(2);
    const back = applyCommand(entities, cmd);
    expect(JSON.stringify(back)).toBe(JSON.stringify(renamed));
    expect(rustRefuses(file, back)).toBeNull();
    expect(JSON.stringify(revertCommand(back, cmd))).toBe(
      JSON.stringify(entities),
    );
    expect(() => recoverChanges(entities, entities)).toThrow(/no changes/);
    const damaged = {
      ...renamed,
      fabrics: [{ ...renamed.fabrics[0]!, density: -1 }],
    };
    expect(() => recoverChanges(entities, damaged)).toThrow(/damaged/);
  });
});

describe("fabric presets and overrides", () => {
  it("applies every preset, validating schema and Rust compatibility", () => {
    const { file, entities } = openExample("tshirt");
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

  it("overrides cut and piece fabric, adding preset entity when needed, and undoes cleanly", () => {
    const { file, entities } = openExample("tshirt");
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
