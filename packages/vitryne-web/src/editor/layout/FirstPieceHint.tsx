// SPDX-License-Identifier: AGPL-3.0-or-later

import { PenTool, SquarePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCS_URL } from "@/links";

/** The flat view of a garment with no pieces yet. */
export function FirstPieceHint(props: {
  onDraw: () => void;
  onShape: () => void;
  onImport: () => void;
  busy: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-[#E1E4DE] bg-white px-7 py-6 text-center shadow-[0_10px_24px_rgba(20,24,31,.08)]">
        <h2 className="font-display m-0 text-xl font-semibold">
          Draw your first piece
        </h2>
        <p className="text-body-text m-0 text-[15px]">
          Draw its outline with the pen, start from a shape with typed sizes, or
          bring pieces in from a DXF pattern.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="gap-2" onClick={props.onDraw}>
            <PenTool className="size-4" />
            Draw
          </Button>
          <Button variant="secondary" className="gap-2" onClick={props.onShape}>
            <SquarePlus className="size-4" />
            Shape
          </Button>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={props.onImport}
            disabled={props.busy}
          >
            <Upload className="size-4" />
            Import
          </Button>
        </div>
        <a
          href={`${DOCS_URL}/guide/editor-overview`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          How it works
        </a>
      </div>
    </div>
  );
}
