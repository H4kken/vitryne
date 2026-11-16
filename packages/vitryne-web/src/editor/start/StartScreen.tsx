// SPDX-License-Identifier: AGPL-3.0-or-later
// What the editor shows with nothing open, like a design tool's home: a Create row (import a
// file, picked or dropped anywhere here: a DXF or Valentina pattern, or a .vtry project; start from
// scratch; or start from one of the bundled examples), then the person's projects as cards.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DOCS_URL } from "@/links";
import {
  type Example,
  exampleId,
  fetchExample,
  startExample,
} from "../examples";
import { Logo } from "../icons/Logo";
import { HeroSection } from "./HeroSection";
import { GithubStars } from "./GithubStars";
import { StartFooter } from "./StartFooter";
import { PRESET_ART } from "../icons/presetArt";
import { ArrowRight, Import, PencilRuler } from "lucide-react";

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
  "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-left ease-weighted transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_10px_24px_rgba(20,24,31,.10)] active:scale-[0.98] disabled:opacity-60 cursor-pointer";

export function StartScreen(props: {
  examples: Example[];
  /** The instance's legal pages (packages/vitryne-docs/content/docs/developers/cloud.md): linked in plain sight at the foot of the page. */
  privacyPolicy: string | null;
  termsOfService: string | null;
  /** The landing hero: only for people with nothing saved; everyone else wants their projects first. */
  showHero: boolean;
  /** A real account (not an anonymous draft): the top bar drops the Start drafting button. */
  signedIn: boolean;
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
  const open = () => {
    const ex = startExample(props.examples);
    if (ex) props.onPreset(ex);
  };
  const start = (
    <Button
      className="button-md ease-weighted h-auto rounded-lg px-3 py-2 duration-300 active:scale-[0.98]"
      disabled={!!props.busy}
      onClick={open}
    >
      Start drafting
    </Button>
  );
  const startWithArrow = (
    <Button
      className="button-lg ease-weighted h-auto rounded-xl px-6 py-3 duration-300 active:scale-[0.98]"
      disabled={!!props.busy}
      onClick={open}
    >
      Start drafting
      <ArrowRight className="size-6" />
    </Button>
  );
  const Title = props.showHero ? "h2" : "h1";
  const hasFiles = (e: React.DragEvent) =>
    e.dataTransfer.types.includes("Files");
  return (
    <div
      className="start-page bg-background absolute inset-0 z-30"
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
          className="bg-background/90 pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-6 backdrop-blur-sm"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-4 border-dashed border-foreground bg-card/70 text-center">
            <Import className="text-foreground size-14" />
            <span className="heading-4">Drop to import</span>
            <span className="body-3 text-muted-foreground">
              A DXF, Valentina or Seamly2D pattern, or a .vtry project
            </span>
          </div>
        </div>
      )}
      {/* The scroller is the size container the hero's height reads; it makes `fixed` children
          relative to itself, so the drop overlay lives outside it. */}
      <div className="flex h-full flex-col overflow-y-auto [container-type:size]">
        <a
          href="#main"
          className="bg-foreground text-background sr-only rounded-lg px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        {/* A full width bar fixed to the top of the page. Its items share one 36px height and an 8px radius. */}
        <header className="bg-background/50 sticky top-0 z-30 flex shrink-0 flex-wrap backdrop-blur-md items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-2 [&_[data-size=icon]]:size-9 [&_a]:h-9 [&_a]:rounded-lg [&_a]:border-transparent [&_button]:h-9 [&_button:not([data-avatar])]:rounded-lg [&_img]:rounded-lg">
          <div className="flex items-center gap-2">
            <Logo size={36} />
            <span className="heading-6">Vitryne</span>
            {/* On a phone there is no room: the footer has the links. */}
            <Button variant="ghost" className="max-sm:hidden" asChild>
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                Docs
              </a>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <GithubStars />
            {props.account}
            {!props.signedIn && start}
          </div>
        </header>
        {props.banner}

        <main id="main" className="flex grow flex-col">
          {props.showHero && <HeroSection action={startWithArrow} />}

          <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-8 pt-10 pb-14 grow">
            <section
              aria-labelledby="create-title"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                {/* The hero has the page's h1; without it this heading is the page's. */}
                <Title id="create-title" className="heading-3 m-0">
                  What do you want to make?
                </Title>
                <p className="body-3 text-body-text m-0">
                  Start from scratch, from an example, or bring your own
                  pattern. Your work is saved as you go. New here?{" "}
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
                className="flex w-full min-w-0 cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-input bg-card px-5 py-4 text-left ease-weighted transition-[color,border-color,transform] duration-300 hover:border-foreground active:scale-[0.98] disabled:opacity-60"
              >
                <Import className="text-foreground size-6 shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span className="title-2">Import a file</span>
                  <span className="caption-2 text-muted-foreground">
                    Drop a file here or click to browse. DXF, Valentina or
                    Seamly2D pattern, or a .vtry project
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
                        onFocus={() =>
                          void fetchExample(ex).catch(() => undefined)
                        }
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
                          <span className="title-2">
                            {ex.title.replace(/\s*\(.*\)$/, "")}
                          </span>
                          <span className="caption-2 text-muted-foreground">
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
                    <span className="title-2">Start from scratch</span>
                    <span className="caption-2 text-muted-foreground">
                      An empty garment on the body
                    </span>
                  </span>
                </button>
              </div>
              {props.onOpenFolder && (
                <button
                  type="button"
                  onClick={props.onOpenFolder}
                  className="text-muted-foreground hover:text-foreground caption-2 self-start underline underline-offset-4"
                >
                  Open a project saved as a folder
                </button>
              )}
            </section>

            {props.projects}
          </div>
        </main>
        <StartFooter
          privacyPolicy={props.privacyPolicy}
          termsOfService={props.termsOfService}
        />
      </div>
    </div>
  );
}
