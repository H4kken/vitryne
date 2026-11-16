// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type Example, startExample } from "./examples";

const ex = (file: string): Example => ({ file, title: file, sdfKey: file });

describe("startExample", () => {
  it("prefers the T-shirt, else the first, else nothing", () => {
    const list = [ex("examples/hoodie.vtry"), ex("examples/tshirt.vtry")];
    expect(startExample(list)).toBe(list[1]);
    expect(startExample([list[0]])).toBe(list[0]);
    expect(startExample([])).toBeUndefined();
  });
});
