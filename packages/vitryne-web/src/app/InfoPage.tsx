// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { Logo } from "@/editor/icons/Logo";

/** A page that says why the editor can't run here: the logo, a title, and what to do. */
export function InfoPage(props: { title: string; children: ReactNode }) {
  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-16 shrink-0 items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-8 pt-14">
        <h1 className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em]">
          {props.title}
        </h1>
        {props.children}
      </div>
    </main>
  );
}
