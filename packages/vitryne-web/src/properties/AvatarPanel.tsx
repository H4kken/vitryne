// SPDX-License-Identifier: AGPL-3.0-or-later
// The Avatar panel the rail opens: how the body looks. The skin tone is a viewing preference of
// this browser (lib/skin.ts), not part of the project.

import { PanelHeading } from "@/components/PanelHeading";
import { cn } from "@/lib/utils";
import { SKIN_TONES, setSkin, useSkin } from "@/lib/skin";

export function AvatarPanel() {
  const skin = useSkin();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <PanelHeading>Skin tone</PanelHeading>
        <div
          role="radiogroup"
          aria-label="Skin tone"
          className="grid grid-cols-7 gap-1.5"
        >
          {SKIN_TONES.map((color, i) => {
            const on = color.toLowerCase() === skin;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`Skin tone ${i + 1}`}
                onClick={() => setSkin(color)}
                className={cn(
                  "aspect-square w-full rounded-full border border-black/10 transition-shadow ring-offset-background",
                  on
                    ? "ring-2 ring-foreground ring-offset-2"
                    : "hover:ring-2 hover:ring-border-strong hover:ring-offset-1",
                )}
                style={{ background: color }}
              />
            );
          })}
        </div>
        <p className="text-muted-foreground text-[13px] leading-snug">
          Only changes how the body looks on this device. The drape and exports
          don't change.
        </p>
      </div>
    </div>
  );
}
