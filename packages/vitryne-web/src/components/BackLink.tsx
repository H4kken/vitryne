// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChevronLeft } from "lucide-react";

/** The way back from a page to its list: a chevron and where it goes. */
export function BackLink(props: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="text-muted-foreground hover:text-foreground -ml-1 flex items-center gap-0.5 self-start rounded-md py-0.5 pr-1.5 text-sm font-medium"
    >
      <ChevronLeft className="size-4" />
      {props.children}
    </button>
  );
}
