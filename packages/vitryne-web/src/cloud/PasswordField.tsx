// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const MIN_PASSWORD = 8;

/** A password with a show/hide toggle; for a new one, a live count of what is still missing. */
export function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password";
  /** Shown at the right of the label (a "Forgot password?" link). */
  aside?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const isNew = props.autoComplete === "new-password";
  const n = props.value.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.aside}
      </div>
      <div className="relative">
        <Input
          id={props.id}
          type={shown ? "text" : "password"}
          className="h-11 rounded-xl pr-16"
          required
          minLength={isNew ? MIN_PASSWORD : undefined}
          autoComplete={props.autoComplete}
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button
          type="button"
          className="text-muted-foreground absolute inset-y-0 right-0 px-3 text-[13px] font-medium"
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {isNew && (
        <p
          className={`m-0 flex min-h-4 items-center gap-1.5 text-xs ${n >= MIN_PASSWORD ? "text-[var(--live)]" : "text-muted-foreground"}`}
        >
          {n >= MIN_PASSWORD ? (
            <>
              <Check className="size-3.5" /> Good
            </>
          ) : n ? (
            `${MIN_PASSWORD - n} more character${MIN_PASSWORD - n === 1 ? "" : "s"}`
          ) : (
            `${MIN_PASSWORD} characters or more`
          )}
        </p>
      )}
    </div>
  );
}
