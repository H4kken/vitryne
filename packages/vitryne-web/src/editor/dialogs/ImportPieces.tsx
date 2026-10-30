// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId } from "react";
import { PlaceSelect } from "@/placement/PlaceSelect";
import { chooseFor } from "./chooseFor";
import { ImportThumb } from "./ImportThumb";
import type { Preview } from "./ImportDialog";

/** The pieces of the file, each with where it goes on the body. */
export function ImportPieces(props: {
  preview: Preview;
  /** The encoded choice of each piece, by name. */
  choices: Record<string, string>;
  onChoices: (f: (c: Record<string, string>) => Record<string, string>) => void;
}) {
  const { preview, choices } = props;
  const ids = useId();

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

  return (
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
        return (
          <li
            key={x.name}
            className="flex items-center gap-3 rounded-2xl border border-border p-2.5"
          >
            <ImportThumb outline={x.outline} />
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <label
                htmlFor={`${ids}-${x.name}`}
                className="truncate text-[15px] font-semibold"
              >
                {x.name}
              </label>
              <span className="text-muted-foreground text-[13px]">
                {fixed
                  ? `Cut ${fixed === 2 ? "twice" : "once"} (sewing file)`
                  : `Cut ×${x.quantity} in the file`}
              </span>
            </div>
            <PlaceSelect
              id={`${ids}-${x.name}`}
              className="h-11 w-[230px] shrink-0 rounded-[10px] border-[1.5px] border-border-strong bg-card text-[14px]"
              value={choices[x.name] ?? null}
              options={{
                one: fixed !== 2,
                pairs: fixed !== 1,
                on: fixed === 2 ? [] : others,
                flat: fixed !== 2,
                leave: true,
              }}
              onChange={(v) => props.onChoices((c) => chooseFor(c, x.name, v))}
            />
          </li>
        );
      })}
    </ul>
  );
}
