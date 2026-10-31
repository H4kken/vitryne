// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BodyMap } from "@/editor/dialogs/BodyMap";
import {
  choiceAt,
  LANDMARKS,
  parseZoneKey,
  type View,
  zonesOf,
} from "@/editor/dialogs/bodyZones";
import { type Place, PLACES } from "@/placement/places";

/**
 * Where a piece starts, on the body map (one side at a time): the part it is on is tinted, a click
 * on another part moves it there, and on an arm or a leg the finer places follow as large buttons.
 * Like the tray, this only names a position the person picks (patents.md, rule 3).
 */
export function PlaceMap(props: {
  /** The place the piece is at now, or null (on another piece, a region the map doesn't draw). */
  place: Place | null;
  onPlace: (place: Place, at?: string) => void;
}) {
  const here = zonesOf(props.place ? `one:${props.place}` : null);
  const [side, setSide] = useState<View>(
    here[0] && parseZoneKey(here[0])[0] === "back" ? "back" : "front",
  );
  const [limb, setLimb] = useState<string | null>(null);
  const lit = new Set(here.filter((k) => parseZoneKey(k)[0] === side));
  const parts = limb ? (LANDMARKS[parseZoneKey(limb)[1]] ?? []) : [];

  const pick = (key: string) => {
    const [view, zone] = parseZoneKey(key);
    const choice = choiceAt(view, zone, false);
    if (!choice) return;
    props.onPlace(choice.slice(4) as Place);
    setLimb(LANDMARKS[zone] ? key : null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-secondary flex w-fit self-end rounded-lg p-0.5">
        {(["front", "back"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setSide(v);
              setLimb(null);
            }}
            className={cn(
              "rounded-md px-3 py-0.5 text-[13px] font-semibold",
              side === v ? "bg-card shadow-sm" : "text-muted-foreground",
            )}
          >
            {v === "front" ? "Front" : "Back"}
          </button>
        ))}
      </div>
      <BodyMap
        only={side}
        occupied={{}}
        lit={lit}
        inviting={false}
        onZone={pick}
      />
      <p className="text-[15px] font-semibold">
        {props.place ? PLACES[props.place].label : "Not on a part of the body"}
      </p>
      {limb && (
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground flex justify-between text-[13px]">
            <span>Starts at…</span>
            <button
              type="button"
              onClick={() => setLimb(null)}
              className="underline underline-offset-4"
            >
              Done
            </button>
          </div>
          {parts.map((part) => (
            <button
              key={part.label}
              type="button"
              onClick={() => {
                const [view, zone] = parseZoneKey(limb);
                const choice = choiceAt(view, zone, false);
                if (choice)
                  props.onPlace(
                    choice.slice(4) as Place,
                    part.landmark ?? undefined,
                  );
                setLimb(null);
              }}
              className="border-input hover:border-foreground bg-card h-11 rounded-[10px] border px-3 text-left text-[15px]"
            >
              {part.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
