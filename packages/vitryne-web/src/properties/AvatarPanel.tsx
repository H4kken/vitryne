// SPDX-License-Identifier: AGPL-3.0-or-later
// The Avatar panel the rail opens: how the body looks. The skin tone is a viewing preference of
// this browser (lib/skin.ts), not part of the project.

import { PanelHeading } from "@/components/PanelHeading";
import { cn } from "@/lib/utils";
import { DEFAULT_SKIN, SKIN_TONES, setSkin, useSkin } from "@/lib/skin";

export function AvatarPanel() {
  const skin = useSkin();
  const named = SKIN_TONES.find((t) => t.color.toLowerCase() === skin);
  const custom = !named;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <PanelHeading>Skin tone</PanelHeading>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="size-7 shrink-0 rounded-full border border-black/10"
            style={{ background: skin }}
          />
          <span className="text-[15px] font-semibold">
            {named?.name ?? "Custom"}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Skin tone"
          className="grid grid-cols-7 gap-1.5"
        >
          {SKIN_TONES.map((t) => {
            const on = t.color.toLowerCase() === skin;
            return (
              <button
                key={t.color}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t.name}
                title={t.name}
                onClick={() => setSkin(t.color)}
                className={cn(
                  "aspect-square w-full rounded-full border border-black/10 transition-shadow ring-offset-background",
                  on
                    ? "ring-2 ring-foreground ring-offset-2"
                    : "hover:ring-2 hover:ring-border-strong hover:ring-offset-1",
                )}
                style={{ background: t.color }}
              />
            );
          })}
        </div>
        <label
          className={cn(
            "text-muted-foreground hover:text-foreground relative cursor-pointer self-start text-xs underline underline-offset-4",
          )}
        >
          {custom ? "Change custom colour" : "Pick any colour"}
          <input
            type="color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={skin}
            onChange={(e) => setSkin(e.target.value)}
          />
        </label>
        {skin !== DEFAULT_SKIN.toLowerCase() && (
          <button
            type="button"
            onClick={() => setSkin(DEFAULT_SKIN)}
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
          >
            Back to the default
          </button>
        )}
        <p className="text-muted-foreground text-[13px] leading-snug">
          Only changes how the body looks on this device. The drape and exports
          don't change.
        </p>
      </div>
    </div>
  );
}
