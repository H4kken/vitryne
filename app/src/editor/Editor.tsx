// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame: toolbar, panels, viewport, status bar, and the dialogs around files.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FolderOpen, Redo2, Save, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { mainGarment } from '@/document/entities';
import { DocumentStore, useDocument } from '@/document/store';
import { PatternPanel, type Selection } from '@/pattern/PatternPanel';
import { PropertiesPanel } from '@/properties/PropertiesPanel';
import { LocalStorage } from '@/storage/storage';
import { EngineSession, useEngine } from '@/worker/session';
import { type Example, fetchExample, listExamples } from './examples';
import { StatusBar } from './StatusBar';
import { useFiles } from './useFiles';
import { Viewport } from './Viewport';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function Editor() {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const store = useMemo(() => new DocumentStore(session), [session]);
  const storage = useMemo(() => new LocalStorage(), []);
  const doc = useDocument(store);
  const files = useFiles(session, store, storage, doc);
  const [selection, setSelection] = useState<Selection>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);

  useEffect(() => {
    listExamples().then(setExamples, (e: Error) => setExamplesError(e.message));
  }, []);

  // A different file: nothing selected in it yet.
  const garmentId = mainGarment(doc.entities)?.id;
  const shownSelection = selection && mainGarment(doc.entities)?.pieces.some((p) => p.id === selection.id) ? selection : null;

  const { save, saveAs, openFile } = files;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        // Let a field being edited commit first.
        if (typing) (e.target as HTMLElement).blur();
        if (e.shiftKey) void saveAs();
        else void save();
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        openFile();
        return;
      }
      if (mod && !typing && (k === 'z' || k === 'y')) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing || mod) return;
      const c = session.state.controls;
      if (e.key === ' ') session.setControls({ paused: !c.paused });
      else if (k === 'f') session.setControls({ fast: !c.fast });
      else if (k === 'r') session.resetDrape();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [session, store, save, saveAs, openFile]);

  const message = files.notice?.kind === 'error' ? files.notice.text : (examplesError ?? doc.refused);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <span className="px-2 text-sm font-semibold tracking-tight">Vitryne</span>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <FolderOpen /> File <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem onSelect={() => files.openFile()}>
              Open… <DropdownMenuShortcut>{MOD}O</DropdownMenuShortcut>
            </DropdownMenuItem>
            {storage.opensFolders && <DropdownMenuItem onSelect={() => files.openFolder()}>Open folder project…</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={doc.empty} onSelect={() => void files.save()}>
              Save <DropdownMenuShortcut>{MOD}S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={doc.empty} onSelect={() => void files.saveAs()}>
              Save as… <DropdownMenuShortcut>⇧{MOD}S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Examples</DropdownMenuLabel>
            {examples.map((ex) => (
              <DropdownMenuItem
                key={ex.file}
                onSelect={() => files.openData({ name: ex.file.split('/').pop() ?? ex.file, form: 'zip' }, async () => ({ form: 'zip', bytes: await fetchExample(ex) }))}
              >
                {ex.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton label={`Save (${MOD}S)`} disabled={doc.empty || !!files.busy} onClick={() => void files.save()}>
          <Save />
        </ToolButton>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <ToolButton label={doc.undoLabel ? `Undo: ${doc.undoLabel} (${MOD}Z)` : 'Nothing to undo'} disabled={!doc.undoLabel} onClick={() => store.undo()}>
          <Undo2 />
        </ToolButton>
        <ToolButton label={doc.redoLabel ? `Redo: ${doc.redoLabel} (⇧${MOD}Z)` : 'Nothing to redo'} disabled={!doc.redoLabel} onClick={() => store.redo()}>
          <Redo2 />
        </ToolButton>
        <div className="text-muted-foreground ml-auto truncate px-2 text-sm" title={files.ref?.name}>
          {doc.empty ? 'No project open' : `${doc.entities.project?.name ?? doc.fileName}${doc.dirty ? ' •' : ''}`}
        </div>
      </header>
      {files.recovery && (
        <div className="flex items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm" role="status">
          <span className="flex-1">
            Unsaved changes to <strong>{files.recovery.fileName}</strong> from {new Date(files.recovery.at).toLocaleString()} were kept in this
            browser.
          </span>
          <Button size="sm" onClick={() => void files.recovery?.recover()}>
            Recover
          </Button>
          <Button size="sm" variant="ghost" onClick={() => files.recovery?.discard()}>
            Discard
          </Button>
        </div>
      )}
      <main className="flex min-h-0 flex-1">
        <section className="w-[32%] min-w-56 border-r" aria-label="Pattern">
          <PatternPanel key={garmentId} garment={mainGarment(doc.entities)} selection={shownSelection} onSelect={setSelection} />
        </section>
        <section className="relative min-w-0 flex-1" aria-label="3D view">
          <Viewport session={session} />
          {doc.empty && !message && engine.phase !== 'failed' && (
            <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
              Open a .vtry project, or pick one of the examples in the File menu.
            </div>
          )}
          {message && (
            <div
              className="bg-background/90 text-destructive border-destructive/40 absolute bottom-4 left-4 flex max-w-[80%] items-start gap-3 rounded-md border p-3 text-sm backdrop-blur"
              role="alert"
            >
              <span>{message}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => {
                  files.dismissNotice();
                  setExamplesError(null);
                  store.dismissRefused();
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </section>
        <aside className="w-80 shrink-0 border-l" aria-label="Properties">
          <PropertiesPanel store={store} doc={doc} selection={shownSelection} />
        </aside>
      </main>
      <StatusBar
        engine={engine}
        warnings={doc.warnings}
        activity={files.busy ? `${files.busy}…` : files.notice?.kind === 'ok' ? files.notice.text : null}
        onDismissNotice={() => session.clearNotice()}
      />
      <Dialog open={!!files.unsaved} onOpenChange={(open) => !open && files.unsaved?.cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save the changes to {doc.entities.project?.name ?? doc.fileName}?</DialogTitle>
            <DialogDescription>Your changes are lost if you don't save them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => files.unsaved?.cancel()}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => files.unsaved?.discard()}>
              Don't save
            </Button>
            <Button onClick={() => void files.unsaved?.save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
