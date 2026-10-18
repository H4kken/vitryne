// SPDX-License-Identifier: AGPL-3.0-or-later
import { Shapes, SlidersHorizontal } from "lucide-react";
import { type PanelId } from "@/properties/panelTitles";
import { FabricIcon } from "../icons/FabricIcon";
import { RailButton } from "./RailButton";

/** The icon rail: it opens one panel at a time (or closes it). */
export function Rail({
  panel,
  setPanel,
}: {
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
}) {
  return (
    <nav
      aria-label="Panels"
      className="flex w-20 shrink-0 flex-col gap-1.5 border-r bg-white px-2 py-3"
    >
      <RailButton
        id="fabric"
        icon={<FabricIcon />}
        panel={panel}
        setPanel={setPanel}
      />
      <RailButton
        id="pieces"
        icon={<Shapes className="size-6" strokeWidth={1.6} />}
        panel={panel}
        setPanel={setPanel}
      />
      <RailButton
        id="settings"
        icon={<SlidersHorizontal className="size-6" strokeWidth={1.6} />}
        panel={panel}
        setPanel={setPanel}
      />
    </nav>
  );
}
