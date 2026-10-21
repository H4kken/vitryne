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
  addFabric,
  cutColor,
  deleteFabric,
  importFabric,
  setCutFabric,
  setDefaultFabric,
  setFabricColor,
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
    addFabric(
      e,
      { preset: FLEECE, color: "#1F2A44" },
      { fabric: ID_A, appearance: ID_B },
    ),
    importFabric(
      e,
      {
        library: ID_LIB,
        fabric: { ...DENIM, appearance: ID_C },
        appearance: NAVY_C,
      },
      { fabric: ID_A, appearance: ID_B },
    ),
    setFabricColor(e, fabric.id, "#b5282e", () => ID_B),
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
  ];
}

const ID_A = "01a13cdb-cc05-7000-8000-00000000000a";
const ID_B = "01a13cdb-cc05-7000-8000-00000000000b";
const ID_C = "01a13cdb-cc05-7000-8000-00000000000c";
const ID_LIB = "01a13cdb-cc05-7000-8000-0000000000ff";
const NAVY_C = { id: ID_C, name: "Navy", color: "#1f2a44" };

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

describe("fabrics", () => {
  const { file, entities } = openExample("tshirt");
  const e0 = deepFreeze(entities);
  const g0 = mainGarment(e0)!;
  const front = g0.pieces[0]!;
  const run = (e: Entities, cmd: Command) => {
    const after = applyCommand(e, cmd);
    expect(rustRefuses(file, after), cmd.label).toBeNull();
    expect(JSON.stringify(revertCommand(after, cmd)), cmd.label).toBe(
      JSON.stringify(e),
    );
    return after;
  };
  const colors = (e: Entities) => {
    const g = mainGarment(e)!;
    return g.pieces.map((p) => cutColor(e, g, p.cuts[0]!));
  };

  it("makes a fabric, gives it to a piece, recolours it, and deletes it once unused", () => {
    expect(colors(e0).every((c) => c === undefined)).toBe(true);
    const add = addFabric(
      e0,
      { preset: DENIM, color: "#1F2A44" },
      { fabric: ID_A, appearance: ID_B },
    );
    expect(add.drape).toBe(false);
    let e = run(e0, add);
    expect(e.fabrics.at(-1)).toMatchObject({
      id: ID_A,
      name: "Navy denim",
      appearance: ID_B,
      density: DENIM.density,
    });
    expect(e.appearances).toEqual([
      { id: ID_B, name: "Navy", color: "#1f2a44" },
    ]);
    expect(e.project!.fabrics).toEqual([...e0.project!.fabrics, ID_A]);
    expect(e.project!.appearances).toEqual([ID_B]);

    const use = setPieceFabric(e, g0.id, front.id, ID_A);
    expect(use.drape).toBe(true);
    e = run(e, use);
    expect(colors(e)[0]).toBe("#1f2a44");
    expect(
      colors(e)
        .slice(1)
        .every((c) => c === undefined),
    ).toBe(true);
    expect(() => deleteFabric(e, ID_A)).toThrow(/in use/);

    // Only this fabric uses its look: recoloured in place, and its made-up name follows.
    const red = setFabricColor(e, ID_A, "#b5282e");
    expect(red.drape).toBe(false);
    e = run(e, red);
    expect(e.appearances).toEqual([
      { id: ID_B, name: "Red", color: "#b5282e" },
    ]);
    expect(e.fabrics.at(-1)!.name).toBe("Red denim");
    expect(colors(e)[0]).toBe("#b5282e");
    // A name the person gave stays.
    e = run(e, renameFabric(e, ID_A, "My jeans"));
    e = run(e, setFabricColor(e, ID_A, "#3b5a80"));
    expect(e.fabrics.at(-1)!.name).toBe("My jeans");
    expect(() => setFabricColor(e, ID_A, "#3B5A80")).toThrow(/nothing changes/);

    e = run(e, setPieceFabric(e, g0.id, front.id, undefined));
    e = run(e, deleteFabric(e, ID_A));
    expect(JSON.stringify(e)).toBe(JSON.stringify(e0));
  });

  it("makes another fabric the garment's, its look with it", () => {
    let e = run(
      e0,
      addFabric(
        e0,
        { preset: FLEECE, color: "#2f5d43" },
        { fabric: ID_A, appearance: ID_B },
      ),
    );
    e = run(e, setDefaultFabric(e, g0.id, ID_A));
    expect(mainGarment(e)!.fabric).toBe(ID_A);
    expect(colors(e).every((c) => c === "#2f5d43")).toBe(true);
    // The old one is unused now, so it can go.
    e = run(e, deleteFabric(e, g0.fabric));
    expect(e.fabrics.map((f) => f.id)).toEqual([ID_A]);
  });

  it("gives way to the fabric when a file still has a garment colour of its own", () => {
    const old = deepFreeze({
      ...e0,
      appearances: [{ id: ID_C, name: "Black", color: "#22252a" }],
      project: { ...e0.project!, appearances: [ID_C] },
      garments: [{ ...g0, appearance: ID_C }],
    });
    expect(rustRefuses(file, old)).toBeNull();
    expect(colors(old).every((c) => c === "#22252a")).toBe(true);
    const e = run(
      old,
      setFabricColor(old, g0.fabric, "#f4f2ec", () => ID_A),
    );
    expect(colors(e).every((c) => c === "#f4f2ec")).toBe(true);
    expect(mainGarment(e)!.appearance).toBeUndefined();
    // The garment's colour, used by nothing now, is gone.
    expect(e.appearances).toEqual([
      { id: ID_A, name: "White", color: "#f4f2ec" },
    ]);
    expect(e.project!.appearances).toEqual([ID_A]);
  });

  it("copies a fabric from another project with new ids and where it came from", () => {
    const e = run(
      e0,
      importFabric(
        e0,
        {
          library: ID_LIB,
          fabric: { ...DENIM, appearance: ID_C },
          appearance: NAVY_C,
        },
        { fabric: ID_A, appearance: ID_B },
      ),
    );
    expect(e.fabrics.at(-1)).toMatchObject({
      id: ID_A,
      appearance: ID_B,
      libraryRef: { library: ID_LIB, entity: DENIM.id },
    });
    expect(e.appearances).toEqual([
      { ...NAVY_C, id: ID_B, libraryRef: { library: ID_LIB, entity: ID_C } },
    ]);
  });

  it("refuses what is not a colour, or a fabric that isn't there", () => {
    expect(() => addFabric(e0, { preset: DENIM, color: "navy" })).toThrow(
      CommandError,
    );
    expect(() => setFabricColor(e0, g0.fabric, "navy")).toThrow(CommandError);
    expect(() => setCutFabric(e0, g0.id, front.cuts[0]!.id, ID_A)).toThrow(
      /no fabric/,
    );
    expect(() => setPieceFabric(e0, g0.id, front.id, undefined)).toThrow(
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

  it("overrides cut and piece fabric, and undoes cleanly", () => {
    const { file, entities: e0 } = openExample("tshirt");
    const entities = applyCommand(
      e0,
      addFabric(
        e0,
        { preset: POPLIN, color: "#8fb8de" },
        { fabric: ID_A, appearance: ID_B },
      ),
    );
    const g = mainGarment(entities)!;
    const piece = g.pieces[0]!;
    const cut = piece.cuts[0]!;

    const cutCmd = setCutFabric(entities, g.id, cut.id, ID_A);
    const cutApplied = applyCommand(entities, cutCmd);
    expect(mainGarment(cutApplied)!.pieces[0]!.cuts[0]!.fabric).toBe(ID_A);
    expect(rustRefuses(file, cutApplied)).toBeNull();
    expect(JSON.stringify(revertCommand(cutApplied, cutCmd))).toBe(
      JSON.stringify(entities),
    );

    const pieceCmd = setPieceFabric(entities, g.id, piece.id, ID_A);
    const pieceApplied = applyCommand(entities, pieceCmd);
    for (const c of mainGarment(pieceApplied)!.pieces[0]!.cuts)
      expect(c.fabric).toBe(ID_A);
    expect(rustRefuses(file, pieceApplied)).toBeNull();

    // The garment's own fabric is stored as none.
    const resetCmd = setPieceFabric(pieceApplied, g.id, piece.id, g.fabric);
    const resetApplied = applyCommand(pieceApplied, resetCmd);
    for (const c of mainGarment(resetApplied)!.pieces[0]!.cuts)
      expect(c.fabric).toBeUndefined();
    expect(rustRefuses(file, resetApplied)).toBeNull();
  });
});
