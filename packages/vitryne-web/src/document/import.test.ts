// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing a pattern through the worker's Rust, built for Node: the FreeSewing T-shirt's
// bare DXF and a small Valentina pattern become projects with no file edited by hand, and
// pieces added to an open project are an edit Rust accepts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Choice, type Preview } from "@/editor/dialogs/ImportDialog";
import { placeOf } from "@/placement/places";
import { openExample, rustRefuses, wasm } from "@/test/rust";
import {
  type Addition,
  addPieces,
  applyCommand,
  findCut,
  revertCommand,
  setPlacement,
} from "./commands";
import { mainGarment, parseEntities } from "./entities";
import { decodeChoice } from "@/editor/dialogs/decodeChoice";
import { encodeChoice } from "@/editor/dialogs/encodeChoice";
import { leftOut } from "@/editor/dialogs/leftOut";
import { importSource } from "@/editor/dialogs/importSource";

const repo = resolve(import.meta.dirname, "../../../..");
const tshirtDxf = readFileSync(
  resolve(repo, "assets/garments/tshirt/tshirt.dxf"),
  "utf8",
);
const hoodieDxf = readFileSync(
  resolve(repo, "assets/garments/hoodie/hoodie.dxf"),
  "utf8",
);
const hoodieToml = readFileSync(
  resolve(repo, "assets/garments/hoodie/garment.toml"),
  "utf8",
);
const tshirt = importSource(
  { name: "tshirt.dxf", text: tshirtDxf },
  null,
  null,
);
const hoodie = importSource(
  { name: "hoodie.dxf", text: hoodieDxf },
  { name: "garment.toml", text: hoodieToml },
  null,
);
/** A skirt panel in Valentina's format, drafted from hip_circ in its measurements file. */
const skirtVal = `<?xml version="1.0" encoding="UTF-8"?>
<pattern><version>0.9.2</version><unit>cm</unit>
<measurements path="C:/Users/someone/skirt.vit"/>
<draw name="Skirt"><calculation>
  <point type="single" id="1" name="A" x="0" y="0"/>
  <point type="endLine" id="2" name="B" basePoint="1" angle="0" length="hip_circ/4"/>
  <point type="endLine" id="3" name="C" basePoint="1" angle="270" length="60"/>
  <point type="endLine" id="4" name="D" basePoint="2" angle="270" length="60"/>
  <spline type="simpleInteractive" id="5" point1="1" point4="2" angle1="350" angle2="190" length1="5" length2="5"/>
</calculation><modeling/><details>
  <detail id="10" name="Skirt front" version="2"><nodes>
    <node type="NodeSpline" idObject="5"/>
    <node type="NodePoint" idObject="4"/>
    <node type="NodePoint" idObject="3"/>
  </nodes></detail>
</details></draw></pattern>`;
const skirtVit = `<?xml version="1.0" encoding="UTF-8"?>
<vit><version>0.6.2</version><read-only>false</read-only><unit>cm</unit><pm_system></pm_system>
<personal/><body-measurements><m name="hip_circ" value="100"/></body-measurements></vit>`;
/** The same skirt as Seamly2D writes it: its own names, and a .smis for the measurements. */
const skirtSm2d = skirtVal
  .replace("0.9.2", "0.6.8")
  .replace("skirt.vit", "skirt.smis")
  .replace('<draw name="Skirt">', '<draftBlock name="Skirt">')
  .replace("</draw>", "</draftBlock>")
  .replace("<details>", "<pieces>")
  .replace("</details>", "</pieces>")
  .replace("<detail ", "<piece ")
  .replace("</detail>", "</piece>");
const skirtSmis = skirtVit.replace(/vit>/g, "smis>").replace("0.6.2", "0.3.4");
const avatar = () => {
  const { file, entities } = openExample("tshirt");
  file.free();
  return entities;
};
const seed = new Uint8Array(16).fill(7);

function suggested(p: Preview): Record<string, Choice> {
  return Object.fromEntries(
    p.pieces.map((x) => [x.name, x.suggestion ?? { type: "leave" }]),
  );
}

