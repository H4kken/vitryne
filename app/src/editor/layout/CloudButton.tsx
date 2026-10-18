// SPDX-License-Identifier: AGPL-3.0-or-later

import { Cloud as CloudIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** The account, in the top bar and on the start screen. */
export function CloudButton(props: {
  user: { email: string | null; anonymous: boolean } | null;
  onClick: () => void;
}) {
  const label = props.user?.email ?? (props.user ? "Cloud" : "Sign in");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-[220px] gap-1.5 px-3 font-medium"
          onClick={props.onClick}
        >
          <CloudIcon />
          <span className="truncate max-sm:hidden">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {props.user?.anonymous
          ? "Your draft is kept in this browser: create a free account to keep it for good"
          : "Your account"}
      </TooltipContent>
    </Tooltip>
  );
}
