// SPDX-License-Identifier: AGPL-3.0-or-later
// Putting a project on another bundled body through the worker's Rust: the edit is one command
// Rust accepts, it undoes, and nothing else about the garment changes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openExample, rustRefuses, wasm } from "@/test/rust";
import { applyCommand, revertCommand, swapAvatar } from "./commands";
import { mainGarment, parseEntities } from "./entities";

const repo = resolve(import.meta.dirname, "../../../..");

function body(slug: string) {
  const dir = resolve(repo, "assets/bodies", slug);
  const glb = new Uint8Array(readFileSync(resolve(dir, "body.glb")));
  return { avatar: readFileSync(resolve(dir, "avatar.json"), "utf8"), glb };
}

describe("swapping the avatar", () => {
  for (const name of ["tshirt", "trousers"]) {
    it(`${name}: one command, accepted by Rust, undone exactly`, () => {
      const { file, entities } = openExample(name);
      const b = body("male-full");
      const r = JSON.parse(file.swap_avatar(b.avatar, b.glb)) as {
        entities: string;
        notes: string[];
      };
      const next = parseEntities(r.entities);
      const cmd = swapAvatar(entities, next, r.notes);
      expect(cmd.drape).toBe(true);
      expect(cmd.label).toBe("Change avatar to Male, fuller");

      const after = applyCommand(entities, cmd);
      expect(rustRefuses(file, after)).toBeNull();
      expect(after.avatars).toHaveLength(1);
      expect(after.project?.avatar).toBe(after.avatars[0]?.id);
      expect(after.avatars[0]?.id).not.toBe(entities.avatars[0]?.id);
      // The same pieces: only where they sit changed.
      const [was, now] = [mainGarment(entities), mainGarment(after)];
      expect(now?.pieces.map((p) => p.outline)).toEqual(
        was?.pieces.map((p) => p.outline),
      );
      expect(now?.seams).toEqual(was?.seams);

      const back = revertCommand(after, cmd);
      expect(back).toEqual(entities);
      expect(rustRefuses(file, back)).toBeNull();
      // The worker keeps both meshes, so the undo can be sent and the edit sent again.
      expect(rustRefuses(file, after)).toBeNull();
    });
  }

  it("refuses a body that is not an avatar", () => {
    const { file } = openExample("tshirt");
    expect(() => file.swap_avatar("{}", new Uint8Array())).toThrow();
    expect(typeof wasm.VtryFile).toBe("function");
  });
});
