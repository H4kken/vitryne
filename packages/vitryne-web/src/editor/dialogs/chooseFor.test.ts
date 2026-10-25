// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { chooseFor } from "./chooseFor";

describe("chooseFor", () => {
  it("sets the choice", () => {
    expect(chooseFor({ a: "one:body-front" }, "b", "on:a")).toEqual({
      a: "one:body-front",
      b: "on:a",
    });
  });

  it("drops the pieces on a piece left out, and those on them", () => {
    const c = { a: "one:body-front", b: "on:a", c: "on:b", d: "flat" };
    expect(chooseFor(c, "a", "leave")).toEqual({ a: "leave", d: "flat" });
  });
});
