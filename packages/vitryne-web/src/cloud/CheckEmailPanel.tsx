// SPDX-License-Identifier: AGPL-3.0-or-later

import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

/** After a link was emailed (to confirm a new account, or to reset a password): waits, and says what to do if it doesn't come. */
export function CheckEmailPanel(props: {
  email: string;
  /** What the link does. */
  children: React.ReactNode;
  working: boolean;
  onResend: () => void;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      <div className="flex flex-col items-center gap-3 pt-1 text-center">
        <div className="bg-secondary grid size-14 place-items-center rounded-full">
          <Mail className="size-6" aria-hidden />
        </div>
        <p className="m-0 max-w-[34ch]">{props.children}</p>
      </div>
      <p className="text-muted-foreground m-0 text-center text-[13px]">
        Nothing arrived? Check your spam folder.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={props.working}
        onClick={props.onResend}
      >
        Send it again
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={props.onBack}
      >
        {props.backLabel}
      </Button>
    </div>
  );
}
