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
            props.selected
              ? "bg-white text-[#14181F]"
              : "text-white hover:bg-white/10",
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
