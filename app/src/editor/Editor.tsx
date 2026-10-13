// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame: toolbar, panels, viewport, status bar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Redo2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { mainGarment, parseEntities } from '@/document/entities';
import { DocumentStore, useDocument } from '@/document/store';
import { PatternPanel, type Selection } from '@/pattern/PatternPanel';
import { PropertiesPanel } from '@/properties/PropertiesPanel';
import { EngineSession, useEngine } from '@/worker/session';
import { type Example, fetchExample, listExamples } from './examples';
import { StatusBar } from './StatusBar';
import { Viewport } from './Viewport';

export function Editor() {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const store = useMemo(() => new DocumentStore(session), [session]);
  const doc = useDocument(store);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listExamples().then(setExamples, (e: Error) => setError(e.message));
  }, []);

  async function open(name: string, bytes: ArrayBuffer) {
    setError(null);
    try {
      // Revisions keep growing across files, so a drape of the previous file is never newer.
      const rev = store.state.rev + 1;
      const { entities, warnings } = await session.open(bytes, rev);
      store.load(name, parseEntities(entities), warnings, rev);
      setSelection(null);
      session.drape(rev, true);
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !typing && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        if (e.key === 'y' || e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing || mod) return;
      const c = session.state.controls;
      if (e.key === ' ') session.setControls({ paused: !c.paused });
      else if (e.key === 'f' || e.key === 'F') session.setControls({ fast: !c.fast });
      else if (e.key === 'r' || e.key === 'R') session.resetDrape();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [session, store]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <span className="px-2 text-sm font-semibold tracking-tight">Vitryne</span>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
          <FolderOpen /> Open
        </Button>
        <input
          ref={input}
          type="file"
          accept=".vtry"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) await open(f.name, await f.arrayBuffer());
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              Examples <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Sample projects</DropdownMenuLabel>
            {examples.map((ex) => (
              <DropdownMenuItem
                key={ex.file}
                onSelect={async () => {
                  try {
                    await open(ex.file.split('/').pop() ?? ex.file, await fetchExample(ex));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {ex.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <ToolButton label={doc.undoLabel ? `Undo: ${doc.undoLabel} (⌘Z)` : 'Nothing to undo'} disabled={!doc.undoLabel} onClick={() => store.undo()}>
          <Undo2 />
        </ToolButton>
        <ToolButton label={doc.redoLabel ? `Redo: ${doc.redoLabel} (⇧⌘Z)` : 'Nothing to redo'} disabled={!doc.redoLabel} onClick={() => store.redo()}>
          <Redo2 />
        </ToolButton>
        <div className="text-muted-foreground ml-auto truncate px-2 text-sm">
          {doc.empty ? 'No project open' : `${doc.entities.project?.name ?? doc.fileName}${doc.dirty ? ' •' : ''}`}
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        <section className="w-[32%] min-w-56 border-r" aria-label="Pattern">
          <PatternPanel garment={mainGarment(doc.entities)} selection={selection} onSelect={setSelection} />
        </section>
        <section className="relative min-w-0 flex-1" aria-label="3D view">
          <Viewport session={session} />
          {doc.empty && !error && engine.phase !== 'failed' && (
            <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
              Open a .vtry project, or pick one of the examples.
            </div>
          )}
          {(error ?? doc.refused) && (
            <div
              className="bg-background/90 text-destructive border-destructive/40 absolute bottom-4 left-4 flex max-w-[80%] items-start gap-3 rounded-md border p-3 text-sm backdrop-blur"
              role="alert"
            >
              <span>{error ?? doc.refused}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => {
                  setError(null);
                  store.dismissRefused();
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </section>
        <aside className="w-80 shrink-0 border-l" aria-label="Properties">
          <PropertiesPanel store={store} doc={doc} selection={selection} />
        </aside>
      </main>
      <StatusBar engine={engine} warnings={doc.warnings} onDismissNotice={() => session.clearNotice()} />
    </div>
  );
}

function ToolButton(props: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the tooltip working on a disabled button. */}
        <span>
          <Button variant="ghost" size="icon" className="size-8" aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
            {props.children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
