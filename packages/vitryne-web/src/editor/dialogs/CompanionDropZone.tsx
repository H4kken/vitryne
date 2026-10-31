// SPDX-License-Identifier: AGPL-3.0-or-later
import { Import } from "lucide-react";
import type { PatternKind } from "./importSource";
import { WANTED } from "./useCompanionDrop";

/** The full-screen drop zone over the import dialog (the start screen's look). */
export function CompanionDropZone({ kind }: { kind: PatternKind }) {
  return (
    <div
      aria-hidden="true"
      className="bg-background/90 pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-4 border-dashed border-foreground bg-card/70 text-center">
        <Import className="text-foreground size-14" />
        <span className="font-display text-3xl font-bold tracking-[-0.02em]">
          Drop to add it to this import
        </span>
        <span className="text-muted-foreground text-base">{WANTED[kind]}</span>
      </div>
    </div>
  );
}
