// SPDX-License-Identifier: AGPL-3.0-or-later
// Lines, notches, folds and the grain line through the worker's Rust: each command
// applies, Rust accepts the result, and reverting gives the identical document; what Rust would
// refuse (a fold outside the piece, a line leaving it) never becomes a command.
import { describe, expect, it } from "vitest";
import type { Piece, Placement } from "@/format/schema.gen";
import { framed, newPiece, penLine, penOutline } from "@/pattern/draw";
import { openExample, rustRefuses } from "@/test/rust";
import {
  addFold,
  addLine,
  addPiece,
  addSeam,
  applyCommand,
  type Command,
  CommandError,
  insertNode,
  moveNodes,
  removeLine,
  revertCommand,
  setGrain,
} from "./commands";
import { type Entities, mainGarment } from "./entities";
import { deepFreeze } from "./json";

let n = 0;
const newId = () => `01a13cdb-ee06-7000-8000-${String(++n).padStart(12, "0")}`;

// An L: the corner at (100, 100) points into the piece.
const L: [number, number][] = [
  [0, 0],
  [200, 0],
  [200, 100],
  [100, 100],
  [100, 200],
  [0, 200],
];

describe("lines, notches, folds and grain", () => {
  const { file, entities } = openExample("trousers");
  const f = framed(
    penOutline(
      L.map((at) => ({ at })),
      newId,
    ),
  );
  const piece = newPiece({
    id: newId(),
    name: "L",
    outline: f.outline,
    cutIds: [newId()],
    origin: f.origin,
  });
  piece.cuts[0].placement = {
    type: "wrap",
    region: "body-front",
    angle: 0,
    radius: 200,
    top: 1200,
  } as Placement;
  const g0 = mainGarment(entities)!;
  const base = deepFreeze(
    applyCommand(entities, addPiece(entities, g0.id, piece)),
  );
  const gid = g0.id;
  const node = (x: number, y: number) =>
    (mainGarment(base)!.pieces.at(-1) as Piece).outline.find(
      (m) => m.position[0] === x && m.position[1] === y,
    )!.id;

  const run = (e: Entities, build: (e: Entities) => Command) => {
    const cmd = build(e);
    const after = applyCommand(e, cmd);
    expect(rustRefuses(file, after), cmd.label).toBeNull();
    expect(JSON.stringify(revertCommand(after, cmd))).toBe(JSON.stringify(e));
    return after;
  };

  it("adds each kind of mark, accepted by Rust and reverted exactly", () => {
    expect(rustRefuses(file, base)).toBeNull();
    const line = penLine(
      [{ at: [20, 20] }, { at: [50, 150], out: [60, 160] }, { at: [80, 180] }],
      newId,
    );
    let e = run(base, (x) => addLine(x, gid, piece.id, line));
    e = run(e, (x) =>
      insertNode(x, gid, piece.id, node(0, 0), [100, 0], newId(), "notch"),
    );
    const notched = mainGarment(e)!.pieces.at(-1)!.outline[1]!;
    expect([notched.type, notched.position]).toEqual(["notch", [100, 0]]);
    e = run(e, (x) =>
      addFold(x, gid, piece.id, {
        id: newId(),
        from: node(0, 0),
        to: node(100, 100),
      }),
    );
    run(e, (x) =>
      setGrain(x, gid, piece.id, { from: [50, 20], to: [50, 180] }),
    );
  });

  it("refuses folds and lines outside the piece, and moves that push a fold out", () => {
    const refused = (build: () => unknown, says: string) =>
      expect(build).toThrow(new RegExp(says));
    for (const [a, b] of [
      [node(200, 0), node(0, 200)],
      [node(200, 100), node(100, 200)],
      [node(0, 0), node(200, 0)],
    ] as const)
      refused(
        () => addFold(base, gid, piece.id, { id: newId(), from: a, to: b }),
        "inside the piece",
      );
    refused(
      () =>
        addLine(
          base,
          gid,
          piece.id,
          penLine([{ at: [20, 20] }, { at: [150, 150] }], newId),
        ),
      "stay inside",
    );
    refused(
      () => setGrain(base, gid, piece.id, { from: [5, 5], to: [5, 5.5] }),
      "too short",
    );
    const folded = applyCommand(
      base,
      addFold(base, gid, piece.id, {
        id: newId(),
        from: node(0, 0),
        to: node(100, 100),
      }),
    );
    // The inner corner pulled out past the fold's line: the fold would leave the piece.
    expect(() =>
      moveNodes(folded, gid, piece.id, { [node(100, 200)]: [-50, 200] }),
    ).toThrow(CommandError);
  });

  it("removes the seams sewn on a line with it", () => {
    const line = penLine([{ at: [20, 20] }, { at: [20, 150] }], newId);
    const e = applyCommand(base, addLine(base, gid, piece.id, line));
    const cut = piece.cuts[0].id;
    const sewn = applyCommand(
      e,
      addSeam(
        e,
        gid,
        {
          a: [
            {
              cut,
              line: line.id,
              from: line.nodes[0].id,
              to: line.nodes[1].id,
            },
          ],
          b: [
            {
              cut,
              from: node(0, 0),
              to: node(0, 200),
              direction: "cw",
            },
          ],
        },
        newId(),
      ),
    );
    const cmd = removeLine(sewn, gid, piece.id, line.id);
    expect(cmd.note).toMatch(/removed/);
    const after = applyCommand(sewn, cmd);
    expect(mainGarment(after)!.seams?.length).toBe(
      mainGarment(e)!.seams?.length ?? 0,
    );
    expect(rustRefuses(file, after)).toBeNull();
  });
});
