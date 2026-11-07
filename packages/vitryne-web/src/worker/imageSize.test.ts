// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { imageSize } from "./imageSize";

describe("imageSize", () => {
  it("keeps the viewport's shape on a wide view", () => {
    expect(imageSize(1600, 800, 3200, 16384)).toEqual({
      width: 3200,
      height: 1600,
    });
  });

  it("puts the long side on the height of a tall view", () => {
    expect(imageSize(500, 1000, 1600, 16384)).toEqual({
      width: 800,
      height: 1600,
    });
  });

  it("never goes past what the GPU can draw", () => {
    const s = imageSize(1000, 500, 4096, 2048);
    expect(s).toEqual({ width: 2048, height: 1024 });
  });

  it("never gives an empty side, even for a very thin or empty view", () => {
    expect(imageSize(10000, 1, 1600, 16384).height).toBe(1);
    expect(imageSize(0, 0, 1600, 16384)).toEqual({ width: 1600, height: 1600 });
  });
});
