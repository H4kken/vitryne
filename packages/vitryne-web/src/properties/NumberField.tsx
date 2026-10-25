// SPDX-License-Identifier: AGPL-3.0-or-later
// A number that edits the document: it keeps a draft while typing and commits on Enter or when
// it loses focus (Escape drops the draft); its slider commits as it moves, inside one gesture,
// so a whole drag is one undo step.

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useDraft } from "./useDraft";
import { formatNumber } from "./formatNumber";

export interface NumberFieldProps {
  label: string;
  unit: string;
  /** In the file's unit. */
  value: number;
  /** Shown = value × scale (e.g. kg/m² shown as g/m²). */
  scale?: number;
  /** Slider range, in shown units. */
  min: number;
  max: number;
  log?: boolean;
  step?: number;
  /** What the two ends of the slider mean, in plain words. */
  ends?: [string, string];
  integer?: boolean;
  /** A value from the slider (during a drag) or the box. */
  onChange: (value: number, dragging: boolean) => void;
  onDragEnd?: () => void;
}

export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const scale = p.scale ?? 1;
  const shown = p.value * scale;
  // Back to stored units; a scale below 1 multiplies, so 1400 kN/m is exactly 1400000 N/m.
  const stored = (v: number) =>
    scale < 1 ? v * Math.round(1 / scale) : v / scale;
  const d = useDraft(formatNumber(shown));
  const toSlider = (v: number) => (p.log ? Math.log10(Math.max(v, p.min)) : v);
  const fromSlider = (s: number) => (p.log ? 10 ** s : s);
  const commit = () => {
    if (d.editing) {
      // An empty or unreadable box gives NaN, which the command refuses (and says so).
      const t = d.text.trim().replace(",", ".");
      p.onChange(stored(t === "" ? Number.NaN : Number(t)), false);
    }
    d.clear();
  };
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[15px] font-semibold">
          {p.label}
        </Label>
        <div className="flex items-center gap-1.5">
          <Input
            id={id}
            className="h-8 w-20 rounded-lg border-border-strong bg-card px-2 text-right text-[13px] tabular-nums shadow-none"
            inputMode="decimal"
            value={d.text}
            onChange={(e) => d.setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                d.clear();
                e.currentTarget.blur();
              }
            }}
          />
          {p.unit && (
            <span className="text-muted-foreground min-w-9 text-xs">
              {p.unit}
            </span>
          )}
        </div>
      </div>
      <Slider
        className="h-7"
        min={toSlider(p.min)}
        max={toSlider(p.max)}
        step={
          p.log
            ? (toSlider(p.max) - toSlider(p.min)) / 400
            : (p.step ?? (p.max - p.min) / 400)
        }
        value={[
          Math.min(Math.max(toSlider(shown), toSlider(p.min)), toSlider(p.max)),
        ]}
        onValueChange={([s]) => {
          if (s === undefined) return;
          let v = fromSlider(s);
          v = p.integer ? Math.round(v) : Number(v.toPrecision(4));
          p.onChange(stored(v), true);
        }}
        onValueCommit={() => p.onDragEnd?.()}
        aria-label={p.label}
      />
      {p.ends && (
        <div className="text-muted-foreground flex justify-between text-[13px]">
          <span>{p.ends[0]}</span>
          <span>{p.ends[1]}</span>
        </div>
      )}
    </div>
  );
}
