// SPDX-License-Identifier: AGPL-3.0-or-later
// What the selected row of the Layers view can change: how much further out than the stack puts
// it the cut starts (its lift off the cut it is placed on). It sits inside the row's frame; the
// arrows that move the row in the stack are on the row.

import { Minus, Plus } from "lucide-react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { setOffset } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Cut, Garment } from "@/format/schema.gen";
import { formatNumber } from "../formatNumber";
import { useDraft } from "../useDraft";

const MAX = 60;
const stepClass =
  "hover:bg-chip grid h-full w-7 place-items-center disabled:opacity-35 disabled:hover:bg-transparent";

export function LayerControls(props: {
  store: DocumentStore;
  garment: Garment;
  cut: Cut;
}) {
  const { store, garment, cut } = props;
  const id = useId();
  const p = cut.placement;
  const value = p.type === "follow" ? (p.lift ?? 0) : (p.offset ?? 0);
  const d = useDraft(formatNumber(value));
  const set = (mm: number) =>
    store.execute((e) => setOffset(e, garment.id, cut.id, mm));
  const commit = () => {
    if (d.editing) {
      // An empty or unreadable box gives NaN, which the command refuses (and says so).
      const t = d.text.trim().replace(",", ".");
      set(t === "" ? Number.NaN : Number(t));
    }
    d.clear();
  };
  const by = (mm: number) => set(Math.min(MAX, Math.max(0, value + mm)));
  return (
    <div className="flex items-center justify-between gap-2 pr-2.5 pb-2.5 pl-[34px]">
      <label htmlFor={id} className="text-[14px] font-semibold leading-tight">
        {p.type === "follow" ? "Lifted off it" : "Start further out"}
      </label>
      <div className="border-border-strong bg-card flex h-8 items-center overflow-hidden rounded-lg border">
        <button
          type="button"
          aria-label="Less"
          disabled={value <= 0}
          onClick={() => by(-1)}
          className={stepClass}
        >
          <Minus className="size-3.5" />
        </button>
        <Input
          id={id}
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
          className="h-full w-12 rounded-none border-0 bg-transparent px-1 text-right text-[13px] tabular-nums shadow-none focus-visible:ring-0"
        />
        <span className="text-muted-foreground pr-1.5 pl-0.5 text-xs">mm</span>
        <button
          type="button"
          aria-label="More"
          disabled={value >= MAX}
          onClick={() => by(1)}
          className={stepClass}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
