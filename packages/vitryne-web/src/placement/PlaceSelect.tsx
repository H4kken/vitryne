// SPDX-License-Identifier: AGPL-3.0-or-later
// A list of where something can go on the body: places, pairs of places, "on top of" another
// piece, and "leave it out". Values are strings: `one:<place>`, `pair:<pair>`, `on:<key>`,
// `flat`, `leave`.

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAIRS, type Pair, type Place, PLACES } from "./places";

export interface PlaceOptions {
  /** Single places. */
  one: boolean;
  pairs: boolean;
  /** "On top of": key and label of each piece it can go on. */
  on: { key: string; label: string }[];
  leave: boolean;
  /** "Import as it is": no place fits, start it flat in front of the chest. */
  flat?: boolean;
}

export function PlaceSelect(props: {
  id?: string;
  value: string | null;
  options: PlaceOptions;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const o = props.options;
  return (
    <Select value={props.value ?? ""} onValueChange={props.onChange}>
      <SelectTrigger
        id={props.id}
        aria-label={props.label}
        className={
          props.className ??
          "h-11 w-full rounded-[10px] border-[1.5px] border-border-strong bg-card text-[15px]"
        }
      >
        <SelectValue
          placeholder={props.placeholder ?? "Choose where it goes"}
        />
      </SelectTrigger>
      {/* Popper, not item-aligned: aligning to the selected item scrolls a long list back up. */}
      <SelectContent position="popper" className="max-h-72">
        {o.pairs && (
          <SelectGroup>
            <SelectLabel>Two copies</SelectLabel>
            {(Object.keys(PAIRS) as Pair[]).map((k) => (
              <SelectItem key={k} value={`pair:${k}`}>
                {PAIRS[k].label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {o.pairs && o.one && <SelectSeparator />}
        {o.one && (
          <SelectGroup>
            <SelectLabel>{o.pairs ? "One copy" : "On the body"}</SelectLabel>
            {(Object.keys(PLACES) as Place[]).map((k) => (
              <SelectItem key={k} value={`one:${k}`}>
                {PLACES[k].label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {o.on.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>On top of another piece</SelectLabel>
              {o.on.map((x) => (
                <SelectItem key={x.key} value={`on:${x.key}`}>
                  On the {x.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        {(o.flat || o.leave) && <SelectSeparator />}
        {o.flat && <SelectItem value="flat">Import as it is</SelectItem>}
        {o.leave && <SelectItem value="leave">Leave it out</SelectItem>}
      </SelectContent>
    </Select>
  );
}
