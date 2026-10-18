// SPDX-License-Identifier: AGPL-3.0-or-later
// The marks tool's bar, over the flat view: what a click adds (an internal line, a notch, a
// fold or the grain line), how to do it, and for a line being drawn Finish, Undo and Cancel; a
// picked line or fold can be deleted, a picked grain line reset to the default (+y).

import { RotateCcw, Trash2, Undo2 } from "lucide-react";
import { BarSegment } from "./BarSegment";
import { BarDivider } from "./BarDivider";
import { MarkAction } from "./MarkAction";

export type MarkKind = "line" | "notch" | "fold" | "grain";

const KINDS: { kind: MarkKind; label: string; hint: string }[] = [
  {
    kind: "line",
    label: "Line",
    hint: "Click inside a piece to draw a line, drag for a curve · Enter or double-click finishes",
  },
  {
    kind: "notch",
    label: "Notch",
    hint: "Click the outline to add a notch, or a point to make it one",
  },
  {
    kind: "fold",
    label: "Fold",
    hint: "Click two points of a piece's outline: the fold runs between them",
  },
  {
    kind: "grain",
    label: "Grain",
    hint: "Drag across a piece along its grain (the fabric's warp)",
  },
];

const PICKED = { line: "A line", fold: "A fold", grain: "The grain line" };

export function MarkBar(props: {
  kind: MarkKind;
  onKind: (k: MarkKind) => void;
  /** A line being drawn: how many points it has so far. */
  drawing?: {
    points: number;
    onFinish: () => void;
    onUndo: () => void;
    onCancel: () => void;
  };
  /** A fold waiting for its second point. */
  folding?: { onCancel: () => void };
  /** An existing mark picked by a click. */
  picked?: { what: "line" | "fold" | "grain"; onRemove: () => void };
  warning?: string;
}) {
  const hint = KINDS.find((k) => k.kind === props.kind)?.hint;
  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-32px)] flex-col items-center gap-1.5">
      {props.warning && (
        <div
          role="status"
          className="rounded-lg bg-[#FCE9E9] px-3 py-1 text-[13px] font-medium text-[#A12C2C]"
        >
          {props.warning}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-0.5 rounded-[12px] border border-[#E1E4DE] bg-white p-1 shadow-[0_4px_16px_rgba(20,24,31,.08)]">
        {KINDS.map((k) => (
          <BarSegment
            key={k.kind}
            on={props.kind === k.kind}
            onClick={() => props.onKind(k.kind)}
          >
            {k.label}
          </BarSegment>
        ))}
        <BarDivider />
        {props.drawing ? (
          <>
            <span className="px-1.5 text-[13px] text-[#4A514B]">
              {props.drawing.points < 2
                ? "Click the next point"
                : `${props.drawing.points} points`}
            </span>
            <MarkAction
              onClick={props.drawing.onFinish}
              disabled={props.drawing.points < 2}
              title="Finish the line (Enter)"
            >
              Finish
            </MarkAction>
            <MarkAction
              onClick={props.drawing.onUndo}
              title="Take the last point back (Backspace)"
            >
              <Undo2 className="size-4" />
            </MarkAction>
            <MarkAction onClick={props.drawing.onCancel} title="Cancel (Esc)">
              Cancel
            </MarkAction>
          </>
        ) : props.folding ? (
          <>
            <span className="px-1.5 text-[13px] text-[#4A514B]">
              Now click the fold's other end
            </span>
            <MarkAction onClick={props.folding.onCancel} title="Cancel (Esc)">
              Cancel
            </MarkAction>
          </>
        ) : props.picked ? (
          <>
            <span className="px-1.5 text-[13px] text-[#4A514B]">
              {PICKED[props.picked.what]}
            </span>
            {props.picked.what === "grain" ? (
              <MarkAction
                onClick={props.picked.onRemove}
                title="Back to the default: the piece's +y (Delete)"
              >
                <RotateCcw className="size-4" /> Reset
              </MarkAction>
            ) : (
              <MarkAction
                onClick={props.picked.onRemove}
                title="Delete (Delete)"
              >
                <Trash2 className="size-4" /> Delete
              </MarkAction>
            )}
          </>
        ) : (
          <span className="px-2 py-1.5 text-[13px] text-[#4A514B]">{hint}</span>
        )}
      </div>
    </div>
  );
}
