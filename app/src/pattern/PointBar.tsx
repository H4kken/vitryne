// SPDX-License-Identifier: AGPL-3.0-or-later
// The point tool's bar, over the flat view: for a selected point, its type and Delete; for a
// selected edge, straight or curve, its length and angle (a straight edge's length can be
// typed: its end point moves along it) and Add point. Lengths are of this piece's own edge
// only: nothing here compares pieces (docs/PATENTS.md, rule 5).

import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { OutlineNode } from "@/format/schema.gen";
import { cn } from "@/lib/utils";

export type EdgeKind = "straight" | "curve" | "traced";

function Segment(props: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-pressed={props.on}
      onClick={props.onClick}
      className={cn(
        "h-8 rounded-lg px-2.5 text-[13px] font-medium",
        props.on ? "bg-[#14181F] text-white" : "hover:bg-[#F4F5F2]",
      )}
    >
      {props.children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-[#E1E4DE]" />;
}

/** A length in mm: drafted while typing, committed on Enter or leaving the field. */
function LengthField(props: { value: number; onCommit: (mm: number) => void }) {
  const shown = props.value.toFixed(1);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = Number(draft?.replace(",", "."));
    if (draft !== null && draft !== shown && Number.isFinite(v) && v > 0)
      props.onCommit(v);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[#4A514B]">
      Length
      <input
        aria-label="Edge length, mm"
        inputMode="decimal"
        className="h-8 w-20 rounded-lg border-[1.5px] border-[#D5D9D1] bg-white px-2 text-right text-[13px] text-[#14181F] tabular-nums"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      mm
    </label>
  );
}

const TYPES: { type: OutlineNode["type"]; label: string; title: string }[] = [
  {
    type: "corner",
    label: "Corner",
    title: "The outline turns here; edges to sew run from corner to corner",
  },
  { type: "notch", label: "Notch", title: "An alignment notch" },
  { type: "point", label: "Point", title: "A plain point along an edge" },
];

export function PointBar(
  props:
    | { kind: "hint"; warning?: string }
    | {
        kind: "node";
        type: OutlineNode["type"];
        onType: (t: OutlineNode["type"]) => void;
        onDelete: () => void;
        warning?: string;
      }
    | {
        kind: "edge";
        edge: EdgeKind;
        length: number;
        /** Degrees, as seen in the view; for a straight edge only. */
        angle?: number;
        onStraight: () => void;
        onCurve: () => void;
        onLength: (mm: number) => void;
        onAddPoint: () => void;
        warning?: string;
      },
) {
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
        {props.kind === "hint" && (
          <span className="px-2 py-1.5 text-[13px] text-[#4A514B]">
            Drag a point to move it · double-click an edge to add one
          </span>
        )}
        {props.kind === "node" && (
          <>
            {TYPES.map((t) => (
              <Segment
                key={t.type}
                on={props.type === t.type}
                title={t.title}
                onClick={() => props.type !== t.type && props.onType(t.type)}
              >
                {t.label}
              </Segment>
            ))}
            <Divider />
            <button
              type="button"
              onClick={props.onDelete}
              title="Delete the point (Delete)"
              className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium hover:bg-[#F4F5F2]"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          </>
        )}
        {props.kind === "edge" && (
          <>
            <Segment
              on={props.edge === "straight"}
              onClick={() => props.edge !== "straight" && props.onStraight()}
            >
              Straight
            </Segment>
            <Segment
              on={props.edge === "curve"}
              title="A curve with two handles to drag"
              onClick={() => props.edge !== "curve" && props.onCurve()}
            >
              Curve
            </Segment>
            <Divider />
            {props.edge === "straight" ? (
              <LengthField value={props.length} onCommit={props.onLength} />
            ) : (
              <span className="px-1.5 text-[13px] text-[#4A514B] tabular-nums">
                Length {props.length.toFixed(1)} mm
              </span>
            )}
            {props.angle !== undefined && (
              <span className="px-1.5 text-[13px] text-[#4A514B] tabular-nums">
                {props.angle.toFixed(1)}°
              </span>
            )}
            <Divider />
            <button
              type="button"
              onClick={props.onAddPoint}
              title="Add a point in the middle (or double-click the edge)"
              className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium hover:bg-[#F4F5F2]"
            >
              <Plus className="size-4" /> Add point
            </button>
          </>
        )}
      </div>
    </div>
  );
}
