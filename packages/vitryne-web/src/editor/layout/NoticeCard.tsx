// SPDX-License-Identifier: AGPL-3.0-or-later

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoticeCard(props: {
  tone?: "error";
  onDismiss?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role={props.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex max-w-[480px] items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm leading-snug shadow-[0_8px_24px_rgba(20,24,31,.08)]",
        props.tone === "error"
          ? "border-[#F0C9BE] text-[#8A2410]"
          : "border-[#E1E4DE]",
      )}
    >
      <span className="grow">{props.children}</span>
      {props.onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={props.onDismiss}
          className="text-muted-foreground hover:text-foreground -m-1 p-1"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
