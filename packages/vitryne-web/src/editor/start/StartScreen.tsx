// SPDX-License-Identifier: AGPL-3.0-or-later
// What the editor shows with nothing open, like a design tool's home: a Create row (import a
// file, picked or dropped anywhere here: a DXF or Valentina pattern, or a .vtry project; start from
// scratch; or start from one of the bundled examples), then the person's projects as cards.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DOCS_URL } from "@/links";
import { type Example, exampleId, fetchExample } from "../examples";
import { Logo } from "../icons/Logo";
import { PRESET_ART } from "../icons/presetArt";
import { Import, PencilRuler } from "lucide-react";

/** What each bundled example is made of. */
const PRESET_NOTES: Record<string, string> = {
  tshirt: "Front, back and two sleeves",
  trousers: "Two fronts and two backs",
  hoodie: "Hood, pocket and sleeves",
};

/** The concept's order; any other example after them. */
const ORDER = ["tshirt", "trousers", "hoodie"];
const rank = (e: Example) =>
  (ORDER.indexOf(exampleId(e)) + ORDER.length + 1) % (ORDER.length + 1);

const TILE =
  "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-[0_10px_24px_rgba(20,24,31,.10)] disabled:opacity-60 cursor-pointer";

export function StartScreen(props: {
  examples: Example[];
  onPreset: (e: Example) => void;
  /** An empty project. */
  onScratch: () => void;
  /** Picks a pattern (DXF, or Valentina with its measurements) or a .vtry project. */
  onImport: () => void;
  /** Dropping a pattern (a DXF and its garment.toml, a .val and its measurements), or a .vtry, here imports it. */
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  onOpenFolder: (() => void) | null;
  busy: string | null;
  banner?: React.ReactNode;
  /** The account button. */
  account: React.ReactNode;
  /** The person's projects (a grid), once they are known. */
  projects: React.ReactNode;
}) {
  // Dragging a file over the window shows a full-screen drop zone. Enter/leave fire for every child
  // the pointer crosses, so count them instead of toggling.
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("Files");
  return (
    <div
      className="bg-background absolute inset-0 z-30 flex flex-col overflow-y-auto"
      onDragOver={props.dropProps.onDragOver}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        depth.current = 0;
        setDragging(false);
        props.dropProps.onDrop(e);
      }}
    >
      {dragging && (
        <div
          aria-hidden="true"
          className="bg-background/90 pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6 backdrop-blur-sm"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-4 border-dashed border-foreground bg-card/70 text-center">
            <Import className="text-foreground size-14" />
            <span className="font-display text-3xl font-bold tracking-[-0.02em]">
              Drop to import
            </span>
            <span className="text-muted-foreground text-base">
              A DXF, Valentina or Seamly2D pattern, or a .vtry project
            </span>
          </div>
        </div>
      )}
      <div className="flex h-16 shrink-0 flex-wrap items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">
          Vitryne
        </span>
        <Button variant="ghost" asChild>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Docs
          </a>
        </Button>
        <span className="grow" />
        <span className="text-muted-foreground text-sm max-sm:hidden">
          Free · no account needed to try
        </span>
        {props.account}
      </div>
      {props.banner}

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-8 pt-10 pb-14">
        <section aria-labelledby="create-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1
              id="create-title"
              className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em] max-sm:text-[32px]"
            >
              What do you want to make?
            </h1>
            <p className="text-body-text m-0 text-[17px]">
              Start from scratch, from an example, or bring your own pattern.
              Your work is saved as you go. New here?{" "}
              <a
                href={`${DOCS_URL}/guide/editor-overview`}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                Read the guide
              </a>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={props.onImport}
            disabled={!!props.busy}
            className="flex w-full min-w-0 cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-input bg-card px-5 py-4 text-left transition-colors duration-150 hover:border-foreground disabled:opacity-60"
          >
            <Import className="text-foreground size-6 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="font-display text-lg font-semibold">
                Import a file
              </span>
              <span className="text-muted-foreground text-sm">
                Drop a file here or click to browse. DXF, Valentina or Seamly2D
                pattern, or a .vtry project
              </span>
            </span>
          </button>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {/* The separator sits in the grid gap, so it takes no cell of its own. */}
            {[...props.examples]
              .sort((a, b) => rank(a) - rank(b))
              .map((ex) => {
                const id = exampleId(ex);
                const art = PRESET_ART[id];
                return (
                  <button
                    key={ex.file}
                    type="button"
                    disabled={!!props.busy}
                    onClick={() => props.onPreset(ex)}
                    onPointerEnter={() =>
                      void fetchExample(ex).catch(() => undefined)
                    }
                    onFocus={() => void fetchExample(ex).catch(() => undefined)}
                    className={TILE}
                  >
                    <span
                      className="flex aspect-[4/3] w-full items-center justify-center"
                      style={{ background: art?.bg ?? "#E8ECE4" }}
                    >
                      {art && (
                        <svg
                          width="120"
                          height="100"
                          viewBox="0 0 120 100"
                          aria-hidden="true"
                        >
                          {art.art}
                        </svg>
                      )}
                    </span>
                    <span className="flex flex-col gap-0.5 px-4 pt-3 pb-4">
                      <span className="font-display text-lg font-semibold">
                        {ex.title.replace(/\s*\(.*\)$/, "")}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {PRESET_NOTES[id] ?? "Example"}
                      </span>
                    </span>
                  </button>
                );
              })}
            <button
              type="button"
              onClick={props.onScratch}
              disabled={!!props.busy}
              className={`${TILE} border-2 border-input hover:border-foreground`}
            >
              <span className="bg-muted flex aspect-[4/3] w-full items-center justify-center">
                <PencilRuler
                  className="text-foreground size-10"
                  strokeWidth={1.75}
                />
              </span>
              <span className="flex flex-col gap-0.5 px-4 pt-3 pb-4">
                <span className="font-display text-lg font-semibold">
                  Start from scratch
                </span>
                <span className="text-muted-foreground text-sm">
                  An empty garment on the body
                </span>
              </span>
            </button>
          </div>
          {props.onOpenFolder && (
            <button
              type="button"
              onClick={props.onOpenFolder}
              className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
            >
              Open a project saved as a folder
            </button>
          )}
        </section>

        {props.projects}
      </div>
    </div>
  );
}
