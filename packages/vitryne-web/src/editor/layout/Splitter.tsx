// SPDX-License-Identifier: AGPL-3.0-or-later
import { GripVertical } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SplitView } from "../hooks/useSplitView";

/**
 * Between the 2D and 3D views while both show: drag to resize, click to toggle between a few
 * splits, double-click to center; the arrow keys move it too.
 */
export function Splitter({ view }: { view: SplitView }) {
  const {
    show2d,
    show3d,
    splitRatio,
    setSplitRatio,
    startResize,
    toggleSplit,
    isResizing,
    hasDragged,
  } = view;
  return (
    <div
      key="window-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(splitRatio * 100)}
      aria-label="Resize 2D and 3D views"
      aria-hidden={!(show2d && show3d)}
      tabIndex={show2d && show3d ? 0 : -1}
      onPointerDown={show2d && show3d ? startResize : undefined}
      onDoubleClick={
        show2d && show3d
          ? (e) => {
              e.stopPropagation();
              setSplitRatio(0.5);
            }
          : undefined
      }
      onKeyDown={
        show2d && show3d
          ? (e) => {
              if (e.key === "ArrowLeft") {
                setSplitRatio((r) => Math.max(0.15, r - 0.05));
              } else if (e.key === "ArrowRight") {
                setSplitRatio((r) => Math.min(0.85, r + 0.05));
              } else if (e.key === "Enter" || e.key === " ") {
                toggleSplit();
              }
            }
          : undefined
      }
      className={cn(
        "group relative z-20 flex w-0 shrink-0 cursor-col-resize select-none items-center justify-center focus:outline-hidden",
        show2d && show3d
          ? "opacity-100 scale-100"
          : "pointer-events-none opacity-0 scale-90",
        isResizing
          ? "transition-none"
          : "transition-[opacity,transform] duration-250 ease-in-out",
      )}
    >
      {/* Visible border line */}
      <div
        className={cn(
          "absolute inset-y-0 -left-px w-px transition-colors",
          isResizing
            ? "bg-primary w-0.5 -left-[1px]"
            : "bg-[#E1E4DE] group-hover:bg-primary/50 group-hover:w-0.5 group-hover:-left-[1px]",
        )}
      />

      {/* Invisible wider hit area for easy grabbing */}
      <div className="absolute inset-y-0 -left-2 w-4 cursor-col-resize" />

      {/* Centered toggle / grip pill */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Resize or toggle view split"
            disabled={!(show2d && show3d)}
            onClick={(e) => {
              e.stopPropagation();
              if (!hasDragged.current) toggleSplit();
            }}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 z-30 flex h-10 w-4 items-center justify-center rounded-full border border-[#E1E4DE] bg-white shadow-xs transition-all",
              "group-hover:scale-110 group-hover:border-foreground/30 group-hover:bg-[#F4F5F2]",
              isResizing &&
                "scale-110 border-primary bg-primary text-primary-foreground shadow-sm",
            )}
          >
            <GripVertical
              className={cn(
                "size-3 transition-colors",
                isResizing
                  ? "text-primary-foreground"
                  : "text-muted-foreground group-hover:text-foreground",
              )}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          Drag to resize · Click to toggle layout · Double-click to center
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
