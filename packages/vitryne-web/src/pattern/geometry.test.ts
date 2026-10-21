// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { edgeInterior, flattenCubic, layoutCuts, touchesBox } from "./geometry";

describe("flattenCubic", () => {
  it("leaves a straight curve with nothing between its ends", () => {
    expect(flattenCubic([0, 0], [100, 0], [200, 0], [300, 0])).toEqual([]);
  });

  // The same quarter circle as Rust's `a_curve_stays_within_tolerance`: same count, same grid.
  it("follows a quarter circle within the tolerance, on the 0.001 mm grid", () => {
    const r = 200;
    const k = 0.5522847498 * r;
    const pts = flattenCubic([r, 0], [r, k], [k, r], [0, r]);
    expect(pts.length).toBe(
      Math.ceil(
        Math.sqrt((0.75 * Math.hypot(r - 2 * r + k, -2 * k + r)) / 0.1),
      ) - 1,
    );
    for (const [x, y] of pts) {
      expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThan(0.16);
      expect(Math.round(x * 1000) / 1000).toBe(x);
      expect(Math.round(y * 1000) / 1000).toBe(y);
    }
  });

  it("stays bounded for degenerate input", () => {
    expect(flattenCubic([0, 0], [0, 0], [0, 0], [0, 0])).toEqual([]);
    expect(flattenCubic([0, 0], [1e9, 1e9], [-1e9, 1e9], [1, 0])).toHaveLength(
      255,
    );
    expect(flattenCubic([0, 0], [NaN, 0], [1, 1], [2, 0])).toEqual([]);
  });
});

describe("edgeInterior", () => {
  it("gives a polyline's own points and flattens a cubic", () => {
    const pts: [number, number][] = [[1, 2]];
    expect(
      edgeInterior({ type: "polyline", points: pts }, [0, 0], [3, 3]),
    ).toBe(pts);
    const curve = edgeInterior(
      {
        type: "cubic",
        controls: [
          [0, 100],
          [100, 100],
        ],
      },
      [0, 0],
      [100, 0],
    );
    expect(curve.length).toBeGreaterThan(4);
    expect(edgeInterior(undefined, [0, 0], [1, 1])).toEqual([]);
  });
});

describe("layoutCuts", () => {
  it("frames a metre around the origin when there is nothing yet", () => {
    for (const g of [undefined, { pieces: [] }] as const) {
      const { cuts, box } = layoutCuts(g as Parameters<typeof layoutCuts>[0]);
      expect(cuts).toEqual([]);
      expect(box).toEqual({ minX: -500, minY: -500, maxX: 500, maxY: 500 });
    }
  });
});

describe("touchesBox", () => {
  const square = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as const;
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
    minX,
    minY,
    maxX,
    maxY,
  });

  it("is true for a box over a corner, inside the outline, or round it", () => {
    expect(touchesBox(square, box(90, 90, 200, 200))).toBe(true);
    expect(touchesBox(square, box(40, 40, 60, 60))).toBe(true);
    expect(touchesBox(square, box(-10, -10, 110, 110))).toBe(true);
  });

  it("is true for a thin box across the outline, holding no corner of it", () => {
    expect(touchesBox(square, box(-10, 45, 110, 55))).toBe(true);
  });

  it("is false for a box apart, or in a notch of the outline's box only", () => {
    expect(touchesBox(square, box(120, 0, 200, 100))).toBe(false);
    const ell = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 100],
      [0, 100],
    ] as const;
    expect(touchesBox(ell, box(50, 50, 90, 90))).toBe(false);
  });
});
