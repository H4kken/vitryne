// SPDX-License-Identifier: AGPL-3.0-or-later
// The stack (FORMAT.md, The stack): new cuts go on top, a cut that goes on another is never
// before it. (Taking cuts out is covered by the random edit sessions in property.test.ts.)
import { describe, expect, it } from "vitest";
import type { Cut, Garment, Placement } from "@/format/schema.gen";
import { stackAfterFollow, stackWith } from "./commands";

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
