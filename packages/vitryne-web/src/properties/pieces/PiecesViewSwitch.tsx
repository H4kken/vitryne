// SPDX-License-Identifier: AGPL-3.0-or-later
// The switch at the top of the Pieces panel: the plain list of pieces, the stack (Layers) or the seams.

import { cn } from "@/lib/utils";

export type PiecesView = "pieces" | "layers" | "seams";

const VIEWS: { id: PiecesView; label: string }[] = [
  { id: "pieces", label: "Pieces" },
  { id: "layers", label: "Layers" },
  { id: "seams", label: "Seams" },
];

export function PiecesViewSwitch(props: {
  view: PiecesView;
  onView: (v: PiecesView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pieces views"
      className="flex gap-0.5 rounded-[11px] bg-muted p-[3px]"
    >
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={props.view === v.id}
          onClick={() => props.onView(v.id)}
          className={cn(
            "flex-1 rounded-[9px] px-2.5 py-1.5 text-[13px] font-semibold",
            props.view === v.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
