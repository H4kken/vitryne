// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing a pattern (docs/ARCHITECTURE.md, Import and placement), a DXF-AAMA file or a
// Valentina pattern: what the file holds and what was left out of it, then where each piece goes
// on the body (suggested from its name, the user decides), an optional garment.toml for a DXF's
// sewing or the measurements a Valentina pattern is drafted from (and its size), and whether the
// pieces make a new project or join the open one.

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlaceSelect } from "@/placement/PlaceSelect";
import type { EngineSession } from "@/worker/session";
import { chooseFor } from "./chooseFor";
import { encodeChoice } from "./encodeChoice";
import { leftOut } from "./leftOut";
import { decodeChoice } from "./decodeChoice";
import { ImportThumb } from "./ImportThumb";
import { importSource, patternKind } from "./importSource";
import { MeasurementsBox } from "./MeasurementsBox";

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
  const [into, setInto] = useState<"new" | "add">("new");
  const [busy, setBusy] = useState(false);
  const tomlInput = useRef<HTMLInputElement>(null);
  const ids = useId();

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

  /** Whether `a` already goes on `b`, directly or through other pieces: `b` can't go on it. */
  const sitsOn = (a: string, b: string): boolean => {
    for (let k = 0, at = a; k <= Object.keys(choices).length; k++) {
      const c = choices[at];
      if (!c?.startsWith("on:")) return false;
      at = c.slice(3);
      if (at === b) return true;
    }
    return false;
  };
  const missing = preview?.pieces.filter((x) => !choices[x.name]) ?? [];
  const placed =
    preview?.pieces.filter(
      (x) => choices[x.name] && choices[x.name] !== "leave",
    ) ?? [];
  const lines = preview ? leftOut(preview) : [];

  const run = async () => {
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
            decodeChoice(choices[x.name] ?? "leave"),
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

  return (
    <Dialog
      open={!!pattern}
      onOpenChange={(open) => !open && !busy && props.onClose()}
    >
      <DialogContent className="flex max-h-[calc(100vh-32px)] flex-col gap-5 rounded-[20px] p-6 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Import a pattern
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {preview
              ? `${pattern?.name}: ${preview.pieces.length} piece${preview.pieces.length === 1 ? "" : "s"}. Choose where each one goes on the body; you can move them afterwards.`
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
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {preview.pieces.map((x) => {
                const fixed = x.cuts;
                const others = preview.pieces
                  .filter(
                    (o) =>
                      o.name !== x.name &&
                      !sitsOn(o.name, x.name) &&
                      choices[o.name] !== "leave",
                  )
                  .map((o) => ({ key: o.name, label: o.name }));
                return (
                  <li
                    key={x.name}
                    className="flex items-center gap-3 rounded-2xl border border-border p-2.5"
                  >
                    <ImportThumb outline={x.outline} />
                    <div className="flex min-w-0 grow flex-col gap-0.5">
                      <label
                        htmlFor={`${ids}-${x.name}`}
                        className="truncate text-[15px] font-semibold"
                      >
                        {x.name}
                      </label>
                      <span className="text-muted-foreground text-[13px]">
                        {fixed
                          ? `Cut ${fixed === 2 ? "twice" : "once"} (sewing file)`
                          : `Cut ×${x.quantity} in the file`}
                      </span>
                    </div>
                    <PlaceSelect
                      id={`${ids}-${x.name}`}
                      className="h-11 w-[230px] shrink-0 rounded-[10px] border-[1.5px] border-border-strong bg-card text-[14px]"
                      value={choices[x.name] ?? null}
                      options={{
                        one: fixed !== 2,
                        pairs: fixed !== 1,
                        on: fixed === 2 ? [] : others,
                        flat: fixed !== 2,
                        leave: true,
                      }}
                      onChange={(v) =>
                        setChoices((c) => chooseFor(c, x.name, v))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {preview && (
            <div className="flex flex-col gap-2 rounded-2xl bg-hover p-4 text-[14px] leading-snug">
              <span className="font-semibold">Sewing</span>
              {kind === "drafted" ? (
                <span className="text-body-text">
                  The pieces are placed but not sewn yet. Once they're in, the
                  seam suggestions sew them.
                </span>
              ) : sidecar ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grow">
                    From {sidecar.name}: {preview.sewing?.seams ?? 0} seams (
                    {preview.sewing?.title}).
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCompanion(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-body-text grow">
                    The pieces are placed but not sewn yet. A garment.toml
                    written for this pattern can sew them.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => tomlInput.current?.click()}
                  >
                    Add a garment.toml…
                  </Button>
                  <input
                    ref={tomlInput}
                    type="file"
                    accept=".toml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f)
                        void f
                          .text()
                          .then((text) => setCompanion({ name: f.name, text }));
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {preview && (
            <details className="text-[14px] leading-snug">
              <summary className="cursor-pointer font-semibold">
                {lines.length
                  ? `Left out of the file (${lines.length})`
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
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[14px] font-semibold">
                Import into
              </legend>
              <div className="flex gap-1 rounded-xl bg-hover p-1">
                {(["new", "add"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={into === k}
                    onClick={() => setInto(k)}
                    className={cn(
                      "h-10 flex-1 rounded-[9px] px-3 text-[15px] font-semibold",
                      into === k &&
                        "bg-card shadow-[0_1px_3px_rgba(20,24,31,.15)]",
                    )}
                  >
                    {k === "new" ? "A new project" : `${props.projectName}`}
                  </button>
                ))}
              </div>
            </fieldset>
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
    </Dialog>
  );
}
