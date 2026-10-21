// SPDX-License-Identifier: AGPL-3.0-or-later
// The "drawn skirt" (M14): a blank project, two rectangles wrapped front and back and lowered
// to the waist (the placement's Height), the side seams sewn from Rust's suggestions, each step
// a command as the editor makes it.
// The result is the regression suite's `skirt` case (packages/vitryne-engine/tests/skirt.vtry, which
// `vitryne regress` drapes against packages/vitryne-engine/tests/skirt.json). The file must stay what these
// steps make; after an intended change, re-record it with
// `SKIRT_UPDATE=1 pnpm exec vitest run src/document/skirt.test.ts` and then
// `packages/vitryne-engine/target/release/vitryne regress --update --only skirt`.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Placement } from "@/format/schema.gen";
import { framed, newPiece, shapeOutline } from "@/pattern/draw";
import { rustRefuses, wasm } from "@/test/rust";
import {
  addPiece,
  addSeam,
  applyCommand,
  type Bounds,
  type Command,
  renameProject,
  revertCommand,
  type SeamDraft,
  setPlacement,
} from "./commands";
import { type Entities, mainGarment, parseEntities } from "./entities";
import { deepFreeze } from "./json";

const repo = resolve(import.meta.dirname, "../../../..");
const golden = resolve(repo, "packages/vitryne-engine/tests/skirt.vtry");

/** Each panel: 450 mm wide, 400 mm long (900 mm round: it rests on the hips, ~940 mm); drawn side by side in the flat view. */
const PANEL = { width: 450, height: 400 };
/** Where the panels' top edge starts, mm above the floor, just below the waist (body places start at the neck). */
const WAIST = 1000;

type File = ReturnType<typeof wasm.VtryFile.open>;

function build(): { file: File; e: Entities } {
  // Fixed time and seed: the same ids every run.
  let n = 0;
  const newId = () =>
    `01a13cdb-dd07-7000-8000-${String(++n).padStart(12, "0")}`;
  const glb = readFileSync(resolve(repo, "packages/vitryne-web/public/avatar/body.glb"));
  const file = wasm.VtryFile.new_empty(
    glb,
    1_792_000_000_000,
    new Uint8Array(16).fill(7),
  );
  let e = deepFreeze(parseEntities(file.entities()));
  const run = (cmd: Command) => {
    const after = applyCommand(e, cmd);
    expect(rustRefuses(file, after), cmd.label).toBeNull();
    expect(JSON.stringify(revertCommand(after, cmd))).toBe(JSON.stringify(e));
    e = after;
  };
  run(renameProject(e, "Drawn skirt"));
  const garment = mainGarment(e)!.id;
  for (const [name, place, x] of [
    ["Front", "body-front", 0],
    ["Back", "body-back", PANEL.width + 100],
  ] as const) {
    const f = framed(shapeOutline("rectangle", PANEL, newId));
    const piece = newPiece({
      id: newId(),
      name,
      outline: f.outline,
      cutIds: [newId()],
      origin: [x, 0],
    });
    const r = JSON.parse(
      file.place_piece(JSON.stringify(piece), JSON.stringify([place])),
    ) as { placements: Omit<Placement, "type">[]; bounds: Bounds | null };
    const cut = piece.cuts[0];
    run(
      addPiece(
        e,
        garment,
        {
          ...piece,
          cuts: [
            { ...cut, placement: { type: "wrap", ...r.placements[0] } },
          ] as typeof piece.cuts,
        },
        r.bounds ?? undefined,
      ),
    );
    // The properties' Height field.
    run(
      setPlacement(e, garment, cut.id, {
        type: "wrap",
        ...r.placements[0],
        top: WAIST,
      } as Placement),
    );
  }
  // Sew the first suggestion that is a side seam (one vertical edge of each piece), asking
  // again after each as the seam list does; a person skips the hem and waist pairs.
  const side = (r: SeamDraft["a"][number]) => {
    const nodes = mainGarment(e)!.pieces.flatMap((p) => p.outline);
    const x = (id: string) => nodes.find((n) => n.id === id)!.position[0];
    return x(r.from) === x(r.to);
  };
  for (;;) {
    const proposals = JSON.parse(file.suggest_seams()) as SeamDraft[];
    const pick = proposals.find(
      (p) =>
        p.a.length === 1 && p.b.length === 1 && side(p.a[0]!) && side(p.b[0]!),
    );
    if (!pick) break;
    run(addSeam(e, garment, pick, newId()));
  }
  return { file, e };
}

/** The folder form's files, by path. */
function folder(file: File): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of file.save_folder() as [string, Uint8Array][])
    out.set(path, bytes);
  return out;
}

function onDisk(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => {
    for (const x of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, x.name);
      if (x.isDirectory()) walk(p);
      else out.set(relative(dir, p), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return out;
}

describe("the drawn skirt", () => {
  it("is two rectangles sewn at the sides from suggestions", () => {
    const { file, e } = build();
    const g = mainGarment(e)!;
    expect(g.pieces.map((p) => p.name)).toEqual(["Front", "Back"]);
    expect(g.seams).toHaveLength(2);
    file.prepare().free();
    if (process.env.SKIRT_UPDATE) {
      rmSync(golden, { recursive: true, force: true });
      for (const [path, bytes] of folder(file)) {
        mkdirSync(dirname(join(golden, path)), { recursive: true });
        writeFileSync(join(golden, path), bytes);
      }
    }
    // packages/vitryne-engine/tests/skirt.vtry is exactly what these steps make.
    const want = folder(file);
    const have = onDisk(golden);
    expect([...have.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [path, bytes] of want)
      expect(
        Buffer.from(have.get(path)!).equals(Buffer.from(bytes)),
        path,
      ).toBe(true);
    file.free();
  });
});
