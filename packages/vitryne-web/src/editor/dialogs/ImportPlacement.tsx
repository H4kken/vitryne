// SPDX-License-Identifier: AGPL-3.0-or-later
// Where each piece of an import goes on the body: drag a piece onto the body (front and back side
// by side), or pick it and then click a part of the body, or use the keyboard. The place list on
// each card stays for the places the map doesn't draw (the head, "on another piece", "as it is").
// Pieces whose place was guessed from their name are marked "Check" until the person confirms
// them. A zone is a position the person chooses (packages/vitryne-docs/content/docs/developers/patents.md).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlaceSelect } from "@/placement/PlaceSelect";
import { BodyMap } from "./BodyMap";
import { choiceAt, choiceLabel, parseZoneKey, zonesOf } from "./bodyZones";
import { chooseFor } from "./chooseFor";
import { ImportThumb } from "./ImportThumb";
import type { Preview } from "./ImportDialog";

type Piece = Preview["pieces"][number];

/** A piece goes on both arms or legs when it is cut twice. */
function wantsPair(x: Piece): boolean {
  return x.cuts !== null ? x.cuts === 2 : x.quantity >= 2;
}

/** Pixels of movement before a press on a card becomes a drag. */
const DRAG_FROM = 5;

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

  /** The zone under a screen point, if any. */
  const zoneAt = (x: number, y: number): string | null =>
    document
      .elementsFromPoint(x, y)
      .map((el) => el.closest<HTMLElement>("[data-zone]")?.dataset.zone)
      .find((z) => z) ?? null;

  const open = preview.pieces.filter((x) => props.unchecked.has(x.name));
  const dragged = drag && preview.pieces.find((p) => p.name === drag.name);

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,350px)_minmax(0,1fr)]">
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
          className="text-muted-foreground mt-2 mb-0 min-h-10 text-center text-[13px] leading-snug"
        >
          {note ??
            (armed
              ? `Click where ${armed} goes.`
              : "Drag a piece onto the body, or pick it and click a part of the body.")}
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
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {preview.pieces.map((x) => {
            const fixed = x.cuts;
            const others = preview.pieces
              .filter(
                (o) =>
                  o.name !== x.name &&
                  !sitsOn(o.name, x.name) &&
                  choices[o.name] !== "leave",
              )
              .map((o) => ({ key: o.name, label: o.name }));
            const check = props.unchecked.has(x.name) && !!choices[x.name];
            return (
              <li
                key={x.name}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border p-2",
                  armed === x.name
                    ? "border-select bg-select/5"
                    : "border-border",
                  drag?.name === x.name && "opacity-50",
                )}
                onPointerEnter={() => setHovered(x.name)}
                onPointerLeave={() => setHovered(null)}
              >
                <button
                  type="button"
                  aria-pressed={armed === x.name}
                  aria-label={`${x.name}: ${choiceLabel(choices[x.name])}. Pick it, then choose a part of the body.`}
                  className="flex min-w-0 grow cursor-grab touch-none items-center gap-3 rounded-xl border-0 bg-transparent p-0 text-left select-none"
                  onClick={() => {
                    setNote(null);
                    setArmed((a) => (a === x.name ? null : x.name));
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    const el = e.currentTarget;
                    el.setPointerCapture(e.pointerId);
                    const from = { x: e.clientX, y: e.clientY };
                    let dragging = false;
                    const move = (m: PointerEvent) => {
                      if (
                        !dragging &&
                        Math.hypot(m.clientX - from.x, m.clientY - from.y) <
                          DRAG_FROM
                      )
                        return;
                      dragging = true;
                      setDrag({
                        name: x.name,
                        x: m.clientX,
                        y: m.clientY,
                        over: zoneAt(m.clientX, m.clientY),
                      });
                    };
                    const end = (u: PointerEvent) => {
                      el.removeEventListener("pointermove", move);
                      el.removeEventListener("pointerup", end);
                      el.removeEventListener("pointercancel", end);
                      setDrag(null);
                      if (!dragging) return;
                      // The click that follows a drag must not pick the piece.
                      const swallow = (c: Event) =>
                        c.stopImmediatePropagation();
                      el.addEventListener("click", swallow, true);
                      setTimeout(
                        () => el.removeEventListener("click", swallow, true),
                        50,
                      );
                      if (u.type === "pointerup") {
                        const z = zoneAt(u.clientX, u.clientY);
                        if (z) drop(x.name, z);
                      }
                    };
                    el.addEventListener("pointermove", move);
                    el.addEventListener("pointerup", end);
                    el.addEventListener("pointercancel", end);
                  }}
                >
                  <ImportThumb outline={x.outline} />
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">
                        {x.name}
                      </span>
                      {check && (
                        <span className="bg-brand/15 text-brand shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold">
                          Check
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-[13px]">
                      {fixed
                        ? `Cut ${fixed === 2 ? "twice" : "once"} (sewing file)`
                        : `Cut ×${x.quantity} in the file`}
                    </span>
                  </span>
                </button>
                <PlaceSelect
                  label={`Place of ${x.name}`}
                  className="h-10 w-[180px] shrink-0 rounded-[10px] border-[1.5px] border-border-strong bg-card text-[13px]"
                  placeholder="Not placed"
                  value={choices[x.name] ?? null}
                  options={{
                    one: fixed !== 2,
                    pairs: fixed !== 1,
                    on: fixed === 2 ? [] : others,
                    flat: fixed !== 2,
                    leave: true,
                  }}
                  onChange={(v) => {
                    setNote(null);
                    props.onChoices((c) => chooseFor(c, x.name, v));
                    props.onChecked([x.name]);
                  }}
                />
              </li>
            );
          })}
        </ul>
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
