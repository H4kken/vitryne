// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Cut } from "@/format/schema.gen";
import { newPiece, shapeOutline } from "@/pattern/draw";
import { clonePiece } from "./clonePiece";

describe("clonePiece", () => {
  it("gives every id anew and keeps the shape", () => {
    let n = 0;
    const id = () => `id-${n++}`;
    const piece = newPiece({
      id: "p",
      name: "Panel",
      outline: shapeOutline("rectangle", { width: 100, height: 200 }, id),
      cutIds: ["c1", "c2"],
      origin: [0, 0],
    });
    const copy = clonePiece(
      piece,
      { ...(piece.cuts[1] as Cut), fabric: "f" },
      {
        id,
        name: "Panel copy",
      },
    );
    expect(copy.name).toBe("Panel copy");
    expect(copy.cuts).toHaveLength(1);
    expect(copy.cuts[0].fabric).toBe("f");
    expect(copy.cuts[0].mirrored).toBeUndefined();
    const old = new Set([piece.id, ...piece.outline.map((x) => x.id)]);
    for (const x of [copy.id, ...copy.outline.map((x) => x.id)])
      expect(old.has(x)).toBe(false);
    expect(copy.outline.map((x) => x.position)).toEqual(
      piece.outline.map((x) => x.position),
    );
  });
});
