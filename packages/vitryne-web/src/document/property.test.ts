// SPDX-License-Identifier: AGPL-3.0-or-later
// Random edit sessions on the three examples, against the worker's real Rust (Node build):
// after every step the document Rust holds matches the UI's, every state the UI accepts Rust
// accepts too, and undoing everything saves the original file byte for byte. The steps include
// the pattern tools: moving, adding and removing points, curves, lines, folds, the grain line
// and new pieces.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OutlineNode, Placement, Vec2 } from "@/format/schema.gen";
import { framed, newPiece, penLine, shapeOutline } from "@/pattern/draw";
import { curvedEdge, pointAlong, straightEdge } from "@/pattern/edit";
import { EXAMPLES, openExample } from "@/test/rust";
import {
  addFold,
  addLine,
  addPiece,
  type Bounds,
  type Command,
  CommandError,
  FABRIC_FIELDS,
  type FabricField,
  insertNode,
  moveNodes,
  removeFold,
  removeLine,
  removeNode,
  renameCut,
  renameFabric,
  renamePiece,
  renameProject,
  renameSeam,
  setFabricValue,
  setLayout,
  moveInStack,
  setMirrored,
  setOffset,
  setEdge,
  setGrain,
  setNodeType,
  setPlacement,
  setSelfCollision,
  setTargetVertices,
} from "./commands";
import { type Entities, mainGarment } from "./entities";
import { DocumentStore } from "./store";

type Step =
  | { op: "fabric"; field: FabricField; value: number; gesture: boolean }
  | {
      op: "rename";
      what: "project" | "piece" | "cut" | "seam" | "fabric";
      index: number;
      name: string;
    }
  | { op: "vertices"; value: number }
  | { op: "selfCollision"; on: boolean }
  | {
      op: "place";
      index: number;
      field: "angle" | "top" | "radius" | "rotation";
      value: number;
    }
  | { op: "follow"; index: number; on: number }
  | { op: "reorder"; index: number; to: number }
  | { op: "offset"; index: number; value: number }
  | { op: "flip"; index: number }
  | { op: "layout"; index: number; x: number; y: number; rot: number }
  // `piece` and `node` pick by index (modulo); offsets in mm.
  | { op: "move"; piece: number; node: number; dx: number; dy: number }
  | { op: "insert"; piece: number; node: number; share: number; notch: boolean }
  | { op: "remove"; piece: number; node: number }
  | {
      op: "nodeType";
      piece: number;
      node: number;
      type: OutlineNode["type"];
    }
  | { op: "edge"; piece: number; node: number; curve: boolean }
  | {
      op: "handle";
      piece: number;
      node: number;
      which: 0 | 1;
      dx: number;
      dy: number;
    }
  | { op: "line"; piece: number; node: number; share: number }
  | { op: "unline"; piece: number; index: number }
  | { op: "fold"; piece: number; a: number; b: number }
  | { op: "unfold"; piece: number; index: number }
  | { op: "grain"; piece: number; angle: number | null }
  | { op: "addPiece"; width: number; height: number; place: number }
  | { op: "undo" }
  | { op: "redo" };

const number = fc.oneof(
  fc.double({ min: -10, max: 1e5, noNaN: false }),
  fc.constantFrom(0, -0, 1e-9, 0.15, 1, Number.NaN, Number.POSITIVE_INFINITY),
);

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    op: fc.constant("fabric" as const),
    field: fc.constantFrom(...(Object.keys(FABRIC_FIELDS) as FabricField[])),
    value: number,
    gesture: fc.boolean(),
  }),
  fc.record({
    op: fc.constant("rename" as const),
    what: fc.constantFrom(
      "project" as const,
      "piece" as const,
      "cut" as const,
      "seam" as const,
      "fabric" as const,
    ),
    index: fc.nat(20),
    name: fc.string({ maxLength: 12 }),
  }),
  fc.record({
    op: fc.constant("vertices" as const),
    value: fc.oneof(
      fc.integer({ min: -10, max: 40_000 }),
      fc.double({ min: 0, max: 1e4 }),
    ),
  }),
  fc.record({ op: fc.constant("selfCollision" as const), on: fc.boolean() }),
  fc.record({
    op: fc.constant("place" as const),
    index: fc.nat(20),
    field: fc.constantFrom(
      "angle" as const,
      "top" as const,
      "radius" as const,
      "rotation" as const,
    ),
    value: number,
  }),
  fc.record({
    op: fc.constant("follow" as const),
    index: fc.nat(20),
    on: fc.nat(20),
  }),
  fc.record({
    op: fc.constant("reorder" as const),
    index: fc.nat(20),
    to: fc.nat(20),
  }),
  fc.record({
    op: fc.constant("offset" as const),
    index: fc.nat(20),
    value: number,
  }),
  fc.record({ op: fc.constant("flip" as const), index: fc.nat(20) }),
  fc.record({
    op: fc.constant("layout" as const),
    index: fc.nat(20),
    x: number,
    y: number,
    rot: number,
  }),
  fc.constant({ op: "undo" as const }),
  fc.constant({ op: "redo" as const }),
);

