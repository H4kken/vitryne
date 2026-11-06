// SPDX-License-Identifier: AGPL-3.0-or-later
// The Avatar panel the rail opens: which body the project is on, and how it looks. The body is
// part of the project (changing it is an edit, and can be undone); the skin tone is a viewing
// preference of this browser (lib/skin.ts).

import { PanelHeading } from "@/components/PanelHeading";
import { cn } from "@/lib/utils";
import { SKIN_TONES, setSkin, useSkin } from "@/lib/skin";
import type { useAvatarSwap } from "@/editor/hooks/useAvatarSwap";

const cm = (mm: number) => `${Math.round(mm / 10)} cm`;

export function AvatarPanel(props: {
  /** The project's avatar id. */
  current: string | undefined;
  readOnly: boolean;
  avatars: ReturnType<typeof useAvatarSwap>;
}) {
  const { current, readOnly, avatars } = props;
  const { bodies, loading, error, choose } = avatars;
  const skin = useSkin();
  return (
    <div className="flex flex-col gap-5">
      {bodies.length > 0 && (
        <div className="flex flex-col gap-3">
          <PanelHeading>Body</PanelHeading>
          <div
            role="radiogroup"
            aria-label="Body"
            className="flex flex-col gap-1.5"
          >
            {bodies.map((b) => {
              const on = b.id === current;
              const busy = loading === b.slug;
              return (
                <button
                  key={b.slug}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={readOnly || loading !== null}
                  onClick={() => !on && void choose(b)}
                  className={cn(
                    "flex flex-col items-start rounded-md border px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-60",
                    on
                      ? "border-foreground bg-accent"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <span className="font-medium">
                    {b.name}
                    {busy && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · loading
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {cm(b.height)} tall · chest {cm(b.chest)} · waist{" "}
                    {cm(b.waist)} · hips {cm(b.hips)}
                  </span>
                </button>
              );
            })}
          </div>
          {error && (
            <p
              role="alert"
              className="text-destructive text-[13px] leading-snug"
            >
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-[13px] leading-snug">
            The pieces move onto the new body at the same places and keep their
            size, so a pattern made for another body may not fit well. The first
            time a body is used it takes a moment to prepare.
          </p>
        </div>
      )}
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
