// SPDX-License-Identifier: AGPL-3.0-or-later
// One row of the Layers view: a cut with its colour, where it starts and how far out the stack
// puts it. A cut on the body can be dragged, moved with the arrows (shown on hover, focus and
// selection) or with Alt + arrow keys; one placed on another goes with it and is nested under it.
// `children` (the selected row's distance field) sit inside the row's frame, under its header.

import { ArrowDown, ArrowUp } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
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
  /** One cut outwards (1) or inwards (-1), and whether each is possible; only on the body. */
  step?: { out: boolean; in: boolean; onStep: (dir: 1 | -1) => void };
  drag?: {
    onStart: (e: DragEvent) => void;
    onEnd: () => void;
    onOver: (e: DragEvent) => void;
    onLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
  children?: ReactNode;
}

const arrowClass =
  "text-muted-foreground hover:text-foreground hover:bg-chip grid size-6 place-items-center rounded-md disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

export function LayerRow(p: LayerRowProps) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.altKey || !p.step) return;
    if (e.key === "ArrowUp") p.step.onStep(1);
    else if (e.key === "ArrowDown") p.step.onStep(-1);
    else return;
    e.preventDefault();
  };
  return (
    <div
      onPointerEnter={() => p.onHover(true)}
      onPointerLeave={() => p.onHover(false)}
      onFocus={() => p.onHover(true)}
      onBlur={() => p.onHover(false)}
      style={{
        marginLeft: p.depth * 20,
        width: `calc(100% - ${p.depth * 20}px)`,
      }}
      className={cn(
        "group relative rounded-[10px] border-[1.5px] border-transparent hover:bg-hover",
        p.selected && "border-select bg-select/10 hover:bg-select/10",
        p.dragging && "opacity-40",
      )}
    >
      <div
        draggable={!!p.drag}
        onDragStart={p.drag?.onStart}
        onDragEnd={p.drag?.onEnd}
        onDragOver={p.drag?.onOver}
        onDragLeave={p.drag?.onLeave}
        onDrop={p.drag?.onDrop}
        className="relative flex items-start gap-1 py-2 pr-2 pl-1"
      >
        {p.drop && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-1.5 h-[3px] rounded bg-select",
              p.drop === "outer" ? "-top-[3px]" : "-bottom-[3px]",
            )}
          />
        )}
        <button
          type="button"
          aria-pressed={p.selected}
          aria-keyshortcuts={p.step ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          onClick={p.onSelect}
          onKeyDown={onKeyDown}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-1 rounded-md pl-1.5 text-left",
            p.drag && "cursor-grab active:cursor-grabbing",
          )}
        >
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full border border-black/10"
            style={{ background: p.color }}
          />
          <span className="flex min-w-0 flex-1 flex-col pl-0.5">
            <span className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">
              {p.name}
            </span>
            <span className="text-muted-foreground text-[13px]">{p.where}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {p.step && (
            <div
              className={cn(
                "-mt-0.5 -mr-1 flex gap-0.5",
                !p.selected &&
                  "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
              )}
            >
              <button
                type="button"
                aria-label="Move out"
                title="Move out (Alt + Up)"
                disabled={!p.step.out}
                onClick={() => p.step?.onStep(1)}
                className={arrowClass}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Move in"
                title="Move in (Alt + Down)"
                disabled={!p.step.in}
                onClick={() => p.step?.onStep(-1)}
                className={arrowClass}
              >
                <ArrowDown className="size-4" />
              </button>
            </div>
          )}
          {p.out && (
            <span
              title="How far out it starts"
              className="text-muted-foreground text-xs tabular-nums"
            >
              {p.out}
            </span>
          )}
        </div>
      </div>
      {p.children}
    </div>
  );
}