// Mostly small moves, as a drag makes; sometimes large or not a number.
const offset = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: -25, max: 25 }) },
  { weight: 2, arbitrary: fc.integer({ min: -150, max: 150 }) },
  { weight: 1, arbitrary: number },
);
const at = { piece: fc.nat(20), node: fc.nat(40) };
// Whole percents: fast-check's doubles lean on 0 and 1, the ends of an edge.
const share = fc.integer({ min: 1, max: 99 }).map((x) => x / 100);

const patternStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    op: fc.constant("move" as const),
    ...at,
    dx: offset,
    dy: offset,
  }),
  fc.record({
    op: fc.constant("insert" as const),
    ...at,
    share: share,
    notch: fc.boolean(),
  }),
  fc.record({ op: fc.constant("remove" as const), ...at }),
  fc.record({
    op: fc.constant("nodeType" as const),
    ...at,
    type: fc.constantFrom(
      "corner" as const,
      "notch" as const,
      "point" as const,
    ),
  }),
  fc.record({ op: fc.constant("edge" as const), ...at, curve: fc.boolean() }),
  fc.record({
    op: fc.constant("handle" as const),
    ...at,
    which: fc.constantFrom(0 as const, 1 as const),
    dx: offset,
    dy: offset,
  }),
  fc.record({
    op: fc.constant("line" as const),
    ...at,
    share: share,
  }),
  fc.record({
    op: fc.constant("unline" as const),
    piece: fc.nat(20),
    index: fc.nat(5),
  }),
  fc.record({
    op: fc.constant("fold" as const),
    piece: fc.nat(20),
    a: fc.nat(40),
    b: fc.nat(40),
  }),
  fc.record({
    op: fc.constant("unfold" as const),
    piece: fc.nat(20),
    index: fc.nat(5),
  }),
  fc.record({
    op: fc.constant("grain" as const),
    piece: fc.nat(20),
    angle: fc.option(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true })),
  }),
  fc.record({
    op: fc.constant("addPiece" as const),
    width: fc.oneof(fc.integer({ min: 20, max: 800 }), number),
    height: fc.oneof(fc.integer({ min: 20, max: 800 }), number),
    place: fc.nat(3),
  }),
  fc.constant({ op: "undo" as const }),
  fc.constant({ op: "redo" as const }),
);

const PLACES = ["body-front", "body-back", "body-left", "body-right"];

/** Fresh ids for new entities; never reused within a run. */
let fresh = 0;
const newId = () =>
  `01a13cdb-ff06-7000-8000-${String(++fresh).padStart(12, "0")}`;

type RustFile = ReturnType<typeof openExample>["file"];

/** A ready rectangle, placed by Rust as the new-piece dialog does. */
function newRectangle(
  s: Extract<Step, { op: "addPiece" }>,
  e: Entities,
  file: RustFile,
): Command {
  const g = mainGarment(e)!;
  const f = framed(
    shapeOutline("rectangle", { width: s.width, height: s.height }, newId),
  );
  const piece = newPiece({
    id: newId(),
    name: "Drawn",
    outline: f.outline,
    cutIds: [newId()],
    origin: f.origin,
  });
  let r: { placements: Omit<Placement, "type">[]; bounds: Bounds | null };
  try {
    r = JSON.parse(
      file.place_piece(
        JSON.stringify(piece),
        JSON.stringify([PLACES[s.place % PLACES.length]]),
      ),
    ) as typeof r;
  } catch (err) {
    throw new CommandError(String(err));
  }
  const cut = piece.cuts[0];
  return addPiece(
    e,
    g.id,
    {
      ...piece,
      cuts: [
        { ...cut, placement: { type: "wrap", ...r.placements[0] } },
      ] as typeof piece.cuts,
    },
    r.bounds ?? undefined,
  );
}

