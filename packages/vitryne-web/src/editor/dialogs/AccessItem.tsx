// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { SelectItem } from "@/components/ui/select";

/** One level in the access list: an icon, a bold title and what it means, like Canva's. */
export function AccessItem(props: {
  value: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <SelectItem
      value={props.value}
      className="items-start rounded-none py-3 pr-10 pl-3 first:rounded-t-xl last:rounded-b-xl focus:bg-hover data-[state=checked]:bg-hover"
    >
      <span className="flex items-start gap-3">
        <span className="text-foreground mt-0.5 shrink-0">{props.icon}</span>
        <span className="flex flex-col gap-0.5 whitespace-normal">
          <span className="text-foreground text-[14px] font-semibold">
            {props.title}
          </span>
          <span className="text-muted-foreground text-[13px] leading-snug">
            {props.children}
          </span>
        </span>
      </span>
    </SelectItem>
  );
}
