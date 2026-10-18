// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { outlineProblem } from "./edit";
import {
  counterClockwise,
  framed,
  outlineBox,
  type PenPoint,
  penEdge,
  penOutline,
  penProblem,
  reverseOutline,
  shapeOutline,
  shapeProblem,
  snapPoint,
  snapStep,
} from "./draw";

let n = 0;
const newId = () => `01a13cdb-cc05-7000-8000-${String(++n).padStart(12, "0")}`;

describe("the pen", () => {
  it("draws straight edges between clicks and curves from drags", () => {
    expect(penEdge({ at: [0, 0] }, { at: [90, 0] })).toEqual({
      type: "polyline",
      points: [],
    });
    // Leaving the dragged start along its handle, arriving at the plain end a third along.
    expect(penEdge({ at: [0, 0], out: [0, 30] }, { at: [90, 0] })).toEqual({
      type: "cubic",
      controls: [
        [0, 30],
        [60, 0],
      ],
    });
    // A dragged end: the curve arrives against its handle.
    expect(penEdge({ at: [0, 0] }, { at: [90, 0], out: [90, -30] })).toEqual({
      type: "cubic",
      controls: [
        [30, 0],
        [90, 30],
      ],
    });
  });

  it("makes a clockwise path counter-clockwise, keeping its shape", () => {
    // Clockwise: up, right, down, with a curve on the way back.
    const pts: PenPoint[] = [
      { at: [0, 0] },
      { at: [0, 100] },
      { at: [100, 100] },
      { at: [100, 0], out: [50, -40] },
    ];
    const outline = penOutline(pts, newId);
    expect(outlineProblem(outline)).toBeNull();
    expect(outline.map((x) => x.type)).toEqual([
      "corner",
      "point",
      "corner",
      "corner",
    ]);
    // Same box both ways round, and reversing twice is where it started.
    const cw = reverseOutline(outline);
    expect(outlineBox(cw)).toEqual(outlineBox(outline));
    expect(reverseOutline(cw)).toEqual(outline);
    expect(counterClockwise(cw)).toEqual(counterClockwise(reverseOutline(cw)));
  });

  it("makes the first point a corner when every point was dragged", () => {
    const pts: PenPoint[] = [
      { at: [0, 0], out: [20, -10] },
      { at: [100, 0], out: [110, 20] },
      { at: [50, 80], out: [30, 80] },
    ];
    const outline = penOutline(pts, newId);
    expect(outline.filter((x) => x.type === "corner")).toHaveLength(1);
    expect(outlineProblem(outline)).toBeNull();
  });

  it("says why a path can't be a piece", () => {
    expect(penProblem([{ at: [0, 0] }, { at: [10, 0] }])).toMatch(/three/);
    // A lopsided bow tie crosses itself.
    expect(
      penProblem([
        { at: [0, 0] },
        { at: [100, 100] },
        { at: [100, 0] },
        { at: [0, 60] },
      ]),
    ).toMatch(/cross/);
  });

  it("frames a piece at its box's bottom left", () => {
    const { outline, origin } = framed(
      penOutline(
        [{ at: [120, 40] }, { at: [220, 40] }, { at: [170, 140] }],
        newId,
      ),
    );
    expect(origin).toEqual([120, 40]);
    const b = outlineBox(outline);
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 100, 100]);
  });
});

describe("ready shapes", () => {
  it("are valid outlines of the sizes typed", () => {
    for (const [kind, size, box] of [
      ["rectangle", { width: 500, height: 700 }, [0, 0, 500, 700]],
      ["ellipse", { width: 300, height: 200 }, [0, 0, 300, 200]],
      ["tube", { width: 600, top: 400, height: 500 }, [0, 0, 600, 500]],
      ["tube", { width: 300, top: 500, height: 500 }, [0, 0, 500, 500]],
    ] as const) {
      const outline = shapeOutline(kind, size, newId);
      expect(outlineProblem(outline), kind).toBeNull();
      const b = outlineBox(outline);
      expect(
        [b.minX, b.minY, b.maxX, b.maxY].map((x) => Math.round(x)),
        kind,
      ).toEqual(box);
      expect(outline.every((x) => x.type === "corner")).toBe(true);
    }
    // The ellipse is four curves.
    expect(
      shapeOutline("ellipse", { width: 300, height: 300 }, newId).map(
        (x) => x.edge.type,
      ),
    ).toEqual(["cubic", "cubic", "cubic", "cubic"]);
  });

  it("refuses sizes that can't make a piece", () => {
    expect(shapeProblem("rectangle", { width: 0, height: 10 })).not.toBeNull();
    expect(shapeProblem("tube", { width: 10, height: 10 })).not.toBeNull();
    expect(shapeProblem("ellipse", { width: NaN, height: 10 })).not.toBeNull();
    expect(
      shapeProblem("rectangle", { width: 6000, height: 10 }),
    ).not.toBeNull();
    expect(shapeProblem("tube", { width: 10, top: 5, height: 10 })).toBeNull();
  });
});

describe("snapping", () => {
  const near = 5;
  it("snaps to the piece's own points, then the grid", () => {
    expect(snapPoint([102, 3], { step: 10, near, own: [[100, 0]] })).toEqual([
      100, 0,
    ]);
    expect(snapPoint([47, 53], { step: 10, near, own: [] })).toEqual([50, 50]);
    // In line with an own point on one axis.
    expect(snapPoint([152, 203], { step: 10, near, own: [[153, 0]] })).toEqual([
      153, 200,
    ]);
  });

  it("with a start point, in 15° steps and whole grid lengths", () => {
    const p = snapPoint([100, 4], { step: 10, near, own: [], from: [0, 0] });
    expect(p).toEqual([100, 0]);
    const q = snapPoint([71, 69], { step: 10, near, own: [], from: [0, 0] });
    expect(Math.hypot(q[0], q[1])).toBeCloseTo(100, 2);
    expect(Math.atan2(q[1], q[0])).toBeCloseTo(Math.PI / 4, 4);
  });

  it("picks a grid step a few pixels apart", () => {
    expect(snapStep(0.05)).toBe(1);
    expect(snapStep(0.5)).toBe(5);
    expect(snapStep(3)).toBe(50);
  });
});