/** The pattern edits, as the flat view's tools build them. */
function buildPattern(s: Step, e: Entities, file: RustFile): Command {
  const g = mainGarment(e)!;
  if (s.op === "addPiece") return newRectangle(s, e, file);
  if (!("piece" in s)) throw new Error("unreachable");
  const piece = g.pieces[s.piece % g.pieces.length];
  if (!piece) throw new CommandError("no piece");
  const nodes = piece.outline;
  const k = "node" in s ? s.node % nodes.length : 0;
  const node = nodes[k]!;
  const centre = (): Vec2 => [
    nodes.reduce((x, n) => x + n.position[0], 0) / nodes.length,
    nodes.reduce((y, n) => y + n.position[1], 0) / nodes.length,
  ];
  switch (s.op) {
    case "move":
      return moveNodes(e, g.id, piece.id, {
        [node.id]: [node.position[0] + s.dx, node.position[1] + s.dy],
      });
    case "insert":
      return insertNode(
        e,
        g.id,
        piece.id,
        node.id,
        [...pointAlong(nodes, k, s.share)],
        newId(),
        s.notch ? "notch" : "point",
      );
    case "remove":
      return removeNode(e, g.id, piece.id, node.id);
    case "nodeType":
      return setNodeType(e, g.id, piece.id, node.id, s.type);
    case "edge":
      return setEdge(
        e,
        g.id,
        piece.id,
        node.id,
        s.curve ? curvedEdge(nodes, k) : straightEdge(),
      );
    case "handle": {
      // One of the garment's curves (`node` picks which; `piece` is ignored).
      const curves = g.pieces.flatMap((p) =>
        p.outline.filter((n) => n.edge.type === "cubic").map((n) => ({ p, n })),
      );
      const pick = curves[s.node % (curves.length || 1)];
      if (pick?.n.edge.type !== "cubic") throw new CommandError("no curve");
      const controls: [Vec2, Vec2] = [...pick.n.edge.controls];
      const c = controls[s.which];
      controls[s.which] = [c[0] + s.dx, c[1] + s.dy];
      return setEdge(e, g.id, pick.p.id, pick.n.id, {
        type: "cubic",
        controls,
      });
    }
    case "line": {
      // From the middle of the piece towards a point on its outline; refused when it leaves.
      const c = centre();
      const p = pointAlong(nodes, k, s.share);
      const end: Vec2 = [(c[0] + p[0]) / 2, (c[1] + p[1]) / 2];
      return addLine(
        e,
        g.id,
        piece.id,
        penLine([{ at: c }, { at: end }], newId),
      );
    }
    case "unline": {
      const lines = piece.lines ?? [];
      if (!lines.length) throw new CommandError("no lines");
      return removeLine(e, g.id, piece.id, lines[s.index % lines.length]!.id);
    }
    case "fold":
      return addFold(e, g.id, piece.id, {
        id: newId(),
        from: nodes[s.a % nodes.length]!.id,
        to: nodes[s.b % nodes.length]!.id,
      });
    case "unfold": {
      const folds = piece.folds ?? [];
      if (!folds.length) throw new CommandError("no folds");
      return removeFold(e, g.id, piece.id, folds[s.index % folds.length]!.id);
    }
    case "grain": {
      if (s.angle === null) return setGrain(e, g.id, piece.id, undefined);
      const c = centre();
      return setGrain(e, g.id, piece.id, {
        from: c,
        to: [c[0] + 100 * Math.cos(s.angle), c[1] + 100 * Math.sin(s.angle)],
      });
    }
  }
  throw new Error("unreachable");
}

