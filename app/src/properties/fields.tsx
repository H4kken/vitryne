// SPDX-License-Identifier: AGPL-3.0-or-later
// Inputs that edit the document. A text or number field keeps a draft while typing and
// commits on Enter or when it loses focus (Escape drops the draft); a slider commits as it
// moves, inside one gesture, so a whole drag is one undo step.

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

/** Up to 4 significant digits, no exponent for everyday sizes. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) return v.toPrecision(4);
  return String(Number(v.toPrecision(4)));
}

function useDraft(value: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return { text: draft ?? value, editing: draft !== null, setDraft, clear: () => setDraft(null) };
}

export function TextField(props: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const id = useId();
  const d = useDraft(props.value);
  const commit = () => {
    if (d.editing && d.text !== props.value) props.onCommit(d.text);
    d.clear();
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {props.label}
      </Label>
      <Input
        id={id}
        className="h-8"
        value={d.text}
        placeholder={props.placeholder}
        onChange={(e) => d.setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
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
  integer?: boolean;
  /** A value from the slider (during a drag) or the box. */
  onChange: (value: number, dragging: boolean) => void;
  onDragEnd?: () => void;
}

export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const scale = p.scale ?? 1;
  const shown = p.value * scale;
  const d = useDraft(formatNumber(shown));
  const toSlider = (v: number) => (p.log ? Math.log10(Math.max(v, p.min)) : v);
  const fromSlider = (s: number) => (p.log ? 10 ** s : s);
  const commit = () => {
    if (d.editing) {
      // An empty or unreadable box gives NaN, which the command refuses (and says so).
      const t = d.text.trim().replace(',', '.');
      p.onChange((t === '' ? Number.NaN : Number(t)) / scale, false);
    }
    d.clear();
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-muted-foreground text-xs">
          {p.label}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            className="h-7 w-24 px-2 text-right text-xs tabular-nums"
            inputMode="decimal"
            value={d.text}
            onChange={(e) => d.setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                d.clear();
                e.currentTarget.blur();
              }
            }}
          />
          <span className="text-muted-foreground w-12 text-xs">{p.unit}</span>
        </div>
      </div>
      <Slider
        min={toSlider(p.min)}
        max={toSlider(p.max)}
        step={p.log ? (toSlider(p.max) - toSlider(p.min)) / 400 : (p.step ?? (p.max - p.min) / 400)}
        value={[Math.min(Math.max(toSlider(shown), toSlider(p.min)), toSlider(p.max))]}
        onValueChange={([s]) => {
          if (s === undefined) return;
          let v = fromSlider(s);
          v = p.integer ? Math.round(v) : Number(v.toPrecision(4));
          p.onChange(v / scale, true);
        }}
        onValueCommit={() => p.onDragEnd?.()}
        aria-label={p.label}
      />
    </div>
  );
}
