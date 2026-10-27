// SPDX-License-Identifier: AGPL-3.0-or-later
// What the selected row of the Layers view can change: how much further out than the stack puts
// it the cut starts (its lift off the cut it is placed on), and one step out or in.

import { setOffset } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Cut, Garment } from "@/format/schema.gen";
import { NumberField } from "../NumberField";

const buttonClass =
  "border-input hover:border-foreground h-9 rounded-[10px] border bg-card px-3.5 text-[14px] font-semibold disabled:opacity-40 disabled:hover:border-input";

export function LayerControls(props: {
  store: DocumentStore;
  garment: Garment;
  cut: Cut;
  /** One step outwards and inwards are possible (a cut on the body only). */
  step?: { out: boolean; in: boolean; onStep: (dir: 1 | -1) => void };
}) {
  const { store, garment, cut, step } = props;
  const p = cut.placement;
  const value = p.type === "follow" ? (p.lift ?? 0) : (p.offset ?? 0);
  const gesture = `offset:${cut.id}`;
  return (
    <div className="flex flex-col gap-3 pt-2 pr-2 pb-1 pl-8">
      <NumberField
        label={p.type === "follow" ? "Lifted off it" : "Start further out"}
        unit="mm"
        value={value}
        min={0}
        max={60}
        step={1}
        onChange={(v, dragging) => {
          if (dragging) store.beginGesture(gesture);
          store.execute((e) => setOffset(e, garment.id, cut.id, v, gesture));
        }}
        onDragEnd={() => store.endGesture()}
      />
      {step && (
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!step.out}
            onClick={() => step.onStep(1)}
          >
            Move out
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!step.in}
            onClick={() => step.onStep(-1)}
          >
            Move in
          </button>
        </div>
      )}
    </div>
  );
}
