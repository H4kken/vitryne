// SPDX-License-Identifier: AGPL-3.0-or-later
// The measurements a Valentina pattern was drafted with: its points are formulas over them,
// kept in a separate file (.vit or .smis for one person, .vst or .smms for a size chart) that the pattern names.
// The import asks for that file by name, and offers a size chart's sizes.

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const input = useRef<HTMLInputElement>(null);
  const pick = (
    <>
      <input
        ref={input}
        type="file"
        accept=".vit,.vst,.smis,.smms"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            void f.text().then((text) => props.onFile({ name: f.name, text }));
        }}
      />
      <Button
        variant={props.file ? "ghost" : "outline"}
        size="sm"
        onClick={() => input.current?.click()}
      >
        {props.file ? "Replace…" : `Add ${props.needed ?? "measurements"}…`}
      </Button>
    </>
  );
  const current = props.size ?? props.sizes.map((d) => d.base);
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-secondary/50 p-4 text-foreground text-[14px] leading-snug">
      <span className="font-semibold">Measurements</span>
      {props.file ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow">From {props.file.name}.</span>
          {pick}
        </div>
      ) : props.needed ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body-text grow">
            This pattern is drafted from the measurements in{" "}
            <strong>{props.needed}</strong>. Add that file to see its pieces.
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
