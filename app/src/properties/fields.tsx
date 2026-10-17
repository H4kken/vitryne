// SPDX-License-Identifier: AGPL-3.0-or-later
// Inputs that edit the document. A text or number field keeps a draft while typing and
// commits on Enter or when it loses focus (Escape drops the draft); a slider commits as it
// moves, inside one gesture, so a whole drag is one undo step.

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { COLOR_SWATCHES, colorName } from "@/format/colors";

/** Up to 4 significant digits, never in exponent notation (a field shows "1400", not "1.400e+3"). */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // en-US without grouping: what the field reads back (`Number`), whatever the browser's language.
  return Number(v.toPrecision(4)).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
}

function useDraft(value: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    text: draft ?? value,
    editing: draft !== null,
    setDraft,
    clear: () => setDraft(null),
  };
}

export function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const id = useId();
  const d = useDraft(props.value);
  const commit = () => {
    if (d.editing && d.text !== props.value) props.onCommit(d.text);
    d.clear();
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {props.label}
      </Label>
      <Input
        id={id}
        className="h-11 rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-card px-3 text-[15px] shadow-none"
        value={d.text}
        placeholder={props.placeholder}
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
    </div>
  );
}

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
            className="h-8 w-20 rounded-lg border-[#D5D9D1] bg-card px-2 text-right text-[13px] tabular-nums shadow-none"
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

/**
 * A colour: swatches, and any other from the system's picker (its drag is one gesture,
 * `onPick(c, true)` until `onDragEnd`). `value` is the target's own colour, `shown` what it
 * looks like without one; `onReset` takes its own away.
 */
export function ColorField(props: {
  label: string;
  value: string | undefined;
  shown: string;
  onPick: (color: string, dragging: boolean) => void;
  onDragEnd: () => void;
  onReset?: { label: string; run: () => void };
}) {
  const current = props.value ?? props.shown;
  const custom =
    props.value !== undefined &&
    !COLOR_SWATCHES.some((s) => s.color === props.value);
  const pick = (c: string, dragging: boolean) => {
    if (c !== props.value) props.onPick(c, dragging);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="size-7 shrink-0 rounded-full border border-black/10"
          style={{ background: current }}
        />
        <span className="text-[15px] font-semibold">{props.label}</span>
        <span className="text-muted-foreground text-[13px]">
          {props.value ? colorName(props.value) : "None yet"}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={props.label}
        className="grid grid-cols-7 gap-1.5"
      >
        {COLOR_SWATCHES.map((s) => (
          <button
            key={s.color}
            type="button"
            role="radio"
            aria-checked={props.value === s.color}
            aria-label={s.name}
            title={s.name}
            onClick={() => pick(s.color, false)}
            className={`aspect-square w-full rounded-full border border-black/10 transition-shadow ${
              props.value === s.color
                ? "ring-2 ring-[#14181F] ring-offset-2"
                : "hover:ring-2 hover:ring-[#B5B9B0] hover:ring-offset-1"
            }`}
            style={{ background: s.color }}
          />
        ))}
        <label
          title="Any colour"
          className={`relative flex aspect-square w-full cursor-pointer items-center justify-center rounded-full border border-black/10 ${
            custom
              ? "ring-2 ring-[#14181F] ring-offset-2"
              : "hover:ring-2 hover:ring-[#B5B9B0] hover:ring-offset-1"
          }`}
          style={{
            background: custom
              ? props.value
              : "conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)",
          }}
        >
          <span className="sr-only">Any colour</span>
          <input
            type="color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={current}
            onChange={(e) => pick(e.target.value, true)}
            onBlur={props.onDragEnd}
          />
        </label>
      </div>
      {props.onReset && props.value !== undefined && (
        <button
          type="button"
          onClick={props.onReset.run}
          className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
        >
          {props.onReset.label}
        </button>
      )}
    </div>
  );
}
