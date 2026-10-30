// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing a pattern (packages/vitryne-docs/content/docs/developers/architecture.md, Import and placement), a DXF-AAMA file or a
// Valentina pattern: what the file holds and what was left out of it, then where each piece goes
// on the body (suggested from its name, the user decides), an optional garment.toml for a DXF's
// sewing or the measurements a Valentina pattern is drafted from (and its size; either file can
// be dropped anywhere on the dialog), and whether the pieces make a new project or join the open one.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EngineSession } from "@/worker/session";
import { encodeChoice } from "./encodeChoice";
import { leftOut } from "./leftOut";
import { decodeChoice } from "./decodeChoice";
import { CompanionDropZone } from "./CompanionDropZone";
import { ImportPlacement } from "./ImportPlacement";
import { ImportSewing } from "./ImportSewing";
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
  | { type: "flat" };

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
  /** The pattern to import; the dialog is open while there is one. */
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
  }) => Promise<void>;
}) {
  const { pattern, session } = props;
  const kind = pattern ? patternKind(pattern.name) : null;
  // The parent mounts a new dialog per pattern, so this starts over each time.
  const [companion, setCompanion] = useState<TextFile | null>(
    props.initialCompanion ?? null,
  );
  const sidecar = kind === "dxf" ? companion : null;
  const [size, setSize] = useState<number[] | null>(null);
  /** A Valentina pattern's measurements file (null: it needs none), once asked. */
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
  const [choices, setChoices] = useState<Record<string, string>>({});
  /** Pieces whose place was guessed from their name and not yet confirmed. */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [into, setInto] = useState<"new" | "add">("new");
  const [busy, setBusy] = useState(false);

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
  // A Valentina pattern can't be read before its measurements are here.
  const waiting =
    kind === "drafted" && (!needs || (!!needs.measurements && !companion));
  const key = `${pattern?.name ?? ""}|${companion?.name ?? ""}|${size?.join(",") ?? ""}`;
  useEffect(() => {
    if (!pattern || waiting) return;
    let stale = false;
    session.inspectImport(importSource(pattern, companion, size)).then(
      (json) => {
        if (stale) return;
        const p = JSON.parse(json) as Preview;
        setReading({ key, preview: p });
        setChoices(
          Object.fromEntries(
            p.pieces.flatMap((x) =>
              x.suggestion ? [[x.name, encodeChoice(x.suggestion)]] : [],
            ),
          ),
        );
        setUnchecked(
          new Set(p.pieces.filter((x) => x.suggestion).map((x) => x.name)),
        );
      },
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

  const missing = preview?.pieces.filter((x) => !choices[x.name]) ?? [];
  const placed =
    preview?.pieces.filter(
      (x) => choices[x.name] && choices[x.name] !== "leave",
    ) ?? [];
  const lines = preview ? leftOut(preview) : [];

  const run = async (skip = false) => {
    if (!pattern || !preview) return;
    setBusy(true);
    setRunError(null);
    try {
      await props.onImport({
        pattern,
        companion,
        size,
        choices: Object.fromEntries(
          preview.pieces.map((x) => [
            x.name,
            decodeChoice(
              choices[x.name] ??
                // Skipping: the suggestion, else as it is (a piece cut twice can't be, so it waits out).
                (skip && x.cuts !== 2 ? "flat" : "leave"),
            ),
          ]),
        ),
        into: props.projectName ? into : "new",
      });
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dragging = useCompanionDrop(kind, setCompanion, setRunError);

  return (
    <Dialog
      open={!!pattern}
      onOpenChange={(open) => !open && !busy && props.onClose()}
    >
      <DialogContent
        className={cn(
          "flex max-h-[calc(100vh-32px)] flex-col gap-5 rounded-[20px] p-6 sm:max-w-[640px]",
          preview && "sm:max-w-[900px]",
        )}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Import a pattern
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {preview
              ? `${pattern?.name}: ${preview.pieces.length} piece${preview.pieces.length === 1 ? "" : "s"}. Put each one where it goes on the body; you can move them afterwards.`
              : error
                ? `${pattern?.name} could not be read.`
                : waiting && needs
                  ? `${pattern?.name} needs its measurements file.`
                  : `Reading ${pattern?.name}…`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6">
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

          {preview && (
            <ImportPlacement
              preview={preview}
              choices={choices}
              onChoices={setChoices}
              unchecked={unchecked}
              onChecked={(names) =>
                setUnchecked(
                  (u) => new Set([...u].filter((n) => !names.includes(n))),
                )
              }
            />
          )}

          {preview && (
            <ImportSewing
              kind={kind}
              preview={preview}
              sidecar={sidecar}
              onSidecar={setCompanion}
            />
          )}

          {preview && (
            <details className="text-[14px] leading-snug">
              <summary className="cursor-pointer font-semibold">
                {lines.length + preview.report.warnings.length
                  ? `Left out of the file (${lines.length + preview.report.warnings.length})`
                  : "Nothing in the file was left out"}
              </summary>
              <ul className="text-body-text mt-2 mb-0 flex flex-col gap-1 pl-5">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {preview.report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {kind === "dxf" && (
                  <li>
                    Units:{" "}
                    {preview.report.units_m === 0.001
                      ? "millimetres"
                      : `${preview.report.units_m * 1000} mm per drawing unit`}
                  </li>
                )}
              </ul>
            </details>
          )}

          {preview && props.projectName && (
            <ImportTarget
              projectName={props.projectName}
              value={into}
              onChange={setInto}
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

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-muted-foreground text-[13px]">
            {missing.length
              ? `Choose a place for ${missing.map((x) => x.name).join(", ")}, or leave it out.`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={props.onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => void run(true)}
              disabled={!preview || busy}
              title="Open the pieces with their suggested places; the rest start flat in front of the chest"
            >
              Skip and import
            </Button>
            <Button
              onClick={() => void run()}
              disabled={
                !preview || missing.length > 0 || placed.length === 0 || busy
              }
            >
              {busy ? "Importing…" : "Import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {dragging && kind && <CompanionDropZone kind={kind} />}
    </Dialog>
  );
}
