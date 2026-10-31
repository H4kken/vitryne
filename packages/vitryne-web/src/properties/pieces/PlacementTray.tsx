// SPDX-License-Identifier: AGPL-3.0-or-later
// The pieces that wait for a place on the body (an import leaves the ones no name rule placed
// here) and the ones set aside: drag a piece onto the body (front and back side by side), or pick
// it and click a part of the body. A zone is a position the person chooses; nothing in sewing
// reads it (packages/vitryne-docs/content/docs/developers/patents.md, rule 3).

import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { findCut, setCutState, setPlacement } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Cut, Garment, Piece } from "@/format/schema.gen";
import { BodyMap } from "@/editor/dialogs/BodyMap";
import { choiceAt, parseZoneKey } from "@/editor/dialogs/bodyZones";
import { ImportThumb } from "@/editor/dialogs/ImportThumb";
import { PlacementCard, type CardPiece } from "@/editor/dialogs/PlacementCard";
import { PAIRS, type Pair, type Place } from "@/placement/places";
import { outlinePoints } from "@/pattern/geometry";
import { cutName } from "../cutName";
import { ON_TOP_LIFT_MM } from "./CutDetails";

interface Item {
  piece: Piece;
  cut: Cut;
  card: CardPiece;
}

export function PlacementTray(props: {
  store: DocumentStore;
  garment: Garment;
  /** Asks Rust for a fresh wrap of the cut at `place`, then makes it an edit. */
  onRewrap: (cutId: string, place: Place) => void;
  onHover: (cutId: string | null) => void;
}) {
  const { store, garment: g } = props;
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    over: string | null;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const items = useMemo(
    () =>
      g.pieces.flatMap((piece) =>
        piece.cuts.flatMap((cut): Item[] =>
          cut.state
            ? [
                {
                  piece,
                  cut,
                  card: {
                    name: cutName(piece, cut),
                    outline: outlinePoints(piece),
                    cuts: 1,
                    quantity: 1,
                  },
                },
              ]
            : [],
        ),
      ),
    [g],
  );
  const waiting = items.filter((x) => x.cut.state === "unplaced");
  if (!waiting.length) return null;

  const setState = (id: string, s: "unplaced" | "set-aside") =>
    store.execute((e) => setCutState(e, g.id, [id], s));

  const drop = (id: string, key: string) => {
    const x = items.find((i) => i.cut.id === id);
    if (!x) return;
    setArmed(null);
    // Both copies of a piece that waits go together, the first on the right (as an import does).
    const both =
      x.piece.cuts.length === 2 &&
      x.piece.cuts.every((c) => c.state === "unplaced");
    const [view, zone] = parseZoneKey(key);
    const choice = choiceAt(view, zone, both);
    if (!choice) {
      setNote("A piece cut twice goes on both arms or both legs.");
      return;
    }
    setNote(null);
    if (choice.startsWith("pair:")) {
      const places = PAIRS[choice.slice(5) as Pair].places;
      x.piece.cuts.forEach((c, k) => props.onRewrap(c.id, places[k] as Place));
    } else props.onRewrap(id, choice.slice(4) as Place);
  };

  const card = (x: Item): ReactNode => (
    <PlacementCard
      key={x.cut.id}
      piece={x.card}
      choice={x.cut.state === "set-aside" ? "leave" : undefined}
      slim
      noFlat
      check={false}
      armed={armed === x.cut.id}
      dragging={drag?.id === x.cut.id}
      others={g.pieces
        .filter((p) => p.id !== x.piece.id && p.cuts[0] && !p.cuts[0].state)
        .map((p) => ({ key: (p.cuts[0] as Cut).id, label: p.name }))}
      onArm={() => {
        setNote(null);
        setArmed((a) => (a === x.cut.id ? null : x.cut.id));
      }}
      onDrag={(at) => setDrag(at && { id: x.cut.id, ...at })}
      onDrop={(z) => drop(x.cut.id, z)}
      onChoose={(v) => {
        setNote(null);
        if (v === "leave") setState(x.cut.id, "set-aside");
        else if (v.startsWith("one:"))
          props.onRewrap(x.cut.id, v.slice(4) as Place);
        else if (v.startsWith("on:")) {
          const on = v.slice(3);
          if (findCut(g, on))
            store.execute((e) =>
              setPlacement(e, g.id, x.cut.id, {
                type: "follow",
                cut: on,
                lift: ON_TOP_LIFT_MM,
              }),
            );
        }
      }}
      onHover={(on) => props.onHover(on ? x.cut.id : null)}
    />
  );

  const lit = new Set<string>(drag?.over ? [drag.over] : []);
  const dragged = drag && items.find((i) => i.cut.id === drag.id);
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-secondary/50 p-3">
      {
        <>
          <h3 className="m-0 text-[14px] font-semibold">
            Not placed ({waiting.length})
          </h3>
          <BodyMap
            occupied={{}}
            lit={lit}
            inviting={!!armed || !!drag}
            onZone={(key) =>
              armed
                ? drop(armed, key)
                : setNote("Pick a piece first, then click a part of the body.")
            }
          />
          <p
            aria-live="polite"
            className="text-muted-foreground m-0 text-center text-[13px] leading-snug"
          >
            {note ??
              (armed
                ? "Click the part of the body it goes on."
                : "Drag a piece onto the body, or pick it and click a part of the body.")}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {waiting.map(card)}
          </ul>
        </>
      }
      {drag &&
        dragged &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[200] -translate-x-1/2 -translate-y-1/2 opacity-90"
            style={{ left: drag.x, top: drag.y }}
          >
            <ImportThumb outline={dragged.card.outline} />
          </div>,
          document.body,
        )}
    </section>
  );
}
