// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type BodyOption, groupBodies } from "./bodies";

const body = (slug: string): BodyOption => ({
  slug,
  id: slug,
  name: slug,
  height: 1700,
  chest: 900,
  waist: 700,
  hips: 900,
});

describe("groupBodies", () => {
  it("puts the first avatar apart and orders each sex slim to fuller", () => {
    const slugs = [
      "female-full",
      "default",
      "male-slim",
      "female-slim",
      "male-full",
      "female-average",
      "male-average",
    ];
    const { original, groups } = groupBodies(slugs.map(body));
    expect(original?.slug).toBe("default");
    expect(groups.map((g) => g.label)).toEqual(["Female", "Male"]);
    expect(groups[0]?.items.map((i) => [i.body.slug, i.label])).toEqual([
      ["female-slim", "Slim"],
      ["female-average", "Average"],
      ["female-full", "Fuller"],
    ]);
    expect(groups[1]?.items.map((i) => i.body.slug)).toEqual([
      "male-slim",
      "male-average",
      "male-full",
    ]);
  });

  it("keeps a body it does not know under Other", () => {
    const { groups } = groupBodies([body("default"), body("tall-one")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Other");
    expect(groups[0]?.items[0]?.label).toBe("tall-one");
  });
});
