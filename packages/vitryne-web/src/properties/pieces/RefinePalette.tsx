// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { LANDMARKS, parseZoneKey } from "@/editor/dialogs/bodyZones";

/**
 * The finer places of an arm or a leg, as large targets beside the pointer, while a piece is
 * held over the limb (on the body map or the 3D view). Dropping on one sets where on the limb the
 * piece starts. Each item is a zone (`data-zone`), like the body map's.
 */
export function RefinePalette(props: {
  /** The limb's zone key (`front:arm-left`). */
  zone: string;
  /** Where the pointer was when it opened, screen pixels. */
  x: number;
  y: number;
  /** The zone key under the pointer now. */
  over: string | null;
}) {
  const [, zone] = parseZoneKey(props.zone);
  const parts = LANDMARKS[zone] ?? [];
  const left = Math.min(props.x + 28, window.innerWidth - 150);
  const top = Math.max(
    8,
    Math.min(props.y - 20, window.innerHeight - 8 - parts.length * 44),
  );
  return createPortal(
    <div
      className="bg-card border-border fixed z-[150] flex w-[140px] flex-col gap-1 rounded-2xl border p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.2)]"
      style={{ left, top }}
    >
      {parts.map((part) => {
        const key = `${props.zone}#${part.landmark ?? ""}`;
        return (
          <div
            key={key}
            data-zone={key}
            className={cn(
              "flex h-10 items-center rounded-xl px-3 text-[14px] font-semibold",
              props.over === key
                ? "bg-select text-white"
                : "bg-hover text-foreground",
            )}
          >
            {part.label}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
