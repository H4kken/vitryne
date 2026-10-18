// SPDX-License-Identifier: AGPL-3.0-or-later
// The pen tool's bar, over the flat view: how to draw, then the edge being drawn's length and
// angle (typing either and pressing Enter puts the next point there), Undo point, Close and
// Cancel. The length is of the piece being drawn only: nothing here compares pieces or snaps to
// another piece's length (docs/PATENTS.md).

import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";
import { DrawNumberField } from "./DrawNumberField";
import { BarButton } from "./BarButton";

const parseDecimal = (v: string | null) => Number(v?.replace(",", "."));

export function DrawBar(props: {
  /** Points put down so far. */
  points: number;
  /** The edge being drawn, from the last point to the pointer: mm and degrees (as seen). */
  length: number;
  angle: number;
  warning?: string;
  /** The next point, `mm` from the last one at `degrees`. */
  onPlace: (mm: number, degrees: number) => void;
  onUndo: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const [length, setLength] = useState<string | null>(null);
  const [angle, setAngle] = useState<string | null>(null);
  const place = () => {
    const mm = length === null ? props.length : parseDecimal(length);
    const deg = angle === null ? props.angle : parseDecimal(angle);
    if (!(Number.isFinite(mm) && mm > 0 && Number.isFinite(deg))) return;
    props.onPlace(mm, deg);
    setLength(null);
    setAngle(null);
  };
  return (
    // The bar's own pointer events don't reach the view (they would put points down).
    <div
      className="pointer-events-auto flex max-w-[calc(100vw-32px)] flex-col items-center gap-1.5"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {props.warning && (
        <div
          role="status"
          className="rounded-lg bg-[#FCE9E9] px-3 py-1 text-[13px] font-medium text-[#A12C2C]"
        >
          {props.warning}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-1 rounded-[12px] border border-[#E1E4DE] bg-white p-1 shadow-[0_4px_16px_rgba(20,24,31,.08)]">
        {props.points === 0 ? (
          <span className="px-2 py-1.5 text-[13px] text-[#4A514B]">
            Click to put a point down, drag for a curve · Shift: 15° steps ·
            Alt: no snapping
          </span>
        ) : (
          <>
            <DrawNumberField
              label="Length"
              unit="mm"
              value={props.length}
              draft={length}
              onDraft={setLength}
              onEnter={place}
            />
            <DrawNumberField
              label="Angle"
              unit="°"
              value={props.angle}
              draft={angle}
              onDraft={setAngle}
              onEnter={place}
            />
            <span className="mx-1 h-5 w-px bg-[#E1E4DE]" />
            <BarButton
              onClick={props.onUndo}
              title="Take the last point back (Backspace)"
            >
              <Undo2 className="size-4" /> Undo point
            </BarButton>
            <BarButton
              onClick={props.onClose}
              disabled={props.points < 3}
              title="Close the piece (Enter, or click the first point)"
            >
              <Check className="size-4" /> Close
            </BarButton>
            <BarButton
              onClick={props.onCancel}
              title="Stop drawing this piece (Esc)"
            >
              <X className="size-4" /> Cancel
            </BarButton>
          </>
        )}
      </div>
    </div>
  );
}
