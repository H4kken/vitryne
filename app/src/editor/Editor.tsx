// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame: toolbar, panels, viewport, status bar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { EngineSession, useEngine } from '@/worker/session';
import { type Example, fetchExample, listExamples } from './examples';
import { StatusBar } from './StatusBar';
import { Viewport } from './Viewport';

interface OpenFile {
  name: string;
  title: string;
  warnings: string[];
}

export function Editor() {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listExamples().then(setExamples, (e: Error) => setError(e.message));
  }, []);

  async function open(name: string, bytes: ArrayBuffer) {
    setError(null);
    try {
      const { entities, warnings } = await session.open(bytes, 0);
      const e = JSON.parse(entities) as { project?: { name?: string } };
      setFile({ name, title: e.project?.name ?? name, warnings });
      session.drape(0, true);
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const c = session.state.controls;
      if (e.key === ' ') session.setControls({ paused: !c.paused });
      else if (e.key === 'f' || e.key === 'F') session.setControls({ fast: !c.fast });
      else if (e.key === 'r' || e.key === 'R') session.resetDrape();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [session]);

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
        <div className="text-muted-foreground ml-auto truncate px-2 text-sm">{file ? file.title : 'No project open'}</div>
      </header>
      <main className="relative min-h-0 flex-1">
        <Viewport session={session} />
        {!file && !error && engine.phase !== 'failed' && (
          <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
            Open a .vtry project, or pick one of the examples.
          </div>
        )}
        {error && (
          <div className="bg-destructive/15 text-destructive absolute inset-x-4 top-4 rounded-md p-3 text-sm" role="alert">
            {error}
          </div>
        )}
      </main>
      <StatusBar engine={engine} warnings={file?.warnings ?? []} onDismissNotice={() => session.clearNotice()} />
    </div>
  );
}
