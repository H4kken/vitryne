// SPDX-License-Identifier: AGPL-3.0-or-later
// The stack (FORMAT.md, The stack): new cuts go on top, a cut that goes on another is never
// before it. (Taking cuts out is covered by the random edit sessions in property.test.ts.)
import { describe, expect, it } from "vitest";
import type { Cut, Garment, Placement } from "@/format/schema.gen";
import { openExample, rustRefuses } from "@/test/rust";
import {
  applyCommand,
  findCut,
  followers,
  moveInStack,
  setOffset,
  stackAfterFollow,
  stackWith,
} from "./commands";
import { mainGarment } from "./entities";

const wrap: Placement = { type: "wrap", region: "torso", radius: 150, top: 0 };
const follow = (cut: string): Placement => ({ type: "follow", cut, lift: 12 });
const cut = (id: string, placement: Placement) => ({ id, placement }) as Cut;

/** A garment of one-cut pieces, `stack` as given. */
const garmentOf = (cuts: Record<string, Placement>, stack: string[]) =>
  ({
    id: "g",
    pieces: Object.entries(cuts).map(([id, placement]) => ({
      id: `piece-${id}`,
      cuts: [cut(id, placement)],
    })),
    stack,
    seams: [],
  }) as unknown as Garment;

describe("the stack", () => {
  it("puts new cuts on top, a cut that goes on another after it", () => {
    const g = garmentOf({ a: wrap }, ["a"]);
    // `pocket` was added before the `front` it goes on.
    expect(
      stackWith(g, [cut("pocket", follow("front")), cut("front", wrap)]),
    ).toEqual(["a", "front", "pocket"]);
  });

  it("moves a cut and the cuts on it above the cut it now goes on", () => {
    const g = garmentOf({ a: wrap, b: wrap, c: follow("b"), d: wrap }, [
      "a",
      "b",
      "c",
      "d",
    ]);
    // `b` (with `c` on it) goes on `d`: both move above it, in their order.
    expect(stackAfterFollow(g, "b", "d")).toEqual(["a", "d", "b", "c"]);
    // `d` going on `a`, which is already below it: nothing moves.
    expect(stackAfterFollow(g, "d", "a")).toBe(g.stack);
  });
});

describe("reordering and offsets on the hoodie", () => {
  const { entities, file } = openExample("hoodie");
  const g = mainGarment(entities)!;
  const cuts = g.pieces.flatMap((p) => p.cuts);
  const pocket = cuts.find((c) => c.placement.type === "follow")!;
  const front = cuts.find(
    (c) => pocket.placement.type === "follow" && c.id === pocket.placement.cut,
  )!;
  const garmentAfter = (
    cmd: ReturnType<typeof moveInStack>,
    base = entities,
  ) => {
    const e = applyCommand(base, cmd);
    expect(rustRefuses(file, e)).toBeNull();
    return mainGarment(e)!;
  };

  it("moves a cut with the cuts on it and keeps them above it", () => {
    const outside = g.stack.length - followers(g, front.id).size;
    for (const to of [0, outside]) {
      const after = garmentAfter(moveInStack(entities, g.id, front.id, to));
      expect(after.stack).toHaveLength(g.stack.length);
      expect(new Set(after.stack)).toEqual(new Set(g.stack));
      expect(after.stack.indexOf(pocket.id)).toBe(
        after.stack.indexOf(front.id) + 1,
      );
    }
  });

  it("keeps a cut placed on another above it", () => {
    expect(() => moveInStack(entities, g.id, pocket.id, 0)).toThrow(
      /stays above/,
    );
    expect(() => moveInStack(entities, g.id, front.id, -1)).toThrow(/no such/);
    expect(() => moveInStack(entities, g.id, front.id, 1.5)).toThrow(/no such/);
  });

  it("sets how far out a cut starts, and nothing at zero", () => {
    const wrapped = cuts.find((c) => c.placement.type === "wrap")!;
    const out = garmentAfter(setOffset(entities, g.id, wrapped.id, 5.04));
    expect(findCut(out, wrapped.id)!.cut.placement).toMatchObject({
      type: "wrap",
      offset: 5,
    });
    const e = applyCommand(entities, setOffset(entities, g.id, wrapped.id, 5));
    const zero = garmentAfter(setOffset(e, g.id, wrapped.id, 0), e);
    expect(findCut(zero, wrapped.id)!.cut.placement).not.toHaveProperty(
      "offset",
    );
    for (const bad of [-1, Number.NaN, Infinity])
      expect(() => setOffset(entities, g.id, wrapped.id, bad)).toThrow();
    // A cut on another: its lift.
    const lifted = garmentAfter(setOffset(entities, g.id, pocket.id, 20));
    expect(findCut(lifted, pocket.id)!.cut.placement).toMatchObject({
      type: "follow",
      lift: 20,
    });
  });
});
