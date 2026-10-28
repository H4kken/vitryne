// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** An icon button for flipping the picked pieces, as tall as the name field beside it. */
export function FlipButton(props: {
  label: string;
  keys: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={props.label}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {props.label} <span className="opacity-70">{props.keys}</span>
      </TooltipContent>
    </Tooltip>
  );
}
