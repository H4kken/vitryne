// SPDX-License-Identifier: AGPL-3.0-or-later
import { Logo } from "@/editor/icons/Logo";
import { Loader2 } from "lucide-react";

/** Over the editor while the project or example a URL names opens. */
export function ProjectLoading({ text }: { text: string }) {
  return (
    <div
      className="bg-background absolute inset-0 z-30 flex flex-col"
      role="status"
      aria-live="polite"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
      </div>
      <div className="text-body-text flex grow items-center justify-center gap-3 text-[17px]">
        <Loader2 className="size-5 animate-spin" />
        {text}…
      </div>
    </div>
  );
}
