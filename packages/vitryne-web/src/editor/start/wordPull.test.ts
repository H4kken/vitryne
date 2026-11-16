// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "vitest";
import { wordPull } from "./wordPull";

test("a word leans toward the pointer, by at most max", () => {
  const far = wordPull(-600, 0, 20);
  expect(far.x).toBeCloseTo(-20); // pointer to the left: the word moves left
  expect(far.y).toBeCloseTo(0);
  const down = wordPull(0, 900, 20);
  expect(down.y).toBeCloseTo(20);
});

test("it moves less when the pointer is near, and not at all on top of it", () => {
  expect(Math.hypot(...Object.values(wordPull(30, 40, 20)))).toBeCloseTo(
    (20 * 50) / 300,
  );
  expect(wordPull(0, 0, 20)).toEqual({ x: 0, y: 0 });
});
