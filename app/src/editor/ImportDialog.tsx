// SPDX-License-Identifier: AGPL-3.0-or-later
// Importing a DXF-AAMA pattern (docs/ARCHITECTURE.md, Import and placement): what the file
// holds and what was left out of it, then where each piece goes on the body (suggested from
// its name, the user decides), an optional garment.toml for the sewing, and whether the pieces
// make a new project or join the open one.

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
import { encodeChoice } from "./encodeChoice";
import { leftOut } from "./leftOut";
import { decodeChoice } from "./decodeChoice";
import { ImportThumb } from "./ImportThumb";

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
  | { type: "on"; piece: string };

/** Rust `import::Preview`. */
export interface Preview {
  file_name: string;
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
  /** The DXF to import; the dialog is open while there is one. */
  dxf: TextFile | null;
  /** A garment.toml that came with the DXF (dropped together). */
  initialSidecar?: TextFile | null;
  session: EngineSession;
  /** The open project's name, if any: the pieces can join it. */
  projectName: string | null;
  onClose: () => void;
  onImport: (o: {
    dxf: TextFile;
    sidecar: TextFile | null;
    choices: Record<string, Choice>;
    into: "new" | "add";
  }) => Promise<void>;
}) {
  const { dxf, session } = props;
  // The parent mounts a new dialog per DXF, so this starts over each time.
  const [sidecar, setSidecar] = useState<TextFile | null>(
    props.initialSidecar ?? null,
  );
  /** The newest reading, for the DXF and sidecar it was made from. */
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

  const key = `${dxf?.name ?? ""}|${sidecar?.name ?? ""}`;
  useEffect(() => {
    if (!dxf) return;
    let stale = false;
    session.inspectDxf(dxf.name, dxf.text, sidecar?.text ?? "").then(
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
  }, [dxf, sidecar, session, key]);
  const current = reading?.key === key ? reading : null;
  const preview = current?.preview ?? null;
  const error = runError ?? current?.error ?? null;

  const missing = preview?.pieces.filter((x) => !choices[x.name]) ?? [];
  const placed =
    preview?.pieces.filter(
      (x) => choices[x.name] && choices[x.name] !== "leave",
    ) ?? [];
  const lines = preview ? leftOut(preview) : [];

  const run = async () => {
    if (!dxf || !preview) return;
    setBusy(true);
    setRunError(null);
    try {
      await props.onImport({
        dxf,
        sidecar,
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
      open={!!dxf}
      onOpenChange={(open) => !open && !busy && props.onClose()}
    >
      <DialogContent className="flex max-h-[calc(100vh-32px)] flex-col gap-5 rounded-[20px] p-6 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Import a pattern
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {preview
              ? `${dxf?.name}: ${preview.pieces.length} piece${preview.pieces.length === 1 ? "" : "s"}. Choose where each one goes on the body; you can move them afterwards.`
              : error
                ? `${dxf?.name} could not be read.`
                : `Reading ${dxf?.name}…`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6">
          {preview && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {preview.pieces.map((x) => {
                const fixed = x.cuts;
                const others = preview.pieces
                  .filter((o) => o.name !== x.name)
                  .map((o) => ({ key: o.name, label: o.name }));
                return (
                  <li
                    key={x.name}
                    className="flex items-center gap-3 rounded-2xl border border-[#E1E4DE] p-2.5"
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
                      className="h-11 w-[230px] shrink-0 rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white text-[14px]"
                      value={choices[x.name] ?? null}
                      options={{
                        one: fixed !== 2,
                        pairs: fixed !== 1,
                        on: fixed === 2 ? [] : others,
                        leave: true,
                      }}
                      onChange={(v) =>
                        setChoices((c) => ({ ...c, [x.name]: v }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {preview && (
            <div className="flex flex-col gap-2 rounded-2xl bg-[#F4F5F2] p-4 text-[14px] leading-snug">
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
                    onClick={() => setSidecar(null)}
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
                          .then((text) => setSidecar({ name: f.name, text }));
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
                <li>
                  Units:{" "}
                  {preview.report.units_m === 0.001
                    ? "millimetres"
                    : `${preview.report.units_m * 1000} mm per drawing unit`}
                </li>
              </ul>
            </details>
          )}

          {preview && props.projectName && (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[14px] font-semibold">
                Import into
              </legend>
              <div className="flex gap-1 rounded-xl bg-[#F4F5F2] p-1">
                {(["new", "add"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={into === k}
                    onClick={() => setInto(k)}
                    className={cn(
                      "h-10 flex-1 rounded-[9px] px-3 text-[15px] font-semibold",
                      into === k &&
                        "bg-white shadow-[0_1px_3px_rgba(20,24,31,.15)]",
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
              className="m-0 rounded-2xl border border-[#F0C9BE] bg-white px-4 py-3 text-[14px] text-[#8A2410]"
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
