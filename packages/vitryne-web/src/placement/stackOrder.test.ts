// SPDX-License-Identifier: AGPL-3.0-or-later
// What the Layers view asks of the stack: the rows (outermost first, cuts on another nested),
// and where a drop or a step puts a cut.
import { describe, expect, it } from "vitest";
import { stackAfterMove } from "@/document/commands";
import type { Cut, Garment, Placement } from "@/format/schema.gen";
import {
  dropPlace,
  moves,
  stackChildren,
  stackRoots,
  stepPlace,
} from "./stackOrder";

const wrap: Placement = { type: "wrap", region: "torso", radius: 150, top: 0 };
const on = (cut: string): Placement => ({ type: "follow", cut, lift: 12 });

/** One-cut pieces; the stack is given, nearest the body first. */
const garmentOf = (cuts: Record<string, Placement>, stack: string[]) =>
  ({
    id: "g",
    pieces: Object.entries(cuts).map(([id, placement]) => ({
      id: `piece-${id}`,
      cuts: [{ id, placement } as Cut],
    })),
    stack,
    seams: [],
  }) as unknown as Garment;

// a, b, c on the body (c outermost); p on b, q on p; d on the body above c.
const g = garmentOf(
  { a: wrap, b: wrap, p: on("b"), q: on("p"), c: wrap, d: wrap },
  ["a", "b", "p", "q", "c", "d"],
);

describe("the Layers view's stack", () => {
  it("lists the cuts on the body, and the cuts placed on another under it", () => {
    expect(stackRoots(g)).toEqual(["a", "b", "c", "d"]);
    expect(stackChildren(g, "b")).toEqual(["p"]);
    expect(stackChildren(g, "p")).toEqual(["q"]);
    expect(stackChildren(g, "a")).toEqual([]);
  });

  it("drops a cut just outside or just inside another", () => {
    // c outside a: the rest is a b p q d, a is at 0, so outside it is place 1.
    expect(dropPlace(g, "c", "a", true)).toBe(1);
    expect(stackAfterMove(g, "c", 1)).toEqual(["a", "c", "b", "p", "q", "d"]);
    // c inside a: place 0.
    expect(stackAfterMove(g, "c", dropPlace(g, "c", "a", false)!)).toEqual([
      "c",
      "a",
      "b",
      "p",
      "q",
      "d",
    ]);
    // Outside b means outside the cuts placed on b too.
    expect(stackAfterMove(g, "a", dropPlace(g, "a", "b", true)!)).toEqual([
      "b",
      "p",
      "q",
      "a",
      "c",
      "d",
    ]);
  });

  it("carries the cuts placed on a cut with it", () => {
    expect(stackAfterMove(g, "b", dropPlace(g, "b", "d", true)!)).toEqual([
      "a",
      "c",
      "d",
      "b",
      "p",
      "q",
    ]);
  });

  it("has no place on a cut's own block", () => {
    expect(dropPlace(g, "b", "p", true)).toBeNull();
    expect(dropPlace(g, "b", "b", false)).toBeNull();
  });

  it("steps one cut out or in, past the cuts on the neighbour", () => {
    // b one step out goes past c.
    expect(stackAfterMove(g, "b", stepPlace(g, "b", 1)!)).toEqual([
      "a",
      "c",
      "b",
      "p",
      "q",
      "d",
    ]);
    // a is innermost and d outermost: nowhere further.
    expect(stepPlace(g, "a", -1)).toBeNull();
    expect(stepPlace(g, "d", 1)).toBeNull();
  });

  it("says when a move changes nothing", () => {
    expect(moves(g, "c", stepPlace(g, "c", 1))).toBe(true);
    // Dropping d outside c, where it already is.
    expect(moves(g, "d", dropPlace(g, "d", "c", true))).toBe(false);
    expect(moves(g, "d", null)).toBe(false);
  });
});
