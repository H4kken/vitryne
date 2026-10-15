// SPDX-License-Identifier: AGPL-3.0-or-later
// What the editor shows with nothing open: the person's projects (or draft), start from a preset
// (the bundled examples), or import a file, picked or dropped anywhere here: a DXF pattern, or a
// .vtry project, which becomes a new project. Starting from scratch comes later.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Example, fetchExample } from './examples';
import { ImportIcon, Logo, PRESET_ART, PresetsIcon } from './icons';

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
  /** The account button, and the person's projects if they have any. */
  account: React.ReactNode;
  projects: React.ReactNode;
  projectsTitle: string;
}) {
  const [examplesOpen, setExamplesOpen] = useState(true);
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

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3.5 px-8 pt-14 pb-7">
        <h1 className="font-display m-0 text-[52px] leading-[1.05] font-bold tracking-[-0.025em] max-sm:text-[38px]">What do you want to make?</h1>
        <p className="text-body-text m-0 max-w-[620px] text-[19px] leading-normal">
          Start from something that already works, or bring your own pattern. Your work is saved as you go, and you can change anything later.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-[1120px] flex-wrap gap-3.5 px-8 pt-2 pb-4">
        <button
          type="button"
          onClick={() => setExamplesOpen((o) => !o)}
          aria-expanded={examplesOpen}
          className="bg-primary flex min-h-[92px] flex-[1_1_240px] items-center gap-3.5 rounded-2xl border-2 border-[#14181F] px-5 py-4 text-left text-white transition-opacity hover:opacity-95"
        >
          <PresetsIcon className="shrink-0 text-white" />
          <span className="flex grow flex-col gap-0.5">
            <span className="font-display text-xl font-semibold">Start from an example</span>
            <span className="text-on-ink-muted text-sm">Ready-made garments</span>
          </span>
          <ChevronDown className={cn('size-5 shrink-0 transition-transform', examplesOpen && 'rotate-180')} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={props.onImport}
          className="flex min-h-[92px] flex-[1_1_240px] items-center gap-3.5 rounded-2xl border-2 border-[#CFD4CB] bg-white px-5 py-4 text-left transition-colors hover:border-[#14181F]"
        >
          <ImportIcon className="text-foreground shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-xl font-semibold">Import a file</span>
            <span className="text-muted-foreground text-sm">A DXF pattern or a .vtry project, or drop it here</span>
          </span>
        </button>
      </div>
      {props.onOpenFolder && (
        <div className="mx-auto w-full max-w-[1120px] px-8 pb-2">
          <button type="button" onClick={props.onOpenFolder} className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
            Open a project saved as a folder
          </button>
        </div>
      )}

      {props.projects && (
        <div className="mx-auto w-full max-w-[1120px] px-8 pt-1 pb-4">
          <div className="flex flex-col gap-2 rounded-[20px] border border-[#E1E4DE] bg-white p-5 shadow-[0_2px_8px_rgba(20,24,31,.04)]">
            <span className="text-muted-foreground text-sm font-semibold tracking-[0.06em] uppercase">{props.projectsTitle}</span>
            {props.projects}
          </div>
        </div>
      )}

      {examplesOpen && (
        <div className="mx-auto w-full max-w-[1120px] px-8 pt-1 pb-12">
          <div className="flex flex-col gap-4 rounded-[20px] border border-[#E1E4DE] bg-white p-5 shadow-[0_2px_8px_rgba(20,24,31,.04)]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm font-semibold tracking-[0.06em] uppercase">Example projects</span>
              <span className="text-muted-foreground text-xs">Click any garment to drape in 3D</span>
            </div>
            <div className="flex flex-wrap gap-4">
              {[...props.examples].sort((a, b) => rank(a) - rank(b)).map((ex) => {
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
                    className="flex min-w-0 flex-[1_1_200px] flex-col overflow-hidden rounded-2xl border border-[#E1E4DE] bg-white text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-[0_10px_24px_rgba(20,24,31,.10)] disabled:opacity-60 cursor-pointer"
                  >
                    <span className="flex h-[150px] items-center justify-center" style={{ background: art?.bg ?? '#E8ECE4' }}>
                      {art && (
                        <svg width="120" height="100" viewBox="0 0 120 100" aria-hidden="true">
                          {art.art}
                        </svg>
                      )}
                    </span>
                    <span className="flex flex-col gap-0.5 px-4 pt-3 pb-4">
                      <span className="font-display text-lg font-semibold">{ex.title.replace(/\s*\(.*\)$/, '')}</span>
                      <span className="text-muted-foreground text-sm">{PRESET_NOTES[id] ?? ex.title}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
