// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ToolButton(props: {
  label: string;
  selected?: boolean;
  /** Flashes the button to draw the eye to it. */
  flash?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          aria-pressed={props.selected}
          onClick={props.onClick}
          className={cn(
            "flex size-11 items-center justify-center rounded-[10px]",
            props.flash &&
              "animate-pulse bg-amber-400 text-neutral-900 ring-2 ring-amber-300 hover:bg-amber-400",
            props.selected
              ? "bg-primary-foreground text-primary"
              : "text-primary-foreground hover:bg-primary-foreground/10",
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
