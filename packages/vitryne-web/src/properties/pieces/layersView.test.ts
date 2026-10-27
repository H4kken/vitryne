// SPDX-License-Identifier: AGPL-3.0-or-later
// The Layers view rendered on the hoodie (react-dom/server: there is no browser here): rows
// outermost first, the pocket nested under its front, the selected row's controls, and the
// distances the engine reported.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mainGarment } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { stackChildren, stackRoots } from "@/placement/stackOrder";
import { openExample } from "@/test/rust";
import { cutName } from "../cutName";
import { findCut } from "@/document/commands";
import { LayersView } from "./LayersView";

const { entities } = openExample("hoodie");
const g = mainGarment(entities)!;
const store = {
  beginGesture() {},
  endGesture() {},
  execute: () => true,
} as unknown as DocumentStore;
const name = (id: string) => {
  const f = findCut(g, id)!;
  return cutName(f.piece, f.cut);
};

const render = (selected: string | null, out: [string, number][] = []) =>
  renderToStaticMarkup(
    createElement(LayersView, {
      store,
      entities,
      garment: g,
      selection: selected
        ? {
            kind: "cut",
            pieceId: findCut(g, selected)!.piece.id,
            cutId: selected,
          }
        : null,
      onSelect: () => {},
      onHover: () => {},
      startsOut: new Map(out),
    }),
  );

describe("the Layers view", () => {
  it("lists the cuts outermost first, a cut placed on another right under it", () => {
    const label = (id: string) =>
      name(id) + (findCut(g, id)!.cut.mirrored ? " (mirrored)" : "");
    const expected: string[] = [];
    const walk = (id: string) => {
      expected.push(label(id));
      stackChildren(g, id).reverse().forEach(walk);
    };
    stackRoots(g).reverse().forEach(walk);
    const html = render(null);
    const shown = [
      ...html.matchAll(/<span class="text-\[15px\][^"]*">([^<]*)<\/span>/g),
    ].map((m) => m[1]);
    expect(shown).toEqual(expected);
    expect(
      stackChildren(
        g,
        stackRoots(g).find((r) => stackChildren(g, r).length)!,
      ),
    ).not.toEqual([]);
    expect(html).toContain("Next to the body");
  });

  it("shows how far out the engine says a cut starts, on cuts on the body", () => {
    const [first] = stackRoots(g);
    const html = render(null, [[first!, 12]]);
    expect(html).toContain("+12 mm");
    expect(render(null)).not.toContain(" mm");
  });

  it("opens controls under the selected row only", () => {
    const [first, second] = stackRoots(g);
    const html = render(first!);
    expect(html).toContain("Start further out");
    expect(html).toContain("Move out");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(render(null)).not.toContain("Start further out");
    // A cut placed on another has a lift, not an offset, and cannot be stepped.
    const pocket = stackChildren(
      g,
      stackRoots(g).find((r) => stackChildren(g, r).length)!,
    )[0]!;
    const onPocket = render(pocket);
    expect(onPocket).toContain("Lifted off it");
    expect(onPocket).not.toContain("Move out");
    expect(second).toBeDefined();
  });
});
