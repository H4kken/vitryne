// SPDX-License-Identifier: AGPL-3.0-or-later
// One row of the Layers view: a cut with its colour, where it starts and how far out the stack
// puts it. A cut on the body can be dragged (or moved with Alt + arrow keys); one placed on
// another goes with it and is nested under it.

import { GripVertical } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface LayerRowProps {
  name: string;
  color: string;
  where: string;
  /** How far out it starts ("+12 mm"), when the engine has said. */
  out: string | null;
  /** 0: on the body; more: placed on another cut. */
  depth: number;
  selected: boolean;
  /** A line shows where a drop would put the dragged cut: outside this one or inside it. */
  drop: "outer" | "inner" | null;
  dragging: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  /** Alt + arrow: one cut outwards (1) or inwards (-1). */
  onStep: (dir: 1 | -1) => void;
  drag?: {
    onStart: (e: DragEvent) => void;
    onEnd: () => void;
    onOver: (e: DragEvent) => void;
    onLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
}

export function LayerRow(p: LayerRowProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.altKey || p.depth > 0) return;
    if (e.key === "ArrowUp") p.onStep(1);
    else if (e.key === "ArrowDown") p.onStep(-1);
    else return;
    e.preventDefault();
  };
  return (
    <button
      type="button"
      draggable={!!p.drag}
      aria-pressed={p.selected}
      aria-keyshortcuts={p.depth ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
      onClick={p.onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={() => p.onHover(true)}
      onPointerLeave={() => p.onHover(false)}
      onFocus={() => p.onHover(true)}
      onBlur={() => p.onHover(false)}
      onDragStart={p.drag?.onStart}
      onDragEnd={p.drag?.onEnd}
      onDragOver={p.drag?.onOver}
      onDragLeave={p.drag?.onLeave}
      onDrop={p.drag?.onDrop}
      style={{
        marginLeft: p.depth * 20,
        width: `calc(100% - ${p.depth * 20}px)`,
      }}
      className={cn(
        "relative flex items-start gap-1 rounded-[10px] border-[1.5px] border-transparent py-2 pr-3 pl-1 text-left hover:bg-hover",
        p.selected && "border-select bg-select/10 hover:bg-select/10",
        p.dragging && "opacity-40",
      )}
    >
      {p.drop && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-1.5 h-[3px] rounded bg-select",
            p.drop === "outer" ? "-top-[3px]" : "-bottom-[3px]",
          )}
        />
      )}
      <GripVertical
        aria-hidden
        className={cn(
          "text-faint mt-0.5 size-4 shrink-0",
          p.drag ? "cursor-grab" : "invisible",
        )}
      />
      <span
        aria-hidden
        className="mt-1 size-3 shrink-0 rounded-full border border-black/10"
        style={{ background: p.color }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
          {p.name}
        </span>
        <span className="text-muted-foreground text-[13px]">{p.where}</span>
      </span>
      {p.out && (
        <span
          title="How far out it starts"
          className="text-muted-foreground shrink-0 pt-0.5 text-xs tabular-nums"
        >
          {p.out}
        </span>
      )}
    </button>
  );
}
