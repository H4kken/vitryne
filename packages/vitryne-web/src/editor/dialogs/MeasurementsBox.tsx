// SPDX-License-Identifier: AGPL-3.0-or-later
// The measurements a Valentina pattern was drafted with: its points are formulas over them,
// kept in a separate file (.vit or .smis for one person, .vst or .smms for a size chart) that the pattern names.
// The import asks for that file by name, and offers a size chart's sizes.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanionPicker } from "./CompanionPicker";
import type { SizeOption, TextFile } from "./ImportDialog";

export function MeasurementsBox(props: {
  /** The file the pattern names (its name only), or null if it needs none. */
  needed: string | null;
  file: TextFile | null;
  onFile: (f: TextFile) => void;
  /** A size chart's dimensions, once read. */
  sizes: SizeOption[];
  size: number[] | null;
  onSize: (size: number[]) => void;
}) {
  const pick = (
    <CompanionPicker
      kind="drafted"
      variant={props.file ? "ghost" : "outline"}
      label={props.file ? "Replace…" : `Add ${props.needed ?? "measurements"}…`}
      onFile={props.onFile}
    />
  );
  const current = props.size ?? props.sizes.map((d) => d.base);
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-secondary/50 p-4 text-foreground text-[14px] leading-snug">
      <span className="font-semibold">Measurements</span>
      {props.file ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow">
            From {props.file.name}.
            {props.needed &&
              props.needed.toLowerCase() !== props.file.name.toLowerCase() && (
                <span className="text-danger block">
                  The pattern names {props.needed}; if the pieces fail below,
                  this may be another person's file.
                </span>
              )}
          </span>
          {pick}
        </div>
      ) : props.needed ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body-text grow">
            This pattern is drafted from the measurements in{" "}
            <strong>{props.needed}</strong>. Drop that file here or choose it to
            see its pieces.
          </span>
          {pick}
        </div>
      ) : (
        <span className="text-body-text">
          This pattern needs no measurements file.
        </span>
      )}
      {props.sizes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {props.sizes.map((d, k) => (
            <label key={d.label} className="flex items-center gap-2">
              <span className="capitalize">{d.label}</span>
              <Select
                value={String(current[k])}
                onValueChange={(v) =>
                  props.onSize(current.map((x, j) => (j === k ? Number(v) : x)))
                }
              >
                <SelectTrigger className="h-9 w-[110px] rounded-[10px] bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {d.values.map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v}
                      {v === d.base ? " (base)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