describe("import", () => {
  it("asks for a Valentina pattern's measurements, then makes a project", () => {
    expect(JSON.parse(wasm.VtryFile.pattern_needs(skirtVal))).toEqual({
      measurements: "skirt.vit",
    });
    const bare = importSource(
      { name: "skirt.val", text: skirtVal },
      null,
      null,
    );
    expect(() => wasm.VtryFile.inspect_import(bare)).toThrow(/skirt\.vit/);
    const source = importSource(
      { name: "skirt.val", text: skirtVal },
      { name: "mine.vit", text: skirtVit },
      null,
    );
    const p = JSON.parse(wasm.VtryFile.inspect_import(source)) as Preview;
    expect(p.pieces.map((x) => x.name)).toEqual(["Skirt front"]);
    expect(p.sizes).toEqual([]);
    expect(Math.max(...p.pieces[0]!.outline.map((q) => q[0]))).toBe(250);
    const glb = readFileSync(
      resolve(repo, "packages/vitryne-web/public/avatar/body.glb"),
    );
    const f = wasm.VtryFile.import_new(
      source,
      JSON.stringify(suggested(p)),
      glb,
      Date.now(),
      seed,
    );
    const g = mainGarment(parseEntities(f.entities()))!;
    expect(g.sources![0]!.type).toBe("valentina");
    expect(g.pieces[0]!.outline.some((n) => n.edge?.type === "cubic")).toBe(
      true,
    );
    f.free();
  });

  it("reads a Seamly2D pattern with its .smis the same way", () => {
    expect(JSON.parse(wasm.VtryFile.pattern_needs(skirtSm2d))).toEqual({
      measurements: "skirt.smis",
    });
    const source = importSource(
      { name: "skirt.sm2d", text: skirtSm2d },
      { name: "mine.smis", text: skirtSmis },
      null,
    );
    const p = JSON.parse(wasm.VtryFile.inspect_import(source)) as Preview;
    expect(p.pieces.map((x) => x.name)).toEqual(["Skirt front"]);
    expect(Math.max(...p.pieces[0]!.outline.map((q) => q[0]))).toBe(250);
    const glb = readFileSync(
      resolve(repo, "packages/vitryne-web/public/avatar/body.glb"),
    );
    const f = wasm.VtryFile.import_new(
      source,
      JSON.stringify(suggested(p)),
      glb,
      Date.now(),
      seed,
    );
    const g = mainGarment(parseEntities(f.entities()))!;
    expect(g.sources![0]!.type).toBe("seamly2d");
    f.free();
  });

  it("turns the bare T-shirt DXF into a placed project", () => {
    const p = JSON.parse(wasm.VtryFile.inspect_import(tshirt)) as Preview;
    expect(p.pieces.map((x) => x.name)).toEqual(["front", "back", "sleeve"]);
    expect(p.sewing).toBeNull();
    for (const x of p.pieces)
      expect(decodeChoice(encodeChoice(x.suggestion!))).toEqual(x.suggestion);
    // The body mesh, as the app fetches it (avatar/body.glb), is the examples' avatar part.
    const glb = readFileSync(
      resolve(repo, "packages/vitryne-web/public/avatar/body.glb"),
    );
    const f = wasm.VtryFile.import_new(
      tshirt,
      JSON.stringify(suggested(p)),
      glb,
      Date.now(),
      seed,
    );
    const e = parseEntities(f.entities());
    const g = mainGarment(e)!;
    const places = g.pieces.flatMap((x) =>
      x.cuts.map((c) => placeOf(c.placement)),
    );
    expect(places).toEqual([
      "body-front",
      "body-back",
      "arm-right",
      "arm-left",
    ]);
    expect(g.seams ?? []).toEqual([]);
    // It saves and opens again unchanged; the worker can drape it.
    const again = wasm.VtryFile.open(f.save());
    expect(again.entities()).toBe(f.entities());
    const scene = f.prepare();
    expect(JSON.parse(scene.info()).cuts).toHaveLength(4);
    // A cut moved to the back: an edit Rust accepts.
    const sleeve = g.pieces[2]!.cuts[0]!;
    const r = JSON.parse(f.rewrap(sleeve.id, "body-back")) as {
      placement: object;
      bounds: unknown;
    };
    expect(r.bounds).toBeNull();
    const moved = applyCommand(
      e,
      setPlacement(e, g.id, sleeve.id, { type: "wrap", ...r.placement }),
    );
    expect(
      placeOf(findCut(mainGarment(moved)!, sleeve.id)!.cut.placement),
    ).toBe("body-back");
    expect(rustRefuses(f, moved)).toBeNull();
    scene.free();
    for (const x of [f, again]) x.free();
    expect(avatar().avatars).toHaveLength(1);
  });

  it("suggests seams for a bare import and refuses anything but whole edges", () => {
    const p = JSON.parse(wasm.VtryFile.inspect_import(tshirt)) as Preview;
    const glb = readFileSync(
      resolve(repo, "packages/vitryne-web/public/avatar/body.glb"),
    );
    const f = wasm.VtryFile.import_new(
      tshirt,
      JSON.stringify(suggested(p)),
      glb,
      Date.now(),
      seed,
    );
    type Edge = {
      cut: string;
      from: string;
      to: string;
      length: number;
      sewn: boolean;
    };
    type Run = { cut: string; from: string; to: string; direction: string };
    type Proposal = {
      a: Run[];
      b: Run[];
      pairing?: string;
      score: number;
      difference_percent: number;
    };
    const edges = JSON.parse(f.sewing_edges()) as Edge[];
    expect(edges.length).toBeGreaterThan(10);
    expect(edges.every((x) => !x.sewn)).toBe(true);
    // Suggestions: the sides, shoulders, both sleeve caps and underarms of a T-shirt.
    const proposals = JSON.parse(f.suggest_seams()) as Proposal[];
    expect(proposals.length).toBeGreaterThanOrEqual(8);
    expect(proposals.every((x) => x.a.length > 0 && x.b.length > 0)).toBe(true);
    // Two picks of whole edges make a seam; a corner paired with another edge's end is refused.
    const a = edges[0]!;
    const b = edges.find((x) => x.cut !== a.cut)!;
    const pick = (x: Edge) =>
      JSON.stringify({ cut: x.cut, from: x.from, to: x.to });
    const made = JSON.parse(f.join_edges(pick(a), pick(b))) as Proposal;
    expect(made.a).toHaveLength(1);
    expect(made.b).toHaveLength(1);
    const partial = JSON.stringify({ cut: a.cut, from: a.from, to: b.to });
    expect(() => f.join_edges(partial, pick(b))).toThrow();
    // A side may be several whole edges (a chain): one run each, paired by length.
    const c = edges.find((x) => x.cut !== a.cut && x.cut !== b.cut)!;
    const chain = JSON.parse(
      f.join_edges(pick(a), `[${pick(b)},${pick(c)}]`),
    ) as Proposal;
    expect(chain.a).toHaveLength(1);
    expect(chain.b).toHaveLength(2);
    expect(chain.pairing).toBe("length");
    // ...and still only whole edges.
    expect(() => f.join_edges(pick(a), `[${pick(b)},${partial}]`)).toThrow();
    f.free();
  });

  it("adds pieces with their sewing to an open project as one undoable edit", () => {
    const p = JSON.parse(wasm.VtryFile.inspect_import(hoodie)) as Preview;
    expect(p.sewing!.seams).toBeGreaterThan(5);
    expect(leftOut(p).join("\n")).toMatch(/doesn't use: .*cuff/);
    const { file, entities } = openExample("trousers");
    const a = JSON.parse(
      file.import_addition(
        hoodie,
        JSON.stringify(suggested(p)),
        Date.now(),
        seed,
      ),
    ) as Addition;
    const g = mainGarment(entities)!;
    const cmd = addPieces(entities, g.id, a);
    const after = applyCommand(entities, cmd);
    expect(rustRefuses(file, after)).toBeNull();
    const added = mainGarment(after)!;
    expect(added.pieces).toHaveLength(g.pieces.length + a.pieces.length);
    expect(added.seams).toHaveLength((g.seams ?? []).length + a.seams.length);
    // The trousers' box stops at the waist: it grows to cover the hoodie.
    expect(added.simulation?.collisionBounds?.max[1]).toBeGreaterThan(
      g.simulation!.collisionBounds!.max[1],
    );
    expect(JSON.stringify(revertCommand(after, cmd))).toBe(
      JSON.stringify(entities),
    );
    file.free();
  });

  it("refuses a choice the sewing file cannot have", () => {
    const p = JSON.parse(wasm.VtryFile.inspect_import(hoodie)) as Preview;
    const c = { ...suggested(p), front: { type: "pair", pair: "arms" } };
    expect(() =>
      wasm.VtryFile.import_new(
        hoodie,
        JSON.stringify(c),
        new Uint8Array(),
        0,
        seed,
      ),
    ).toThrow();
  });
});
