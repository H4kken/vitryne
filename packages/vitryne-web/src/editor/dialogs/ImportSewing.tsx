// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { CompanionPicker } from "./CompanionPicker";
import type { Preview, TextFile } from "./ImportDialog";
import type { PatternKind } from "./importSource";

/** What the import sews: a DXF's garment.toml, or nothing yet (the seam suggestions come after). */
export function ImportSewing(props: {
  kind: PatternKind | null;
  preview: Preview;
  /** The garment.toml that came with a DXF. */
  sidecar: TextFile | null;
  onSidecar: (f: TextFile | null) => void;
}) {
  const { kind, preview, sidecar } = props;
  // A drafted pattern has no sewing in it; the editor's suggestions come after the import.
  if (kind === "drafted") return null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-hover p-4 text-[14px] leading-snug">
      <span className="font-semibold">Sewing</span>
      {sidecar ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow">
            From {sidecar.name}: {preview.sewing?.seams ?? 0} seams (
            {preview.sewing?.title}).
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onSidecar(null)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body-text grow">
            The pieces are placed but not sewn yet. A garment.toml written for
            this pattern can sew them: drop it here or choose it.
          </span>
          {kind && (
            <CompanionPicker
              kind={kind}
              label="Add a garment.toml…"
              onFile={props.onSidecar}
            />
          )}
        </div>
      )}
    </div>
  );
}
