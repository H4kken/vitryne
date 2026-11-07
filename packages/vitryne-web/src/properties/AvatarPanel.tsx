// SPDX-License-Identifier: AGPL-3.0-or-later
// The Avatar panel the rail opens: which body the project is on, and how it looks. The body is
// part of the project (changing it is an edit, and can be undone); the skin tone is a viewing
// preference of this browser (lib/skin.ts).

import { PanelHeading } from "@/components/PanelHeading";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { type BodyOption, groupBodies } from "@/lib/bodies";
import { BodySilhouette } from "./BodySilhouette";
import { SKIN_TONES, setSkin, useSkin } from "@/lib/skin";
import type { useAvatarSwap } from "@/editor/hooks/useAvatarSwap";

/** The first avatar's own name says "male", which its figure doesn't show. */
const nameOf = (b: BodyOption) =>
  b.slug === "default" ? "Original (MakeHuman base)" : b.name;

const cm = (mm: number) => `${Math.round(mm / 10)} cm`;

const tile =
  "flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-0.5 pt-2 pb-1.5 text-[13px] transition-colors disabled:opacity-60";

/** Arrow keys move between the bodies of the group, like any radio group. */
function moveFocus(e: React.KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
    e.key
  ];
  if (!step) return;
  const all = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]"),
  ].filter((b) => !b.disabled);
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  all[(at + step + all.length) % all.length]?.focus();
  e.preventDefault();
}

export function AvatarPanel(props: {
  /** The project's avatar id. */
  current: string | undefined;
  readOnly: boolean;
  avatars: ReturnType<typeof useAvatarSwap>;
}) {
  const { current, readOnly, avatars } = props;
  const { bodies, loading, error, choose } = avatars;
  const skin = useSkin();
  // The body the pointer or the keyboard is on; the line under the list describes it.
  const [peek, setPeek] = useState<string | null>(null);
  const { original, groups } = groupBodies(bodies);
  const shown =
    bodies.find((b) => b.slug === (peek ?? loading)) ??
    bodies.find((b) => b.id === current);

  const pick = (
    b: BodyOption,
    className: string,
    children: React.ReactNode,
  ) => {
    const on = b.id === current;
    return (
      <button
        key={b.slug}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={nameOf(b)}
        tabIndex={on || (!current && b === bodies[0]) ? 0 : -1}
        disabled={readOnly || loading !== null}
        onClick={() => !on && void choose(b)}
        onMouseEnter={() => setPeek(b.slug)}
        onMouseLeave={() => setPeek(null)}
        onFocus={() => setPeek(b.slug)}
        onBlur={() => setPeek(null)}
        className={cn(
          className,
          on
            ? "border-foreground bg-accent"
            : "border-border hover:border-border-strong",
        )}
      >
        {children}
      </button>
    );
  };
  const spinner = (b: BodyOption) =>
    loading === b.slug && (
      <span
        aria-hidden="true"
        className="border-border-strong border-t-foreground mr-1.5 inline-block size-2.5 animate-spin rounded-full border-2 align-[-1px] motion-reduce:animate-none"
      />
    );
  const art = (b: BodyOption, className: string) => (
    <BodySilhouette
      body={b}
      className={cn(
        className,
        b.id === current ? "text-foreground" : "text-muted-foreground/60",
      )}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {bodies.length > 0 && (
        <div className="flex flex-col gap-3">
          <PanelHeading>Body</PanelHeading>
          <p className="text-muted-foreground text-[13px] leading-snug">
            Pieces move onto the new body at the same places and keep their
            size, so a pattern made for another body may not fit well.
          </p>
          <div
            role="radiogroup"
            aria-label="Body"
            onKeyDown={moveFocus}
            className="flex flex-col gap-3.5"
          >
            {original &&
              pick(
                original,
                "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-60",
                <>
                  {art(original, "h-10 w-[22px] flex-none")}
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {spinner(original)}Original
                    </span>
                    <span className="text-muted-foreground">
                      MakeHuman base
                    </span>
                  </span>
                </>,
              )}
            {groups.map((g) => (
              <div key={g.label} className="flex flex-col gap-2.5">
                <PanelHeading>{g.label}</PanelHeading>
                <div className="grid grid-cols-3 gap-1.5">
                  {g.items.map(({ body, label }) =>
                    pick(
                      body,
                      tile,
                      <>
                        {art(body, "h-[92px] w-full")}
                        <span>
                          {spinner(body)}
                          {label}
                        </span>
                      </>,
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          {shown && (
            <div
              aria-live="polite"
              className="border-border flex flex-col border-t pt-2 text-[13px]"
            >
              {loading ? (
                <>
                  <span className="font-medium">
                    Preparing {nameOf(shown)}…
                  </span>
                  <span className="text-muted-foreground">
                    The first time takes a few seconds. It is kept for next
                    time.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium">{nameOf(shown)}</span>
                  <span className="text-muted-foreground">
                    {cm(shown.height)} tall · chest {cm(shown.chest)} · waist{" "}
                    {cm(shown.waist)} · hips {cm(shown.hips)}
                  </span>
                </>
              )}
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="text-destructive text-[13px] leading-snug"
            >
              {error}
            </p>
          )}
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
