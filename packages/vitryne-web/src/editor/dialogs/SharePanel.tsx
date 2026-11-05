// SPDX-License-Identifier: AGPL-3.0-or-later
// The Share panel, like Canva's: a popover under the Share button with the link on top (who can
// open the project, Copy link) and a Download row that opens the formats. Download the draped garment as glTF 2.0 (.glb) or Wavefront OBJ (.obj + .mtl), or the
// whole project as a .vtry file (a backup, or to open in another Vitryne). No pattern (.dxf)
// export until seam allowance exists: a DXF of sewing lines isn't ready to cut (the exporter
// and `vitryne export` stay, docs/RELEASE_REVIEW.md).

import { type RefObject, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { EngineSession } from "@/worker/session";
import { LinkAccess } from "./LinkAccess";

type ExportFormat = "glb" | "obj" | "vtry";

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function cancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

interface FilePickerWindow {
  showSaveFilePicker?(o: unknown): Promise<FileSystemFileHandle>;
}

/** Saves to a file the person picks where the browser can, else downloads; false if they cancelled. */
async function saveAs(
  name: string,
  blob: Blob,
  type: { description: string; accept: Record<string, string[]> },
): Promise<boolean> {
  const win = window as unknown as FilePickerWindow;
  if (typeof win.showSaveFilePicker === "function") {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: name,
        types: [type],
      });
      const w = await (
        handle as FileSystemFileHandle & {
          createWritable(): Promise<{
            write(d: Blob): Promise<void>;
            close(): Promise<void>;
          }>;
        }
      ).createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (cancelled(e)) return false;
      // Fall back to browser download
    }
  }
  downloadBlob(name, blob);
  return true;
}

export interface SharePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Share button: the panel opens under it, and clicking it again is not "outside". */
  anchor: RefObject<HTMLElement | null>;
  session: EngineSession;
  garmentName: string;
  /** The project as a .vtry file (zip form), as confirmed now. */
  projectFile: () => Promise<ArrayBuffer>;
  /** The saved project; null while the document isn't in the cloud yet. */
  projectId: string | null;
  /** Whether the link is on now. */
  shared: boolean;
  /** Turns the link on or off; throws what went wrong. */
  setShared: (shared: boolean) => Promise<void>;
  /** False while there is nothing to download (no pieces yet). */
  canDownload: boolean;
}

const FORMATS: { id: ExportFormat; title: string; note: string }[] = [
  {
    id: "glb",
    title: "glTF 2.0 (.glb)",
    note: "Recommended: one file, opens in Blender and most 3D tools",
  },
  {
    id: "obj",
    title: "Wavefront (.obj)",
    note: "Two files, .obj and .mtl, for almost any 3D software",
  },
  {
    id: "vtry",
    title: "Project (.vtry)",
    note: "The whole project, to keep a copy or open in another Vitryne",
  },
];

export function SharePanel({
  open,
  onOpenChange,
  anchor,
  session,
  garmentName,
  projectFile,
  projectId,
  shared,
  setShared,
  canDownload,
}: SharePanelProps) {
  const [view, setView] = useState<"main" | "download">("main");
  const [format, setFormat] = useState<ExportFormat>("glb");
  const [includeAvatar, setIncludeAvatar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName =
    garmentName.trim().replace(/[\\/:*?"<>|]/g, "_") || "garment";

  const change = (o: boolean) => {
    if (!o) {
      setView("main");
      setError(null);
    }
    onOpenChange(o);
  };

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
      let done = true;
      if (format === "vtry") {
        const type = "application/vnd.vitryne.project+zip";
        done = await saveAs(
          `${cleanName}.vtry`,
          new Blob([await projectFile()], { type }),
          { description: "Vitryne project", accept: { [type]: [".vtry"] } },
        );
      } else if (format === "glb") {
        const glb = await session.exportGlb(includeAvatar);
        done = await saveAs(
          `${cleanName}.glb`,
          new Blob([glb], { type: "model/gltf-binary" }),
          {
            description: "glTF 2.0 Binary",
            accept: { "model/gltf-binary": [".glb"] },
          },
        );
      } else {
        const res = await session.exportObj(includeAvatar);
        downloadBlob(
          `${cleanName}.obj`,
          new Blob([res.obj], { type: "text/plain" }),
        );
        downloadBlob(
          `${cleanName}.mtl`,
          new Blob([res.mtl], { type: "text/plain" }),
        );
      }
      if (done) change(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={change} modal={false}>
      <PopoverAnchor
        virtualRef={anchor as RefObject<{ getBoundingClientRect(): DOMRect }>}
      />
      <PopoverContent
        className="w-[360px]"
        aria-label="Share"
        onInteractOutside={(e) => {
          // The Share button toggles the panel itself.
          if (anchor.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {view === "main" ? (
          <div className="flex flex-col gap-4 p-5">
            <h2 className="font-display m-0 text-lg font-semibold">Share</h2>
            <LinkAccess
              projectId={projectId}
              shared={shared}
              setShared={setShared}
            />
            <Separator />
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => setView("download")}
              className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-hover">
                <Download className="size-5" />
              </span>
              <span className="flex min-w-0 grow flex-col">
                <span className="text-[14px] font-medium">Download</span>
                <span className="text-muted-foreground text-[12px]">
                  {canDownload
                    ? "A 3D model, or the whole project"
                    : "Add a piece to download"}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setView("main")}
                className="text-muted-foreground hover:text-foreground -ml-1 rounded-md p-1"
              >
                <ChevronLeft className="size-5" />
              </button>
              <h2 className="font-display m-0 text-lg font-semibold">
                Download
              </h2>
            </div>
            <div
              role="radiogroup"
              aria-label="Format"
              className="flex flex-col gap-1.5"
            >
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={format === f.id}
                  onClick={() => setFormat(f.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    format === f.id
                      ? "border-foreground bg-hover"
                      : "border-border hover:bg-hover",
                  )}
                >
                  <span className="flex min-w-0 grow flex-col">
                    <span className="text-[14px] font-medium">{f.title}</span>
                    <span className="text-muted-foreground text-[12px]">
                      {f.note}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {format !== "vtry" && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <Label
                    htmlFor="include-avatar"
                    className="cursor-pointer text-[14px] font-medium"
                  >
                    Include avatar
                  </Label>
                  <span className="text-muted-foreground text-[12px]">
                    The body as a separate object. Sizes are in metres.
                  </span>
                </div>
                <Switch
                  id="include-avatar"
                  checked={includeAvatar}
                  onCheckedChange={setIncludeAvatar}
                />
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
            <Button
              onClick={() => void onExport()}
              disabled={busy || !canDownload}
              className="w-full gap-2 font-semibold"
            >
              <Download className="size-4" />
              {busy ? "Downloading…" : "Download"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
