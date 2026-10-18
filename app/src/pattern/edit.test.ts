// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@/format/schema.gen";
import { deepFreeze } from "@/document/json";
import {
  curvedEdge,
  edgeLength,
  edgePoints,
  endForLength,
  joinEdges,
  moveNodes,
  outlineProblem,
  splitEdge,
} from "./edit";
import { nodesPoints } from "./geometry";

const ID = "01a13cdb-cc05-7000-8000-0000000000aa";

/** A 200 x 100 mm rectangle, counter-clockwise from the bottom left. */
function rectangle(): OutlineNode[] {
  const corners: [number, number][] = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ];
  return deepFreeze(
    corners.map((position, k) => ({
      id: `01a13cdb-cc05-7000-8000-00000000000${k}`,
      type: "corner" as const,
      position,
      edge: { type: "polyline" as const, points: [] },
    })),
  );
}

describe("splitEdge and joinEdges", () => {
  it("adds a point on a straight edge and takes it out again", () => {
    const r = rectangle();
    const split = splitEdge(r, 0, [80.0004, 3], ID)!;
    expect(split).toHaveLength(5);
    expect(split[1]).toEqual({
      id: ID,
      type: "point",
      position: [80, 0],
      edge: { type: "polyline", points: [] },
    });
    expect(nodesPoints(split)).toEqual(
      [...nodesPoints(r)].toSpliced(1, 0, [80, 0]),
    );
    expect(joinEdges(split, 1)).toEqual(r);
  });

  it("splits a curve exactly, and refuses a point at an end", () => {
    const r = rectangle();
    const curved = r.map((n, k) =>
      k === 2 ? { ...n, edge: curvedEdge(r, 2) } : n,
    );
    const bent = curved.map((n, k) =>
      k === 2
        ? {
            ...n,
            edge: {
              type: "cubic" as const,
              controls: [
                [150, 160],
                [50, 160],
              ] as [number, number][],
            },
          }
        : n,
    ) as OutlineNode[];
    const split = splitEdge(bent, 2, [100, 200], ID)!;
    // The curve's top (t = 1/2) is at y = 100 + 0.75 * 60.
    expect(split[3]?.position).toEqual([100, 145]);
    expect(split[2]?.edge).toEqual({
      type: "cubic",
      controls: [
        [175, 130],
        [137.5, 145],
      ],
    });
    expect(edgeLength(split, 2) + edgeLength(split, 3)).toBeCloseTo(
      edgeLength(bent, 2),
      0,
    );
    expect(splitEdge(r, 0, [0.2, 0], ID)).toBeNull();
  });

  it("joins a polyline into the edge before, without the node", () => {
    const r = rectangle();
    const withPoints = r.map((n, k) =>
      k === 0
        ? { ...n, edge: { type: "polyline" as const, points: [[100, -10]] } }
        : n,
    ) as OutlineNode[];
    const joined = joinEdges(withPoints, 1);
    expect(joined[0]?.edge).toEqual({ type: "polyline", points: [[100, -10]] });
    expect(joined).toHaveLength(3);
  });
});

describe("moveNodes", () => {
  it("moves a node, its handles and a polyline's points by their share", () => {
    const r = rectangle();
    const shaped = r.map((n, k) =>
      k === 0
        ? {
            ...n,
            edge: {
              type: "polyline" as const,
              points: [
                [50, 0],
                [150, 0],
              ],
            },
          }
        : n,
    ) as OutlineNode[];
    const out = moveNodes(shaped, new Map([[r[1]!.id, [200, 40] as const]]));
    expect(out[1]?.position).toEqual([200, 40]);
    expect(out[0]?.edge).toEqual({
      type: "polyline",
      points: [
        [50, 10],
        [150, 30],
      ],
    });
    // Edges with neither end moved are the same objects.
    expect(out[2]).toBe(shaped[2]);
    expect(out[3]).toBe(shaped[3]);
  });

  it("puts a typed length's end node along the edge", () => {
    expect(endForLength(rectangle(), 0, 123.4567)).toEqual([123.457, 0]);
  });
});

describe("outlineProblem", () => {
  it("accepts a rectangle and refuses what Rust refuses", () => {
    const r = rectangle();
    expect(outlineProblem(r)).toBeNull();
    // Dragged across the opposite edge: a bow tie.
    expect(
      outlineProblem(moveNodes(r, new Map([[r[1]!.id, [200, 150] as const]]))),
    ).toMatch(/cross/);
    expect(outlineProblem([...r].reverse())).toMatch(/clockwise/);
    expect(
      outlineProblem(moveNodes(r, new Map([[r[1]!.id, [0, 0] as const]]))),
    ).toMatch(/same place/);
  });

  it("checks curves as flattened", () => {
    const r = rectangle();
    const loop = r.map((n, k) =>
      k === 0
        ? {
            ...n,
            edge: {
              type: "cubic" as const,
              controls: [
                [300, 200],
                [-100, 200],
              ] as [number, number][],
            },
          }
        : n,
    ) as OutlineNode[];
    expect(edgePoints(loop, 0).length).toBeGreaterThan(10);
    expect(outlineProblem(loop)).toMatch(/cross/);
  });
});
