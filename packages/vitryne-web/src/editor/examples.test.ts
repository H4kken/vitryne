// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type Example, startExample } from "./examples";

const ex = (file: string): Example => ({ file, title: file, sdfKey: file });

describe("startExample", () => {
  it("prefers the T-shirt, else the first, else nothing", () => {
    const hoodie = ex("examples/hoodie.vtry");
    const tshirt = ex("examples/tshirt.vtry");
    expect(startExample([hoodie, tshirt])).toBe(tshirt);
    expect(startExample([hoodie])).toBe(hoodie);
    expect(startExample([])).toBeUndefined();
  });
});
