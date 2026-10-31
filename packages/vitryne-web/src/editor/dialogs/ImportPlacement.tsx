// SPDX-License-Identifier: AGPL-3.0-or-later
// Where each piece of an import goes on the body: drag a piece onto the body (front and back side
// by side), or pick it and then click a part of the body, or use the keyboard. The place list on
// each card stays for the places the map doesn't draw (the head, "on another piece", "as it is").
// Pieces whose place was guessed from their name are marked "Check" until the person confirms
// them. A zone is a position the person chooses (packages/vitryne-docs/content/docs/developers/patents.md).

import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { BodyMap } from "./BodyMap";
import { choiceAt, parseZoneKey, zonesOf } from "./bodyZones";
import { chooseFor } from "./chooseFor";
import { ImportThumb } from "./ImportThumb";
import { PlacementCard } from "./PlacementCard";
import { PlacementSection } from "./PlacementSection";
import type { Preview } from "./ImportDialog";

type Piece = Preview["pieces"][number];

/** A piece goes on both arms or legs when it is cut twice. */
function wantsPair(x: Piece): boolean {
  return x.cuts !== null ? x.cuts === 2 : x.quantity >= 2;
}

export function ImportPlacement(props: {
  preview: Preview;
  /** The encoded choice of each piece, by name. */
  choices: Record<string, string>;
  onChoices: (f: (c: Record<string, string>) => Record<string, string>) => void;
  /** Names whose suggested place the person hasn't confirmed yet. */
  unchecked: ReadonlySet<string>;
  onChecked: (names: string[]) => void;
}) {
  const { preview, choices } = props;
  const [armed, setArmed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    name: string;
    x: number;
    y: number;
    over: string | null;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const occupied = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const x of preview.pieces)
      for (const k of zonesOf(choices[x.name])) (out[k] ??= []).push(x.name);
    return out;
  }, [preview, choices]);

  const lit = useMemo(() => {
    const s = new Set<string>();
    if (drag?.over) s.add(drag.over);
    else if (hovered) zonesOf(choices[hovered]).forEach((k) => s.add(k));
    return s;
  }, [drag, hovered, choices]);

  /** Whether `a` already goes on `b`, directly or through other pieces: `b` can't go on it. */
  const sitsOn = (a: string, b: string): boolean => {
    for (let k = 0, at = a; k <= Object.keys(choices).length; k++) {
      const c = choices[at];
      if (!c?.startsWith("on:")) return false;
      at = c.slice(3);
      if (at === b) return true;
    }
    return false;
  };

  const drop = (name: string, key: string) => {
    const x = preview.pieces.find((p) => p.name === name);
    if (!x) return;
    const [view, zone] = parseZoneKey(key);
    const choice = choiceAt(view, zone, wantsPair(x));
    setArmed(null);
    if (!choice) {
      setNote(
        `${name} is cut twice, so it goes on both arms or both legs, not on the torso.`,
      );
      return;
    }
    setNote(null);
    props.onChoices((c) => chooseFor(c, name, choice));
    props.onChecked([name]);
  };

  /** The pieces that go on `name`, shown under it. */
  const onTop = (name: string) =>
    preview.pieces.filter((p) => choices[p.name] === `on:${name}`);
  const roots = (section: "needs" | "placed" | "left") =>
    preview.pieces.filter((p) => {
      const c = choices[p.name];
      if (c?.startsWith("on:")) return false;
      return section === "needs"
        ? !c
        : section === "left"
          ? c === "leave"
          : !!c && c !== "leave";
    });
  const render = (x: Piece): ReactNode => {
    const c = choices[x.name];
    const kids = onTop(x.name);
    return (
      <PlacementCard
        key={x.name}
        piece={x}
        choice={c}
        slim={!!c}
        check={props.unchecked.has(x.name) && !!c}
        armed={armed === x.name}
        dragging={drag?.name === x.name}
        others={preview.pieces
          .filter(
            (o) =>
              o.name !== x.name &&
              !sitsOn(o.name, x.name) &&
              choices[o.name] !== "leave",
          )
          .map((o) => ({ key: o.name, label: o.name }))}
        onArm={() => {
          setNote(null);
          setArmed((a) => (a === x.name ? null : x.name));
        }}
        onDrag={(at) => setDrag(at && { name: x.name, ...at })}
        onDrop={(z) => drop(x.name, z)}
        onChoose={(v) => {
          setNote(null);
          props.onChoices((cs) => chooseFor(cs, x.name, v));
          props.onChecked([x.name]);
        }}
        onHover={(on) => setHovered(on ? x.name : null)}
      >
        {kids.length > 0 && (
          <ul className="border-border m-0 mt-2 ml-5 flex list-none flex-col gap-2 border-l-2 p-0 pl-3">
            {kids.map(render)}
          </ul>
        )}
      </PlacementCard>
    );
  };

  const open = preview.pieces.filter((x) => props.unchecked.has(x.name));
  const dragged = drag && preview.pieces.find((p) => p.name === drag.name);

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="self-start md:sticky md:top-0">
        <BodyMap
          occupied={occupied}
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
          className="text-muted-foreground mt-2 mb-0 min-h-14 text-center text-[13px] leading-snug"
        >
          {note ??
            (armed
              ? `Click where ${armed} goes.`
              : "Drag a piece onto the body, or pick it and click a part of the body. A number is how many pieces sit on that part.")}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        {open.length > 0 && (
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted-foreground">
              {open.length === 1 ? "1 place was" : `${open.length} places were`}{" "}
              guessed from the names.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onChecked(open.map((x) => x.name))}
            >
              Confirm suggestions
            </Button>
          </div>
        )}
        <PlacementSection
          title="Needs a place"
          pieces={roots("needs")}
          render={render}
        />
        <PlacementSection
          title="Placed"
          pieces={roots("placed")}
          render={render}
        />
        <PlacementSection
          title="Left out"
          pieces={roots("left")}
          render={render}
        />
      </div>

      {drag &&
        dragged &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[200] -translate-x-1/2 -translate-y-1/2 opacity-90"
            style={{ left: drag.x, top: drag.y }}
          >
            <ImportThumb outline={dragged.outline} />
          </div>,
          document.body,
        )}
    </div>
  );
}
