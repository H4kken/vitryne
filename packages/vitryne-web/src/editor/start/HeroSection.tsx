// SPDX-License-Identifier: AGPL-3.0-or-later

import { wordPull } from "./wordPull";
import { type CSSProperties, type ReactNode, useRef } from "react";

/** What a sewing team looks at, scattered behind the statement: [text, position, tilt, a chip or plain, a size from Tailwind's scale]. */
const WORDS: [string, string, string, boolean, string][] = [
  ["Merino wool", "top-[12%] left-[6%]", "-rotate-3", false, "text-5xl"],
  ["Arm creases", "top-[22%] right-[8%]", "rotate-2", true, "text-2xl"],
  ["Cotton jersey", "top-[44%] left-[4%]", "rotate-1", true, "text-sm"],
  ["Shoulder slope", "top-[10%] right-[34%]", "rotate-1", false, "text-sm"],
  ["Grainline", "top-[56%] right-[5%]", "-rotate-2", false, "text-3xl"],
  ["Side seam", "bottom-[26%] left-[22%]", "-rotate-2", false, "text-4xl"],
  ["Hem drop", "bottom-[22%] right-[26%]", "rotate-3", true, "text-xs"],
  ["Ease at the chest", "top-[34%] right-[2%]", "rotate-1", false, "text-2xl"],
  ["+2 cm ease", "top-[30%] left-[18%]", "-rotate-1", false, "text-5xl"],
  ["XS", "top-[68%] left-[8%]", "-rotate-2", true, "text-5xl"],
  ["2XL", "top-[18%] left-[34%]", "rotate-2", true, "text-3xl"],
  ["76°", "top-[66%] right-[16%]", "rotate-3", true, "text-4xl"],
  ["58 cm chest", "top-[7%] left-[22%]", "rotate-1", false, "text-sm"],
  ["1.5 cm hem", "bottom-[16%] left-[44%]", "-rotate-1", false, "text-2xl"],
];

/** The landing statement: a cutting mat, the words and measurements a fitting looks for, then what the tool does
 * and the one action. */
export function HeroSection(props: { action: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const frame = useRef(0);
  // Each word leans toward the pointer: a vector from the word to the pointer, in two custom
  // properties on the word (one write per frame). Layout offsets ignore the words' own movement.
  // Touch and reduced motion leave the words where they are.
  const follow = (e: React.PointerEvent<HTMLElement>) => {
    const el = root.current;
    if (!el || e.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      for (const w of el.querySelectorAll<HTMLElement>("[data-word]")) {
        const dx = px - (w.offsetLeft + w.offsetWidth / 2);
        const dy = py - (w.offsetTop + w.offsetHeight / 2);
        const pull = wordPull(dx, dy, Number(w.dataset.word));
        w.style.setProperty("--tx", `${pull.x}px`);
        w.style.setProperty("--ty", `${pull.y}px`);
      }
    });
  };
  const rest = () => {
    cancelAnimationFrame(frame.current);
    for (const w of root.current?.querySelectorAll<HTMLElement>(
      "[data-word]",
    ) ?? []) {
      w.style.setProperty("--tx", "0px");
      w.style.setProperty("--ty", "0px");
    }
  };
  return (
    <section
      ref={root}
      onPointerMove={follow}
      onPointerLeave={rest}
      aria-labelledby="hero-title"
      className="relative mx-auto flex min-h-[calc(100cqh-53px)] w-full flex-col justify-between overflow-hidden bg-[#e8efe6] px-6 pb-6 sm:px-10 dark:bg-card"
    >
      {/* A cutting mat: a fine grid, a heavier line every five squares, a ruler along two edges
          and the half circle a pattern maker's compass leaves. Quiet, so the words stay readable. */}
      <svg
        aria-hidden="true"
        className="word-in pointer-events-none absolute inset-0 size-full text-emerald-900 opacity-[0.16] dark:text-white dark:opacity-[0.08]"
      >
        <defs>
          <pattern
            id="mat-fine"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M24 0H0V24"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern
            id="mat-major"
            width="120"
            height="120"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M120 0H0V120"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </pattern>
          <pattern
            id="mat-ruler-x"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0V8" stroke="currentColor" strokeWidth="1" />
          </pattern>
          <pattern
            id="mat-ruler-y"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0H8" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#mat-fine)" />
        <rect width="100%" height="100%" fill="url(#mat-major)" />
        <rect x="12" y="12" width="100%" height="10" fill="url(#mat-ruler-x)" />
        <rect x="12" y="12" width="10" height="100%" fill="url(#mat-ruler-y)" />
      </svg>
      {WORDS.map(([text, place, tilt, chip, size], i) => (
        <span
          key={text}
          // A different reach per word.
          data-word={14 + (i % 4) * 6}
          aria-hidden="true"
          style={
            {
              "--d": `${400 + i * 100}ms`,
            } as CSSProperties
          }
          className={`word-in ease-weighted pointer-events-none absolute translate-x-(--tx) translate-y-(--ty) transition-[translate] duration-700 max-lg:hidden ${place} ${i > 4 ? "max-xl:hidden" : ""}`}
        >
          <span
            style={{ "--d": `${(i * 900) % 3000}ms` } as CSSProperties}
            className={`word-drift block opacity-50 ${tilt} ${size} ${
              chip
                ? "font-medium rounded-lg bg-white/70 px-3 py-1 text-emerald-900 shadow-sm dark:bg-muted dark:text-foreground"
                : "font-medium text-muted-foreground"
            }`}
          >
            {text}
          </span>
        </span>
      ))}
      <div className="relative flex grow items-center justify-center py-16">
        <h1
          id="hero-title"
          style={{ "--d": "150ms" } as CSSProperties}
          className="heading-1 hero-gradient word-in m-0 max-w-[900px] pb-1 text-left"
        >
          Clothes Modeling
          <br />
          Free, and open-source
        </h1>
      </div>
      <div
        style={{ "--d": "900ms" } as CSSProperties}
        className="word-in relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <p className="body-3 text-body-text m-0 max-w-[420px]">
          Create realistic clothes, let your creativity flow, and export your
          creations. Free, forever.
        </p>
        {props.action}
      </div>
    </section>
  );
}
