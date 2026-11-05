// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { newPiece, shapeOutline } from "@/pattern/draw";
import { oppositePlace } from "@/placement/places";
import { mirrorCut } from "./mirrorCut";

const WRAP = {
  type: "wrap",
  region: "arm-left",
  angle: 0,
  radius: 1,
  top: 0,
} as const;

function piece() {
  let n = 0;
  return newPiece({
    id: "p",
    name: "Sleeve",
    outline: shapeOutline(
      "rectangle",
      { width: 100, height: 200 },
      () => `n${n++}`,
    ),
    cutIds: ["c1"],
    origin: [10, 20],
  });
}

describe("mirrorCut", () => {
  it("makes the mirror image beside the cut, with its fabric and look", () => {
    const p = piece();
    const src = { ...p.cuts[0]!, fabric: "f", appearance: "a" };
    const c = mirrorCut(p, src, { id: "c2", placement: WRAP });
    expect(c).toMatchObject({
      id: "c2",
      mirrored: true,
      fabric: "f",
      appearance: "a",
    });
    expect(c.layout!.position![0]).toBeGreaterThan(10 + 100);
    expect(c.layout!.position![1]).toBe(20);
  });

  it("mirrors a mirrored cut back to a plain one", () => {
    const p = piece();
    const c = mirrorCut(
      p,
      { ...p.cuts[0]!, mirrored: true },
      { id: "c2", placement: WRAP },
    );
    expect(c.mirrored).toBeUndefined();
  });

  it("waits unplaced when asked", () => {
    const p = piece();
    const c = mirrorCut(p, p.cuts[0]!, {
      id: "c2",
      placement: WRAP,
      state: "unplaced",
    });
    expect(c.state).toBe("unplaced");
  });
});

describe("oppositePlace", () => {
  it("is the other side of the body, or none", () => {
    expect(oppositePlace("arm-right")).toBe("arm-left");
    expect(oppositePlace("leg-left-back")).toBe("leg-right-back");
    expect(oppositePlace("body-left")).toBe("body-right");
    expect(oppositePlace("body-front")).toBeNull();
    expect(oppositePlace("over-head")).toBeNull();
  });
});
