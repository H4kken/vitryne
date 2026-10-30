// SPDX-License-Identifier: AGPL-3.0-or-later
// The Layers view of the Pieces panel: the garment's stack (file-format.md, The stack) outermost
// first, as Figma lists layers. Dragging a row changes what is outside what; a cut placed on
// another is nested under it and goes with it. Every change is a command on the store.

import { type DragEvent, useState } from "react";
import { PanelIntro } from "@/components/PanelIntro";
import { cutColor, findCut, moveInStack } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import type { Garment } from "@/format/schema.gen";
import type { Selection } from "@/pattern/panel/types";
import {
  dropPlace,
  moves,
  stackChildren,
  stackRoots,
  stepPlace,
} from "@/placement/stackOrder";
import { cutName } from "../cutName";
import { LayerControls } from "./LayerControls";
import { DirectionRail } from "./DirectionRail";
import { LayerRow } from "./LayerRow";
import { whereLabel } from "./whereLabel";

export function LayersView(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onHover: (cutId: string | null) => void;
  /** How far out each cut starts, mm, by cut id, in the drape shown. */
  startsOut: ReadonlyMap<string, number>;
}) {
  const { store, garment: g, selection, startsOut } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; outer: boolean } | null>(null);
  const stop = () => {
    setDragId(null);
    setOver(null);
  };
  const moveTo = (id: string, place: number | null) => {
    if (place !== null && moves(g, id, place))
      store.execute((e) => moveInStack(e, g.id, id, place));
  };
  const step = (id: string, dir: 1 | -1) => moveTo(id, stepPlace(g, id, dir));
  /** Whether a drag is over the upper half of the row: a drop there goes outside it. */
  const upperHalf = (e: DragEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY < box.top + box.height / 2;
  };

  const cutItem = (id: string, depth: number): React.ReactNode => {
    const found = findCut(g, id);
    if (!found) return null;
    const { piece, cut } = found;
    const selected = selection?.cutId === id;
    const out = startsOut.get(id);
    const root = depth === 0;
    return (
      <li key={id}>
        <LayerRow
          name={cutName(piece, cut) + (cut.mirrored ? " (mirrored)" : "")}
          color={cutColor(props.entities, g, cut) ?? DEFAULT_CLOTH_COLOR}
          where={whereLabel(g, cut)}
          out={root && out ? `+${Math.round(out * 10) / 10} mm` : null}
          depth={depth}
          selected={selected}
          dragging={dragId === id}
          drop={
            over?.id === id && dragId !== id
              ? over.outer
                ? "outer"
                : "inner"
              : null
          }
          onSelect={() =>
            props.onSelect({ kind: "cut", pieceId: piece.id, cutId: id })
          }
          onHover={(on) => props.onHover(on ? id : null)}
          step={
            root
              ? {
                  out: moves(g, id, stepPlace(g, id, 1)),
                  in: moves(g, id, stepPlace(g, id, -1)),
                  onStep: (dir) => step(id, dir),
                }
              : undefined
          }
          drag={
            root
              ? {
                  onStart: (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", id);
                    setDragId(id);
                  },
                  onEnd: stop,
                  onOver: (e) => {
                    if (!dragId || dragId === id) return;
                    e.preventDefault();
                    const outer = upperHalf(e);
                    if (over?.id !== id || over.outer !== outer)
                      setOver({ id, outer });
                  },
                  onLeave: () => setOver((o) => (o?.id === id ? null : o)),
                  onDrop: (e) => {
                    e.preventDefault();
                    if (dragId)
                      moveTo(dragId, dropPlace(g, dragId, id, upperHalf(e)));
                    stop();
                  },
                }
              : undefined
          }
        >
          {selected && <LayerControls store={store} garment={g} cut={cut} />}
        </LayerRow>
        {stackChildren(g, id).length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pt-1">
            {stackChildren(g, id)
              .reverse()
              .map((c) => cutItem(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <PanelIntro>
        Outermost on top. Drag a piece, or use its arrows, to change what is
        outside what. A piece placed on another moves with it.
      </PanelIntro>
      <div className="grid grid-cols-[22px_1fr] gap-1.5">
        <DirectionRail />
        <ul
          aria-label="Pieces from the outside in"
          className="m-0 flex list-none flex-col gap-1 p-0"
          onPointerLeave={() => props.onHover(null)}
        >
          {stackRoots(g)
            .reverse()
            .map((id) => cutItem(id, 0))}
        </ul>
      </div>
    </div>
  );
}
