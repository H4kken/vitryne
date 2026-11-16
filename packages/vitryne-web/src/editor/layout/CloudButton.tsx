// SPDX-License-Identifier: AGPL-3.0-or-later

import { Cloud as CloudIcon } from "lucide-react";
import { AccountAvatar } from "@/cloud/AccountAvatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** The account, in the top bar and on the start screen. */
export function CloudButton(props: {
  user: {
    email: string | null;
    anonymous: boolean;
    avatarUrl?: string | null;
  } | null;
  onClick: () => void;
}) {
  const account = props.user && !props.user.anonymous ? props.user : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          // Signed in the button is just the round avatar, so it is round too.
          size={account ? "icon" : "default"}
          data-avatar={account ? "" : undefined}
          aria-label={account ? undefined : "Sign in"}
          className={
            account ? "rounded-full" : "max-w-[220px] gap-2 px-3 font-medium"
          }
          onClick={props.onClick}
        >
          {account ? (
            <>
              <AccountAvatar
                email={account.email ?? ""}
                avatarUrl={account.avatarUrl}
                className="size-7 text-sm"
              />
              <span className="sr-only">{account.email}</span>
            </>
          ) : (
            <>
              <CloudIcon />
              <span className="truncate max-sm:hidden">Sign in</span>
            </>
          )}
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
