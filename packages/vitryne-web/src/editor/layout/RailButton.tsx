// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from "@/lib/utils";
import { PANEL_TITLES, type PanelId } from "@/properties/panelTitles";

export function RailButton(props: {
  id: PanelId;
  icon: React.ReactNode;
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
}) {
  const on = props.panel === props.id;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => props.setPanel(on ? null : props.id)}
      className={cn(
        "flex h-16 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors duration-200",
        on ? "bg-[#E8ECE4]" : "hover:bg-[#F4F5F2]",
      )}
    >
      {props.icon}
      {PANEL_TITLES[props.id]}
    </button>
  );
}
