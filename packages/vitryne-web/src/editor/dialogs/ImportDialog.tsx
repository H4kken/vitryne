// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing a pattern (packages/vitryne-docs/content/docs/developers/architecture.md, Import and placement), a DXF-AAMA file or a
// Valentina or Seamly2D pattern. Importing is one gesture: the dialog asks only for what it
// can't go on without (the measurements a drafted pattern is drawn from, and a size of a size
// chart) and, with a project open, whether the pieces join it or make a new project. Pieces get
// the place their name suggests; the rest are imported unplaced and wait in the Pieces panel.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EngineSession } from "@/worker/session";
import { leftOut } from "./leftOut";
import { CompanionDropZone } from "./CompanionDropZone";
import { ImportTarget } from "./ImportTarget";
import { importSource, patternKind } from "./importSource";
import { MeasurementsBox } from "./MeasurementsBox";
import { useCompanionDrop } from "./useCompanionDrop";

/** A text file the user picked or dropped. */
export interface TextFile {
  name: string;
  text: string;
}

/** Rust `import::Choice`. */
export type Choice =
  | { type: "leave" }
  | { type: "one"; place: string }
  | { type: "pair"; pair: string }
  | { type: "on"; piece: string }
  | { type: "flat" }
  | { type: "unplaced" };

/** Rust `drafting::SizeOption`: one dimension of a size chart. */
export interface SizeOption {
  label: string;
  values: number[];
  base: number;
}

/** Rust `import::Preview`. */
export interface Preview {
  file_name: string;
  sizes: SizeOption[];
  report: {
    units_m: number;
    pieces: string[];
    blocks_without_boundary: string[];
    ignored_layers: [string, number][];
    skipped_entity_types: [string, number][];
    bulge_segments: number;
    warnings: string[];
  };
  sewing: { title: string; seams: number } | null;
  pieces: {
    name: string;
    quantity: number;
    cuts: number | null;
    outline: [number, number][];
    suggestion: Choice | null;
  }[];
  unused: string[];
}

export function ImportDialog(props: {
  /** The pattern to import; the dialog is open while it has something to ask. */
  pattern: TextFile | null;
  /** A file that came with it (dropped together): a garment.toml, or measurements. */
  initialCompanion?: TextFile | null;
  session: EngineSession;
  /** The open project's name, if any: the pieces can join it. */
  projectName: string | null;
  onClose: () => void;
  onImport: (o: {
    pattern: TextFile;
    companion: TextFile | null;
    size: number[] | null;
    choices: Record<string, Choice>;
    into: "new" | "add";
    /** What the import left out, for a note once it is done (null: nothing). */
    told: string | null;
  }) => Promise<void>;
}) {
  const { pattern, session } = props;
  const kind = pattern ? patternKind(pattern.name) : null;
  // The parent mounts a new dialog per pattern, so this starts over each time.
  const [companion, setCompanion] = useState<TextFile | null>(
    props.initialCompanion ?? null,
  );
  const [size, setSize] = useState<number[] | null>(null);
  /** A drafted pattern's measurements file (null: it needs none), once asked. */
  const [needs, setNeeds] = useState<{ measurements: string | null } | null>(
    null,
  );
  /** The newest reading, for the files (and size) it was made from. */
  const [reading, setReading] = useState<{
    key: string;
    preview?: Preview;
    error?: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  /** A size chart's sizes were looked at: go ahead. */
  const [sized, setSized] = useState(false);

  useEffect(() => {
    if (!pattern || kind !== "drafted") return;
    let stale = false;
    session.patternNeeds(pattern.text).then(
      (json) =>
        !stale && setNeeds(JSON.parse(json) as { measurements: string | null }),
      (e: Error) =>
        !stale && setReading({ key: pattern.name, error: e.message }),
    );
    return () => {
      stale = true;
    };
  }, [pattern, kind, session]);
  // A drafted pattern can't be read before its measurements are here.
  const waiting =
    kind === "drafted" && (!needs || (!!needs.measurements && !companion));
  const key = `${pattern?.name ?? ""}|${companion?.name ?? ""}|${size?.join(",") ?? ""}`;
  useEffect(() => {
    if (!pattern || waiting) return;
    let stale = false;
    session.inspectImport(importSource(pattern, companion, size)).then(
      (json) =>
        !stale && setReading({ key, preview: JSON.parse(json) as Preview }),
      (e: Error) => !stale && setReading({ key, error: e.message }),
    );
    return () => {
      stale = true;
    };
  }, [pattern, companion, size, waiting, session, key]);
  const current =
    reading?.key === key || reading?.key === pattern?.name ? reading : null;
  const preview = current?.preview ?? null;
  const error = runError ?? current?.error ?? null;

  /** Each piece at the place its name suggests, else unplaced. */
  const choices = (p: Preview): Record<string, Choice> =>
    Object.fromEntries(
      p.pieces.map((x) => [x.name, x.suggestion ?? { type: "unplaced" }]),
    );

  const run = async (into: "new" | "add") => {
    if (!pattern || !preview) return;
    setBusy(true);
    setRunError(null);
    const lines = [...leftOut(preview), ...preview.report.warnings];
    try {
      await props.onImport({
        pattern,
        companion,
        size,
        choices: choices(preview),
        into,
        told: lines.length ? lines.join(". ") : null,
      });
    } catch (e) {
      started.current = false;
      setRunError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // With nothing to ask, the import goes ahead by itself.
  const needsSize = !!preview && preview.sizes.length > 0 && !sized;
  const asksTarget = !!props.projectName;
  useEffect(() => {
    if (!preview || error || needsSize || asksTarget || started.current) return;
    started.current = true;
    void run("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, error, needsSize, asksTarget]);

  const dragging = useCompanionDrop(kind, setCompanion, setRunError);
  const open =
    !!pattern &&
    (waiting || !!error || (!!preview && (needsSize || asksTarget)));
  const ready = !!preview;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && props.onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-32px)] flex-col gap-5 rounded-[20px] p-6 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Import a pattern
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {error
              ? `${pattern?.name} could not be read.`
              : waiting && needs
                ? `${pattern?.name} is drawn from measurements. Add their file to see the pieces.`
                : preview
                  ? `${pattern?.name}: ${preview.pieces.length} piece${preview.pieces.length === 1 ? "" : "s"}.`
                  : `Reading ${pattern?.name}…`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto">
          {kind === "drafted" && needs && (
            <MeasurementsBox
              needed={needs.measurements}
              file={companion}
              onFile={setCompanion}
              sizes={preview?.sizes ?? []}
              size={size}
              onSize={setSize}
            />
          )}

          {ready && asksTarget && (
            <ImportTarget
              projectName={props.projectName as string}
              busy={busy}
              onChoose={(into) => void run(into)}
            />
          )}

          {error && (
            <p
              role="alert"
              className="m-0 rounded-2xl border border-danger/30 bg-card px-4 py-3 text-[14px] text-danger"
            >
              {error}
            </p>
          )}
        </div>

        {needsSize && !asksTarget && (
          <DialogFooter>
            <Button disabled={busy} onClick={() => setSized(true)}>
              Import
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
      {dragging && kind && <CompanionDropZone kind={kind} />}
    </Dialog>
  );
}
