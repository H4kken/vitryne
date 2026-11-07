// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { exportOptions } from "./exportOptions";

describe("exportOptions", () => {
  it("shows the avatar switch for the 3D models, glTF as well as OBJ", () => {
    expect(exportOptions("glb").avatar).toBe("model");
    expect(exportOptions("obj").avatar).toBe("model");
  });

  it("gives a picture its own avatar switch", () => {
    expect(exportOptions("png")).toEqual({ avatar: "image" });
  });

  it("asks nothing for the project file", () => {
    expect(exportOptions("vtry")).toEqual({ avatar: null });
  });
});
