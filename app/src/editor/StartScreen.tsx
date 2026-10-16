// SPDX-License-Identifier: AGPL-3.0-or-later
// What the editor shows with nothing open, like a design tool's home: a Create row (import a
// file, picked or dropped anywhere here: a DXF pattern, or a .vtry project; or start from one
// of the bundled examples), then the person's projects as cards. Starting from scratch comes
// later.

import { type Example, fetchExample } from './examples';
import { ImportIcon, Logo, PRESET_ART } from './icons';

/** What each bundled example is made of. */
const PRESET_NOTES: Record<string, string> = {
  tshirt: 'Front, back and two sleeves',
  trousers: 'Two fronts and two backs',
  hoodie: 'Hood, pocket and sleeves',
};

const presetId = (e: Example) => (e.file.split('/').pop() ?? e.file).replace(/\.vtry$/, '');

/** The concept's order; any other example after them. */
const ORDER = ['tshirt', 'trousers', 'hoodie'];
const rank = (e: Example) => (ORDER.indexOf(presetId(e)) + ORDER.length + 1) % (ORDER.length + 1);

const TILE =
  'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E1E4DE] bg-white text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-[0_10px_24px_rgba(20,24,31,.10)] disabled:opacity-60 cursor-pointer';

export function StartScreen(props: {
  examples: Example[];
  onPreset: (e: Example) => void;
  /** Picks a DXF pattern or a .vtry project. */
  onImport: () => void;
  /** Dropping a DXF (and its garment.toml), or a .vtry, here imports it. */
  dropProps: { onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  onOpenFolder: (() => void) | null;
  busy: string | null;
  banner?: React.ReactNode;
  /** The account button. */
  account: React.ReactNode;
  /** The person's projects (a grid), once they are known. */
  projects: React.ReactNode;
}) {
  return (
    <div className="bg-background absolute inset-0 z-30 flex flex-col overflow-y-auto" {...props.dropProps}>
      <div className="flex h-16 shrink-0 flex-wrap items-center gap-3 px-8">
        <Logo />
        <span className="font-display text-xl font-bold tracking-[-0.01em]">Vitryne</span>
        <span className="grow" />
        <span className="text-muted-foreground text-sm max-sm:hidden">Free · no account needed to try</span>
        {props.account}
      </div>
      {props.banner}

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-8 pt-10 pb-14">
        <section aria-labelledby="create-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 id="create-title" className="font-display m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.02em] max-sm:text-[32px]">
              What do you want to make?
            </h1>
            <p className="text-body-text m-0 text-[17px]">Start from an example or bring your own pattern. Your work is saved as you go.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            <button type="button" onClick={props.onImport} disabled={!!props.busy} className={`${TILE} border-2 border-dashed border-[#CFD4CB] hover:border-[#14181F]`}>
              <span className="flex aspect-[4/3] w-full items-center justify-center">
                <ImportIcon className="text-foreground" />
              </span>
              <span className="flex flex-col gap-0.5 px-4 pt-1 pb-4">
                <span className="font-display text-lg font-semibold">Import a file</span>
                <span className="text-muted-foreground text-sm">A DXF pattern or a .vtry project, or drop it here</span>
              </span>
            </button>
            {[...props.examples]
              .sort((a, b) => rank(a) - rank(b))
              .map((ex) => {
                const id = presetId(ex);
                const art = PRESET_ART[id];
                return (
                  <button
                    key={ex.file}
                    type="button"
                    disabled={!!props.busy}
                    onClick={() => props.onPreset(ex)}
                    onPointerEnter={() => void fetchExample(ex).catch(() => undefined)}
                    onFocus={() => void fetchExample(ex).catch(() => undefined)}
                    className={TILE}
                  >
                    <span className="flex aspect-[4/3] w-full items-center justify-center" style={{ background: art?.bg ?? '#E8ECE4' }}>
                      {art && (
                        <svg width="120" height="100" viewBox="0 0 120 100" aria-hidden="true">
                          {art.art}
                        </svg>
                      )}
                    </span>
                    <span className="flex flex-col gap-0.5 px-4 pt-3 pb-4">
                      <span className="font-display text-lg font-semibold">{ex.title.replace(/\s*\(.*\)$/, '')}</span>
                      <span className="text-muted-foreground text-sm">{PRESET_NOTES[id] ?? 'Example'}</span>
                    </span>
                  </button>
                );
              })}
          </div>
          {props.onOpenFolder && (
            <button type="button" onClick={props.onOpenFolder} className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4">
              Open a project saved as a folder
            </button>
          )}
        </section>

        {props.projects}
      </div>
    </div>
  );
}