function build(s: Step, e: Entities, file: RustFile): Command {
  const g = mainGarment(e)!;
  const fabric = e.fabrics[0]!.id;
  switch (s.op) {
    case "move":
    case "insert":
    case "remove":
    case "nodeType":
    case "edge":
    case "handle":
    case "line":
    case "unline":
    case "fold":
    case "unfold":
    case "grain":
    case "addPiece":
      return buildPattern(s, e, file);
    case "fabric":
      return setFabricValue(e, fabric, s.field, s.value);
    case "vertices":
      return setTargetVertices(e, s.value);
    case "selfCollision":
      return setSelfCollision(e, s.on);
    case "place":
    case "follow":
    case "reorder":
    case "offset":
    case "flip":
    case "layout": {
      const cuts = g.pieces.flatMap((p) => p.cuts);
      const cut = cuts[s.index % cuts.length]!;
      if (s.op === "flip") return setMirrored(e, g.id, cut.id, !cut.mirrored);
      if (s.op === "layout")
        return setLayout(e, g.id, cut.id, {
          position: [s.x, s.y],
          rotation: s.rot,
        });
      // A place past the end of the stack, or a cut placed on another moved below it: refused.
      if (s.op === "reorder")
        return moveInStack(e, g.id, cut.id, s.to % (g.stack.length + 1));
      if (s.op === "offset") return setOffset(e, g.id, cut.id, s.value);
      // Following may make a loop: Rust refuses that, and the store rolls it back.
      if (s.op === "follow")
        return setPlacement(e, g.id, cut.id, {
          type: "follow",
          cut: cuts[s.on % cuts.length]!.id,
          lift: 12,
        });
      return setPlacement(e, g.id, cut.id, {
        ...cut.placement,
        [s.field]: s.value,
      });
    }
    case "rename": {
      const piece = g.pieces[s.index % g.pieces.length]!;
      switch (s.what) {
        case "project":
          return renameProject(e, s.name);
        case "piece":
          return renamePiece(e, g.id, piece.id, s.name);
        case "cut":
          return renameCut(
            e,
            g.id,
            piece.id,
            piece.cuts[s.index % piece.cuts.length]!.id,
            s.name,
          );
        case "seam": {
          const seams = g.seams ?? [];
          if (!seams.length) throw new CommandError("no seams");
          return renameSeam(e, g.id, seams[s.index % seams.length]!.id, s.name);
        }
        case "fabric":
          return renameFabric(e, fabric, s.name);
      }
    }
  }
  throw new Error("unreachable");
}

/** One session of `steps` on example `name`, checked after every step and at the end. */
async function session(name: (typeof EXAMPLES)[number], steps: Step[]) {
  const { file, zip, entities } = openExample(name);
  let refusedByRust: string | null = null;
  const store = new DocumentStore(
    {
      // The worker's update, synchronously: Rust validates and takes the state.
      update: async (_rev, json) => {
        try {
          file.set_entities(json);
        } catch (e) {
          refusedByRust = String(e);
          throw new Error(String(e), { cause: e });
        }
        return { warnings: [] };
      },
      drape: () => {},
      onReopened: () => {},
    },
    { freeze: true, drapeDelayMs: 1e9 },
  );
  store.load(`${name}.vtry`, entities, [], 0);
  for (const s of steps) {
    if (s.op === "undo") store.undo();
    else if (s.op === "redo") store.redo();
    else {
      if (s.op === "fabric" && s.gesture)
        store.beginGesture(`fabric:${entities.fabrics[0]!.id}:${s.field}`);
      store.execute((e) => build(s, e, file));
      if (s.op === "fabric" && !s.gesture) store.endGesture();
    }
    const { entities: confirmed } = await store.settled();
    // Everything the UI let through, Rust accepted.
    expect(refusedByRust, JSON.stringify(s)).toBeNull();
    // Rust holds exactly the UI's document.
    expect(JSON.parse(file.entities())).toEqual(
      JSON.parse(JSON.stringify(confirmed)),
    );
    expect(confirmed).toBe(store.state.entities);
  }
  while (store.state.undoLabel) store.undo();
  await store.settled();
  expect(store.state.dirty).toBe(false);
  expect(Buffer.from(file.save()).equals(Buffer.from(zip))).toBe(true);
  file.free();
}

describe.each(EXAMPLES)("%s: random edit sessions", (name) => {
  it("stay valid in Rust and undo back to the original bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 25 }), (steps) =>
        session(name, steps),
      ),
      { numRuns: 40 },
    );
  });

  it("with the pattern tools too", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(patternStep, step), { maxLength: 30 }),
        (steps) => session(name, steps),
      ),
      { numRuns: 40 },
    );
  });
});
