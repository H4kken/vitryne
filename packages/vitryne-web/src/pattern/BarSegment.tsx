// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function BarSegment(props: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-pressed={props.on}
      onClick={props.onClick}
      className={cn(
        "h-8 rounded-lg px-2.5 text-[13px] font-medium",
        props.on ? "bg-[#14181F] text-white" : "hover:bg-[#F4F5F2]",
      )}
    >
      {props.children}
    </button>
  );
}
