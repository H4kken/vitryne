// SPDX-License-Identifier: AGPL-3.0-or-later
// Drawing new pieces (M14 phase 4) through the worker's Rust, built for Node: a piece drawn or
// picked from the ready shapes is placed by Rust (`place_piece`), added as one command Rust
// accepts, and reverted to the identical document.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Piece, Placement } from "@/format/schema.gen";
import { framed, newPiece, penOutline, shapeOutline } from "@/pattern/draw";
import { PAIRS } from "@/placement/places";
import { openExample, rustRefuses, wasm } from "@/test/rust";
import {
  addPiece,
  applyCommand,
  type Bounds,
  CommandError,
  revertCommand,
} from "./commands";
import { type Entities, mainGarment, parseEntities } from "./entities";
import { deepFreeze } from "./json";

const repo = resolve(import.meta.dirname, "../../..");
const seed = new Uint8Array(16).fill(9);
let n = 0;
const newId = () => `01a13cdb-dd06-7000-8000-${String(++n).padStart(12, "0")}`;

type File = ReturnType<typeof wasm.VtryFile.open>;

/** A piece as the editor adds it: framed, placed by Rust at `places`. */
function placed(
  file: File,
  outline: Piece["outline"] | ReturnType<typeof shapeOutline>,
  places: string[],
  name = "Panel",
): { piece: Piece; bounds?: Bounds } {
  const f = framed(outline);
  const piece = newPiece({
    id: newId(),
    name,
    outline: f.outline,
    cutIds: places.map(newId),
    origin: f.origin,
  });
  const r = JSON.parse(
    file.place_piece(JSON.stringify(piece), JSON.stringify(places)),
  ) as { placements: Omit<Placement, "type">[]; bounds: Bounds | null };
  return {
    piece: {
      ...piece,
      cuts: piece.cuts.map((c, k) => ({
        ...c,
        placement: { type: "wrap", ...r.placements[k] } as Placement,
      })) as Piece["cuts"],
    },
    bounds: r.bounds ?? undefined,
  };
}

function add(file: File, e: Entities, p: { piece: Piece; bounds?: Bounds }) {
  const g = mainGarment(e)!;
  const cmd = addPiece(e, g.id, p.piece, p.bounds);
  const after = applyCommand(e, cmd);
  expect(rustRefuses(file, after), cmd.label).toBeNull();
  expect(JSON.stringify(revertCommand(after, cmd))).toBe(JSON.stringify(e));
  return after;
}

describe("drawing pieces", () => {
  it("meshes two rectangles drawn on a blank project, with side seams suggested", () => {
    const glb = readFileSync(resolve(repo, "app/public/avatar/body.glb"));
    const file = wasm.VtryFile.new_empty(glb, Date.now(), seed);
    let e = deepFreeze(parseEntities(file.entities()));
    const skirt = (x: number) =>
      penOutline(
        [
          { at: [x, 0] },
          { at: [x + 520, 0] },
          { at: [x + 420, 600] },
          { at: [x + 100, 600] },
        ],
        newId,
      );
    e = add(file, e, placed(file, skirt(0), ["body-front"], "Front"));
    e = add(file, e, placed(file, skirt(700), ["body-back"], "Back"));
    // The two pieces where they were drawn in the flat view, one cut each.
    const g = mainGarment(e)!;
    expect(g.pieces.map((p) => p.cuts[0].layout?.position)).toEqual([
      [0, 0],
      [700, 0],
    ]);
    expect(file.set_entities(JSON.stringify(e))).toBeDefined();
    const scene = file.prepare();
    scene.free();
    // Sewing suggestions come from the drawn geometry: the two side seams among them.
    type Run = { cut: string };
    const proposals = JSON.parse(file.suggest_seams()) as {
      a: Run[];
      b: Run[];
    }[];
    const across = proposals.filter((p) => p.a[0]!.cut !== p.b[0]!.cut);
    expect(across.length).toBeGreaterThanOrEqual(2);
    file.free();
  });

  it("adds each ready shape, once or as a pair, to an example", () => {
    const { file, entities } = openExample("trousers");
    const e = deepFreeze(entities);
    for (const kind of ["rectangle", "ellipse", "tube"] as const) {
      const outline = shapeOutline(
        kind,
        { width: 300, top: 200, height: 400 },
        newId,
      );
      add(file, e, placed(file, outline, ["body-front"]));
      const pair = placed(file, outline, [...PAIRS["legs-front"].places]);
      expect(pair.piece.cuts.map((c) => c.mirrored ?? false)).toEqual([
        false,
        true,
      ]);
      // The mirrored copy sits to the right of the first in the flat view.
      const [a, b] = pair.piece.cuts.map((c) => c.layout!.position![0]);
      expect(b!).toBeGreaterThan(a! + 300);
      add(file, e, pair);
    }
    file.free();
  });

  it("refuses a piece that crosses itself or reuses an id", () => {
    const { file, entities } = openExample("tshirt");
    const e = deepFreeze(entities);
    const g = mainGarment(e)!;
    const ok = placed(
      file,
      shapeOutline("rectangle", { width: 200, height: 200 }, newId),
      ["body-front"],
    );
    const crossed = {
      ...ok.piece,
      outline: [
        ok.piece.outline[0],
        ok.piece.outline[2],
        ok.piece.outline[1],
        ok.piece.outline[3],
      ] as Piece["outline"],
    };
    expect(() => addPiece(e, g.id, crossed)).toThrow(CommandError);
    const reused = { ...ok.piece, id: g.pieces[0]!.id };
    expect(() => addPiece(e, g.id, reused)).toThrow(/id/);
    file.free();
  });
});
