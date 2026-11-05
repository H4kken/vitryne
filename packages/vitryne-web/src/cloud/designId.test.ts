// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { designIdAt } from "./designId";

const id = "0b9e7c3a-4f1d-4c53-8a77-2f6d9e1b5a10";

describe("designIdAt", () => {
  it("reads a project address", () => {
    expect(designIdAt(`/design/${id}`, "/")).toBe(id);
    expect(designIdAt(`/design/${id}/`, "/")).toBe(id);
    expect(designIdAt(`/app/design/${id}`, "/app/")).toBe(id);
  });
  it("is undefined anywhere else", () => {
    expect(designIdAt("/", "/")).toBeUndefined();
    expect(designIdAt("/new", "/")).toBeUndefined();
    expect(designIdAt("/example/tshirt", "/")).toBeUndefined();
    expect(designIdAt("/design/not-an-id", "/")).toBeUndefined();
    expect(designIdAt(`/design/${id}/x`, "/")).toBeUndefined();
    expect(designIdAt(`/design/${id}`, "/app/")).toBeUndefined();
  });
});
