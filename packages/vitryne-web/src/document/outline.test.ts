// SPDX-License-Identifier: AGPL-3.0-or-later
// The point tool's commands on the examples: each applies, Rust accepts it, and
// it reverts to the identical document; what they take with them and what they say.
import { describe, expect, it } from "vitest";
import { EXAMPLES, openExample, rustRefuses } from "@/test/rust";
import type { Garment, Piece } from "@/format/schema.gen";
import { curvedEdge, edgePoints, straightEdge } from "@/pattern/edit";
import {
  applyCommand,
  type Command,
  CommandError,
  insertNode,
  moveNodes,
  removeNode,
  revertCommand,
  setEdge,
  setNodeType,
} from "./commands";
import { type Entities, mainGarment } from "./entities";
import { deepFreeze, setIn } from "./json";

const NEW_ID = "01a13cdb-cc05-7000-8000-0000000000ee";

/** A node of `piece` some seam starts or ends at, if any. */
function sewnNode(g: Garment, piece: Piece): string | undefined {
  const cuts = new Set(piece.cuts.map((c) => c.id));
  for (const s of g.seams ?? [])
    for (const r of [...s.a, ...s.b])
      if (cuts.has(r.cut) && r.line === undefined) return r.from;
  return undefined;
}

function everyEdit(e: Entities): Command[] {
  const g = mainGarment(e)!;
  const piece = g.pieces[0]!;
  const [n0, n1] = piece.outline;
  const [p0, p1] = edgePoints(piece.outline, 0);
  const mid: [number, number] = [(p0![0] + p1![0]) / 2, (p0![1] + p1![1]) / 2];
  const straight = piece.outline.findIndex(
    (n) => n.edge.type === "polyline" && n.edge.points.length === 0,
  );
  const curved = setEdge(e, g.id, piece.id, piece.outline[straight]!.id, {
    ...curvedEdge(piece.outline, straight),
  });
  return [
    moveNodes(e, g.id, piece.id, {
      [n0!.id]: [n0!.position[0] + 2, n0!.position[1] + 1],
    }),
    insertNode(e, g.id, piece.id, n0!.id, [mid[0], mid[1]], NEW_ID),
    removeNode(e, g.id, piece.id, sewnNode(g, piece) ?? n1!.id),
    setNodeType(
      e,
      g.id,
      piece.id,
      n1!.id,
      n1!.type === "notch" ? "corner" : "notch",
    ),
    curved,
    // Back to straight, from the curved state.
    setEdge(
      applyCommand(e, curved),
      g.id,
      piece.id,
      piece.outline[straight]!.id,
      straightEdge(),
    ),
  ];
}

describe.each(EXAMPLES)("%s", (name) => {
  const { file, entities } = openExample(name);
  const frozen = deepFreeze(entities);

  it("every point edit applies, is accepted by Rust, and reverts to the identical document", () => {
    const before = JSON.stringify(frozen);
    const cmds = everyEdit(frozen);
    for (const [k, cmd] of cmds.entries()) {
      // The last one starts from the curved edge.
      const from =
        k === cmds.length - 1 ? applyCommand(frozen, cmds[k - 1]!) : frozen;
      const start = JSON.stringify(from);
      const after = applyCommand(from, cmd);
      expect(rustRefuses(file, after), cmd.label).toBeNull();
      expect(JSON.stringify(revertCommand(after, cmd)), cmd.label).toBe(start);
    }
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("deleting a point takes the seams and folds that use it, and says so", () => {
    const g = mainGarment(frozen)!;
    for (const piece of g.pieces) {
      const node = sewnNode(g, piece) ?? piece.folds?.[0]?.from;
      if (!node || piece.outline.length <= 3) continue;
      const cmd = removeNode(frozen, g.id, piece.id, node);
      const after = mainGarment(applyCommand(frozen, cmd))!;
      const runs = (after.seams ?? []).flatMap((s) => [...s.a, ...s.b]);
      expect(runs.some((r) => r.from === node || r.to === node)).toBe(false);
      const p = after.pieces.find((x) => x.id === piece.id)!;
      expect(
        (p.folds ?? []).some((f) => f.from === node || f.to === node),
      ).toBe(false);
      expect(cmd.note).toMatch(/removed/);
      expect(rustRefuses(file, applyCommand(frozen, cmd))).toBeNull();
    }
  });

  it("refuses a move that makes the outline cross itself, as Rust does", () => {
    const g = mainGarment(frozen)!;
    const piece = g.pieces[0]!;
    const [a, , c] = piece.outline;
    // A node dragged far across the piece, past the node two along.
    const far: [number, number] = [
      a!.position[0] + 3 * (c!.position[0] - a!.position[0]),
      a!.position[1] + 3 * (c!.position[1] - a!.position[1]),
    ];
    expect(() => moveNodes(frozen, g.id, piece.id, { [a!.id]: far })).toThrow(
      CommandError,
    );
    // Rust, given the same state directly, refuses it too.
    const i = g.pieces.indexOf(piece);
    const bad = setIn(g, ["pieces", i, "outline", 0, "position"], far);
    expect(
      rustRefuses(file, {
        ...frozen,
        garments: frozen.garments.map((x) => (x.id === g.id ? bad : x)),
      }),
    ).not.toBeNull();
  });

  it("refuses deleting a point of a triangle, and an unknown point", () => {
    const g = mainGarment(frozen)!;
    const piece = g.pieces[0]!;
    expect(() => removeNode(frozen, g.id, piece.id, NEW_ID)).toThrow(
      CommandError,
    );
    expect(() =>
      setNodeType(
        frozen,
        g.id,
        piece.id,
        piece.outline[0]!.id,
        piece.outline[0]!.type,
      ),
    ).toThrow(CommandError);
  });
});

describe("pairing notes", () => {
  it("says when a point added on one side makes a seam match by length", () => {
    const { entities } = openExample("tshirt");
    const e = deepFreeze(entities);
    const g = mainGarment(e)!;
    const seam = (g.seams ?? []).find(
      (s) =>
        s.pairing !== "length" &&
        s.a.length === 1 &&
        s.a[0]!.line === undefined,
    )!;
    const run = seam.a[0]!;
    const piece = g.pieces.find((p) => p.cuts.some((c) => c.id === run.cut))!;
    // The first edge the run walks.
    const k = piece.outline.findIndex((n) => n.id === run.from);
    const from =
      run.direction === "cw"
        ? (k + piece.outline.length - 1) % piece.outline.length
        : k;
    const pts = edgePoints(piece.outline, from);
    const mid = pts[Math.floor(pts.length / 2)]!;
    const cmd = insertNode(
      e,
      g.id,
      piece.id,
      piece.outline[from]!.id,
      [mid[0], mid[1]],
      NEW_ID,
    );
    expect(cmd.note).toMatch(/by length/);
  });
});
