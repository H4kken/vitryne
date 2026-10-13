// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame, after the "Vitryne editor concept" canvas: a top bar, a rail that opens
// one panel at a time, and one canvas showing either the 3D drape or the flat pieces, with a
// status pill, a hint, zoom and a floating tool bar. The start screen covers it while nothing
// is open (the 3D engine starts underneath, so a preset opens fast). A DXF picked or dropped
// opens the import dialog; with the Select tool the 3D view shows where pieces start, and the
// selected one's handles.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis, FastForward, Link2, Pause, Play, RotateCcw, Shapes, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type Addition, addPieces, addSeam, findCut, setLayout, setPlacement, type Bounds } from '@/document/commands';
import { mainGarment } from '@/document/entities';
import type { Placement } from '@/format/schema.gen';
import { DocumentStore, useDocument } from '@/document/store';
import { cn } from '@/lib/utils';
import { type FlatTool, PatternPanel, type PatternView, type Selection } from '@/pattern/PatternPanel';
import { type Place, tidy } from '@/placement/places';
import { FabricPanel, PANEL_TITLES, type PanelId, PiecesPanel, SettingsPanel } from '@/properties/panels';
import { type CutEdge, parseDifferences, parseEdges, parseProposals, type SeamProposal } from '@/sewing/api';
import { SeamsPanel } from '@/sewing/SeamsPanel';
import { LocalStorage } from '@/storage/storage';
import type { PointerTool } from '@/worker/protocol';
import { type EngineState, EngineSession, useEngine } from '@/worker/session';
import { type Example, fetchAvatar, fetchExample, listExamples } from './examples';
import { Gizmo } from './Gizmo';
import { CubeIcon, FabricIcon, FlatIcon, Logo, MoveIcon, PinchIcon, RedoIcon, SelectIcon, TurnIcon, UndoIcon } from './icons';
import { ImportDialog, type TextFile } from './ImportDialog';
import { StartScreen } from './StartScreen';
import { useFiles } from './useFiles';
import { Viewport } from './Viewport';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

type Mode = '3d' | 'flat';

const HINTS: Record<string, string> = {
  '3d:select': 'Select: click a piece, then drag its handles to move it on the body. The drape waits until you pick another tool.',
  '3d:turn': 'Turn: drag to look around, scroll to zoom.',
  '3d:pinch': 'Pinch: drag the fabric to pull it. It settles when you let go.',
  'flat:select': 'Select: click a piece to pick it, drag its round handle to turn it. Drag the background to look around.',
  'flat:move': 'Move: drag a piece to place it.',
  'flat:sew': 'Sew: click an edge, then the edge it is sewn to. Dotted edges are free; coloured ones are already sewn.',
};

/** Random bytes for new ids. */
const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(16)));

/** Text files from a drop or a file input: a DXF, and a garment.toml if there is one. */
async function readPattern(files: FileList | File[]): Promise<{ dxf: TextFile; sidecar: TextFile | null } | null> {
  const list = [...files];
  const dxf = list.find((f) => /\.dxf$/i.test(f.name));
  if (!dxf) return null;
  const toml = list.find((f) => /\.toml$/i.test(f.name));
  return { dxf: { name: dxf.name, text: await dxf.text() }, sidecar: toml ? { name: toml.name, text: await toml.text() } : null };
}

export function Editor() {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const store = useMemo(() => new DocumentStore(session), [session]);
  const storage = useMemo(() => new LocalStorage(), []);
  const doc = useDocument(store);
  const files = useFiles(session, store, storage, doc);
  const [mode, setMode] = useState<Mode>('3d');
  const [panel, setPanel] = useState<PanelId | null>('fabric');
  const [tool, setTool] = useState<PointerTool>('turn');
  const [flatTool, setFlatTool] = useState<FlatTool>('select');
  const [importing, setImporting] = useState<TextFile | null>(null);
  const [importKey, setImportKey] = useState(0);
  const dxfInput = useRef<HTMLInputElement>(null);
  const canvasBox = useRef<HTMLElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 });
  const [selection, setSelection] = useState<Selection>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const pattern = useRef<PatternView>(null);

  useEffect(() => {
    listExamples().then(setExamples, (e: Error) => setExamplesError(e.message));
  }, []);

  const garment = mainGarment(doc.entities);

  // Sewing (M8): the whole edges and each seam's length difference, asked of Rust whenever the
  // pieces or seams change and something shows them; suggestions when the user asks.
  const [edges, setEdges] = useState<CutEdge[]>([]);
  const [differences, setDifferences] = useState<Record<string, number>>({});
  const [finding, setFinding] = useState(false);
  const sewingShown = panel === 'seams' || (mode === 'flat' && flatTool === 'sew');
  const sewingKey = garment ? `${garment.id}` : '';
  const seams = garment?.seams;
  const pieces = garment?.pieces;
  useEffect(() => {
    if (!sewingShown || doc.empty || !garment) return;
    let current = true;
    session.sewingEdges().then(
      (j) => current && setEdges(parseEdges(j)),
      () => current && setEdges([]),
    );
    session.seamDifferences().then(
      (j) => current && setDifferences(parseDifferences(j)),
      () => current && setDifferences({}),
    );
    return () => {
      current = false;
    };
    // `seams` and `pieces` change with edits to them; the rest of the garment doesn't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sewingShown, doc.empty, sewingKey, seams, pieces]);
  // Suggestions and a half-made pick belong to the garment they were made for.
  const [proposalState, setProposalState] = useState<{ key: string; list: SeamProposal[] } | null>(null);
  const [pickState, setPickState] = useState<{ key: string; edge: CutEdge } | null>(null);
  const proposals = proposalState?.key === sewingKey ? proposalState.list : null;
  const firstPick = pickState?.key === sewingKey ? pickState.edge : null;
  const setProposals = useCallback(
    (f: (l: SeamProposal[] | null) => SeamProposal[] | null) =>
      setProposalState((s) => {
        const list = f(s?.key === sewingKey ? s.list : null);
        return list ? { key: sewingKey, list } : null;
      }),
    [sewingKey],
  );
  const setFirstPick = useCallback((edge: CutEdge | null) => setPickState(edge ? { key: sewingKey, edge } : null), [sewingKey]);

  const findSeams = useCallback(async () => {
    setFinding(true);
    try {
      const list = parseProposals(await session.suggestSeams());
      setProposals(() => list);
    } catch (e) {
      files.showError('Could not suggest seams', e as Error);
    } finally {
      setFinding(false);
    }
  }, [session, files, setProposals]);

  const sew = useCallback(
    (p: { a: SeamProposal['a']; b: SeamProposal['b']; pairing?: SeamProposal['pairing'] }) => {
      if (!garment) return false;
      return store.execute((e) => addSeam(e, garment.id, p, crypto.randomUUID()));
    },
    [garment, store],
  );

  const acceptProposal = useCallback(
    (p: SeamProposal) => {
      // Edges taken, so the rest of the list is asked again.
      if (sew(p)) void findSeams();
    },
    [sew, findSeams],
  );

  const pickEdge = useCallback(
    (edge: CutEdge) => {
      if (!firstPick) {
        setFirstPick(edge);
        return;
      }
      if (firstPick.cut === edge.cut && firstPick.from === edge.from && firstPick.to === edge.to) {
        setFirstPick(null);
        return;
      }
      const pick = (x: CutEdge) => JSON.stringify({ cut: x.cut, from: x.from, to: x.to });
      session.joinEdges(pick(firstPick), pick(edge)).then(
        (j) => {
          const [made] = parseProposals(`[${j}]`);
          if (made) sew(made);
          setFirstPick(null);
        },
        (e: Error) => {
          setFirstPick(null);
          files.showError('Could not sew those edges', e);
        },
      );
    },
    [firstPick, session, sew, files, setFirstPick],
  );
  const fabric = garment ? doc.entities.fabrics.find((f) => f.id === garment.fabric) : doc.entities.fabrics[0];
  // A selection only counts in the file it was made in.
  const selected = selection && garment ? findCut(garment, selection.cutId) : undefined;
  const shownSelection = selected ? selection : null;

  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s) setPanel('pieces');
  }, []);

  // Placing pieces: the Select tool in 3D. The cloth waits where it starts.
  const placing = mode === '3d' && tool === 'select' && !doc.empty;
  useEffect(() => {
    if (session.state.controls.placing !== placing) session.setControls({ placing });
  }, [placing, session]);

  // A click with Select in 3D picks a cut of the drape shown.
  const drapeCuts = engine.drape?.info.cuts;
  useEffect(
    () =>
      session.onPicked((i) => {
        const id = i >= 0 ? drapeCuts?.[i] : undefined;
        const f = id && garment ? findCut(garment, id) : undefined;
        select(f ? { kind: 'cut', pieceId: f.piece.id, cutId: f.cut.id } : null);
      }),
    [session, drapeCuts, garment, select],
  );

  // The selected cut's handles, while placing (and while it is in the drape shown).
  const gizmoIndex = placing && selection ? (drapeCuts?.indexOf(selection.cutId) ?? -1) : -1;
  useEffect(() => {
    session.showGizmo(gizmoIndex >= 0 ? gizmoIndex : null);
  }, [session, gizmoIndex]);

  useEffect(() => {
    const el = canvasBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rewrap = useCallback(
    (cutId: string, place: Place) => {
      const g = garment;
      if (!g) return;
      session.rewrap(cutId, place).then(
        (json) => {
          const r = JSON.parse(json) as { placement: Omit<Placement, 'type'>; bounds: Bounds | null };
          store.execute((e) => setPlacement(e, g.id, cutId, { type: 'wrap', ...r.placement }, r.bounds ?? undefined));
        },
        (e: Error) => files.showError('Could not move the piece', e),
      );
    },
    [garment, session, store, files],
  );

  /** A DXF picked or dropped: the import dialog (a garment.toml with it is kept for it). */
  const [droppedSidecar, setDroppedSidecar] = useState<TextFile | null>(null);
  const startImport = async (list: FileList | File[]) => {
    const r = await readPattern(list);
    if (!r) {
      files.showError('Not imported', new Error('pick a DXF-AAMA pattern (.dxf)'));
      return;
    }
    setDroppedSidecar(r.sidecar);
    setImportKey((k) => k + 1);
    setImporting(r.dxf);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      void startImport(e.dataTransfer.files);
    },
  };

  const runImport = async (o: { dxf: TextFile; sidecar: TextFile | null; choices: Record<string, unknown>; into: 'new' | 'add' }) => {
    const choices = JSON.stringify(o.choices);
    if (o.into === 'add' && garment) {
      const a = JSON.parse(await session.importAddition({ name: o.dxf.name, dxf: o.dxf.text, sidecar: o.sidecar?.text ?? '', choices, seed: seed() })) as Addition;
      if (!store.execute((e) => addPieces(e, garment.id, a))) throw new Error(store.state.refused ?? 'the pieces could not be added');
      if (a.notes.length) files.showInfo(a.notes.join('. '));
    } else {
      const avatar = await fetchAvatar();
      const name = `${o.dxf.name.replace(/\.dxf$/i, '')}.vtry`;
      await files.importNew(async (rev) => ({
        name,
        ...(await session.importNew({ name: o.dxf.name, dxf: o.dxf.text, sidecar: o.sidecar?.text ?? '', choices, avatar, seed: seed() }, rev)),
      }));
      setSelection(null);
      setMode('3d');
    }
    setImporting(null);
  };

  const openPreset = (ex: Example) =>
    files.openData({ name: ex.file.split('/').pop() ?? ex.file, form: 'zip' }, async () => ({ form: 'zip', bytes: await fetchExample(ex) }));

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
  const saveState = files.busy ? `${files.busy}…` : doc.dirty ? 'Unsaved changes' : files.notice?.kind === 'ok' ? files.notice.text : doc.fileName;

  const recoveryBanner = files.recovery && (
    <div className="mx-auto mt-2 flex w-[calc(100%-64px)] max-w-[1056px] flex-wrap items-center gap-3 rounded-2xl border border-[#E1E4DE] bg-white px-5 py-3 text-[15px]" role="status">
      <span className="grow">
        Unsaved changes to <strong>{files.recovery.fileName}</strong> from {new Date(files.recovery.at).toLocaleString()} were kept in this
        browser.
      </span>
      <Button onClick={() => void files.recovery?.recover()}>Recover</Button>
      <Button variant="ghost" onClick={() => files.recovery?.discard()}>
        Discard
      </Button>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Back to start" onClick={() => files.close()} className="flex items-center rounded-lg">
              <Logo />
            </button>
          </TooltipTrigger>
          <TooltipContent>Back to start</TooltipContent>
        </Tooltip>
        <span className="mx-1 h-6 w-px bg-[#E1E4DE]" />
        <span className="max-w-[40vw] truncate text-[15px] font-semibold">{doc.entities.project?.name ?? doc.fileName}</span>
        <span className={cn('truncate text-[13px]', doc.dirty ? 'text-foreground' : 'text-muted-foreground')} title={files.ref?.name}>
          {saveState}
        </span>
        <span className="grow" />
        <IconButton label={doc.undoLabel ? `Undo: ${doc.undoLabel} (${MOD}Z)` : 'Nothing to undo'} disabled={!doc.undoLabel} onClick={() => store.undo()}>
          <UndoIcon />
        </IconButton>
        <IconButton label={doc.redoLabel ? `Redo: ${doc.redoLabel} (⇧${MOD}Z)` : 'Nothing to redo'} disabled={!doc.redoLabel} onClick={() => store.redo()}>
          <RedoIcon />
        </IconButton>
        <Button variant="outline" className="w-[176px] font-medium" onClick={() => setMode(mode === '3d' ? 'flat' : '3d')}>
          {mode === '3d' ? <FlatIcon /> : <CubeIcon />}
          {mode === '3d' ? 'Show flat pieces' : 'Show 3D'}
        </Button>
        <Button onClick={() => void files.save()} disabled={doc.empty || !!files.busy}>
          Save
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => files.openFile()}>
              Open… <DropdownMenuShortcut>{MOD}O</DropdownMenuShortcut>
            </DropdownMenuItem>
            {storage.opensFolders && <DropdownMenuItem onSelect={() => files.openFolder()}>Open a folder project…</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => dxfInput.current?.click()}>Import a pattern (DXF)…</DropdownMenuItem>
            <DropdownMenuItem disabled={doc.empty} onSelect={() => void files.saveAs()}>
              Save as… <DropdownMenuShortcut>⇧{MOD}S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => files.close()}>Close the project</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 grow">
        {/* Rail */}
        <nav aria-label="Panels" className="flex w-20 shrink-0 flex-col gap-1.5 border-r bg-white px-2 py-3">
          <RailButton id="fabric" icon={<FabricIcon />} panel={panel} setPanel={setPanel} />
          <RailButton id="pieces" icon={<Shapes className="size-6" strokeWidth={1.6} />} panel={panel} setPanel={setPanel} />
          <RailButton id="seams" icon={<Link2 className="size-6" strokeWidth={1.6} />} panel={panel} setPanel={setPanel} />
          <RailButton id="settings" icon={<SlidersHorizontal className="size-6" strokeWidth={1.6} />} panel={panel} setPanel={setPanel} />
        </nav>
        {/* Panel */}
        {panel && (
          <aside aria-label={PANEL_TITLES[panel]} className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-r bg-white p-5">
            <h2 className="font-display m-0 text-xl font-semibold">{PANEL_TITLES[panel]}</h2>
            {panel === 'fabric' && <FabricPanel store={store} fabric={fabric} />}
            {panel === 'pieces' && (
              <PiecesPanel
                store={store}
                garment={garment}
                selection={shownSelection}
                onSelect={select}
                onRewrap={rewrap}
                onPlaceIn3d={placing ? null : () => (setMode('3d'), setTool('select'))}
              />
            )}
            {panel === 'seams' && (
              <SeamsPanel
                store={store}
                garment={garment}
                differences={differences}
                proposals={proposals}
                finding={finding}
                onFind={() => void findSeams()}
                onAccept={acceptProposal}
                onSkip={(i) => setProposals((list) => list?.filter((_, k) => k !== i) ?? null)}
                picking={mode === 'flat' && flatTool === 'sew'}
                firstPicked={firstPick !== null}
                onStartPicking={() => (setMode('flat'), setFlatTool('sew'))}
                onStopPicking={() => (setFlatTool('select'), setFirstPick(null))}
              />
            )}
            {panel === 'settings' && <SettingsPanel store={store} entities={doc.entities} />}
          </aside>
        )}

        {/* Canvas */}
        <section ref={canvasBox} aria-label={mode === '3d' ? '3D view' : 'Flat pieces'} className="bg-canvas-3d relative min-w-0 grow overflow-hidden" {...dropProps}>
          {/* The 3D view stays mounted (and simulating) under the flat view. */}
          <div className="absolute inset-0">
            <Viewport session={session} tool={tool} />
          </div>
          {placing && engine.gizmo && selected?.cut.placement.type === 'wrap' && gizmoIndex >= 0 && (
            <Gizmo
              view={engine.gizmo}
              width={canvasSize.w}
              height={canvasSize.h}
              placement={selected.cut.placement as Placement & { type: 'wrap' }}
              onPreview={(p) => session.placeCut(gizmoIndex, tidy(p))}
              onCommit={(p) => garment && store.execute((e) => setPlacement(e, garment.id, selected.cut.id, tidy(p)))}
            />
          )}
          {mode === 'flat' && (
            <div className="absolute inset-0">
              <PatternPanel
                ref={pattern}
                garment={garment}
                selection={shownSelection}
                onSelect={select}
                tool={flatTool}
                sewing={{ edges, picked: firstPick, onPick: pickEdge }}
                onArrange={(cutId, t) => garment && store.execute((e) => setLayout(e, garment.id, cutId, { position: [t.x, t.y], rotation: t.rot }))}
              />
            </div>
          )}

          <div className="absolute top-4 left-4 flex max-w-[calc(100%-32px)] flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill engine={engine} mode={mode} placing={placing} />
              {doc.warnings.length + (engine.drape?.info.warnings.length ?? 0) > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="rounded-full border border-[#E9D6A6] bg-[#FBF3DC] px-3.5 py-2 text-sm font-medium">
                      {doc.warnings.length + (engine.drape?.info.warnings.length ?? 0)} note(s)
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 whitespace-pre-line">{[...doc.warnings, ...(engine.drape?.info.warnings ?? [])].join('\n')}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {engine.notice && <Card onDismiss={() => session.clearNotice()}>{engine.notice}</Card>}
            {files.notice?.kind === 'info' && <Card onDismiss={() => files.dismissNotice()}>{files.notice.text}</Card>}
            {engine.drapeError && <Card tone="error">The drape could not be built: {engine.drapeError}</Card>}
            {message && (
              <Card
                tone="error"
                onDismiss={() => {
                  files.dismissNotice();
                  setExamplesError(null);
                  store.dismissRefused();
                }}
              >
                {message}
              </Card>
            )}
          </div>

          {engine.phase === 'failed' && (
            <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-8">
              <div className="max-w-md space-y-2 rounded-[20px] border bg-white p-7 text-[15px]">
                <p className="font-display m-0 text-xl font-semibold">The 3D view keeps stopping</p>
                <p className="text-muted-foreground m-0">It was not restarted again. Last reason: {engine.failure}</p>
                <p className="m-0">Your project is still here: save it, then reload the page.</p>
              </div>
            </div>
          )}

          <div className="text-muted-foreground pointer-events-none absolute bottom-5 left-4 max-w-60 text-[13px] leading-snug">
            {placing && selected?.cut.placement.type === 'follow'
              ? 'This piece sits on another one: it moves with it. Change that in the Pieces panel.'
              : HINTS[mode === 'flat' ? `flat:${flatTool}` : `3d:${tool}`]}
          </div>

          <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-[10px] border border-[#E1E4DE] bg-white p-0.5">
            <ZoomButton label="Zoom out" onClick={() => (mode === 'flat' ? pattern.current?.zoom(1 / 1.25) : session.wheel(-1))}>
              −
            </ZoomButton>
            {mode === 'flat' && (
              <button type="button" onClick={() => pattern.current?.reset()} className="h-9 min-w-11 rounded-lg px-1 text-[13px] font-medium hover:bg-[#F4F5F2]">
                Fit
              </button>
            )}
            <ZoomButton label="Zoom in" onClick={() => (mode === 'flat' ? pattern.current?.zoom(1.25) : session.wheel(1))}>
              +
            </ZoomButton>
          </div>

          {mode === '3d' && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-[#14181F] p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
              <ToolButton label="Select" selected={tool === 'select'} onClick={() => setTool('select')}>
                <SelectIcon />
              </ToolButton>
              <ToolButton label="Turn view" selected={tool === 'turn'} onClick={() => setTool('turn')}>
                <TurnIcon />
              </ToolButton>
              <ToolButton label="Pinch fabric" selected={tool === 'pinch'} onClick={() => setTool('pinch')}>
                <PinchIcon />
              </ToolButton>
              <span className="mx-1 my-2 w-px bg-white/20" />
              <ToolButton
                label={engine.controls.paused ? 'Play (space)' : 'Pause (space)'}
                onClick={() => {
                  // Play while placing means "drape now".
                  if (placing) setTool('turn');
                  session.setControls({ paused: placing ? false : !engine.controls.paused });
                }}
              >
                {engine.controls.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
              </ToolButton>
              <ToolButton label="Fast drape (F)" selected={engine.controls.fast} onClick={() => session.setControls({ fast: !engine.controls.fast })}>
                <FastForward className="size-5" />
              </ToolButton>
              <ToolButton label="Drape again from the start (R)" onClick={() => session.resetDrape()}>
                <RotateCcw className="size-5" />
              </ToolButton>
            </div>
          )}
          {mode === 'flat' && !doc.empty && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-[#14181F] p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
              <ToolButton label="Select" selected={flatTool === 'select'} onClick={() => setFlatTool('select')}>
                <SelectIcon />
              </ToolButton>
              <ToolButton label="Move" selected={flatTool === 'move'} onClick={() => setFlatTool('move')}>
                <MoveIcon />
              </ToolButton>
              <ToolButton
                label="Sew two edges"
                selected={flatTool === 'sew'}
                onClick={() => {
                  setFlatTool('sew');
                  setPanel('seams');
                }}
              >
                <Link2 className="size-5" />
              </ToolButton>
            </div>
          )}
        </section>
      </div>

      {doc.empty && (
        <StartScreen
          examples={examples}
          busy={files.busy}
          onPreset={openPreset}
          onOpen={() => files.openFile()}
          onImport={() => dxfInput.current?.click()}
          dropProps={dropProps}
          onOpenFolder={storage.opensFolders ? () => files.openFolder() : null}
          banner={
            <>
              {recoveryBanner}
              {message && (
                <div className="mx-auto mt-2 w-[calc(100%-64px)] max-w-[1056px]">
                  <Card tone="error" onDismiss={() => (files.dismissNotice(), setExamplesError(null))}>
                    {message}
                  </Card>
                </div>
              )}
            </>
          }
        />
      )}
      {!doc.empty && files.recovery && <div className="absolute inset-x-0 top-16 z-20">{recoveryBanner}</div>}

      <input
        ref={dxfInput}
        type="file"
        accept=".dxf,.toml"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? [...e.target.files] : [];
          e.target.value = '';
          if (list.length) void startImport(list);
        }}
      />
      <ImportDialog
        key={importKey}
        dxf={importing}
        initialSidecar={droppedSidecar}
        session={session}
        projectName={doc.empty ? null : (doc.entities.project?.name ?? doc.fileName)}
        onClose={() => setImporting(null)}
        onImport={runImport}
      />

      <Dialog open={!!files.unsaved} onOpenChange={(open) => !open && files.unsaved?.cancel()}>
        <DialogContent className="rounded-[20px] p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">Save your changes?</DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              {doc.entities.project?.name ?? doc.fileName} has changes that aren't saved. They are lost if you don't save them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => files.unsaved?.cancel()}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => files.unsaved?.discard()}>
              Don't save
            </Button>
            <Button onClick={() => void files.unsaved?.save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ engine, mode, placing }: { engine: EngineState; mode: Mode; placing: boolean }) {
  let text: string;
  let dot = 'bg-live live-dot';
  if (engine.phase === 'failed') [text, dot] = ['3D view stopped', 'bg-destructive'];
  else if (engine.progress) text = `${engine.progress.task}… ${Math.round(engine.progress.fraction * 100)}%`;
  else if (engine.phase === 'starting') [text, dot] = ['Starting the 3D view…', 'bg-line live-dot'];
  else if (engine.drapeError) [text, dot] = ['The drape stopped', 'bg-destructive'];
  else if (mode === 'flat') [text, dot] = ['Flat pieces. 3D follows your edits', 'bg-live'];
  else if (placing) [text, dot] = ['Placing pieces. The drape waits', 'bg-line'];
  else if (engine.controls.paused) [text, dot] = ['Paused', 'bg-line'];
  else text = 'Fabric is settling live';
  const s = engine.stats;
  const detail = s
    ? `${s.vertices.toLocaleString()} points · ${s.fps.toFixed(0)} fps · ${Number.isNaN(s.frameMs) ? '–' : s.frameMs.toFixed(1)} ms of GPU per frame · ${s.simTime.toFixed(1)} s simulated`
    : 'No drape yet';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="status" className="flex items-center gap-2 rounded-full border border-[#E1E4DE] bg-white px-3.5 py-2 text-sm font-medium">
          <span className={cn('size-2 rounded-full', dot)} />
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

function Card(props: { tone?: 'error'; onDismiss?: () => void; children: React.ReactNode }) {
  return (
    <div
      role={props.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex max-w-[480px] items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm leading-snug shadow-[0_8px_24px_rgba(20,24,31,.08)]',
        props.tone === 'error' ? 'border-[#F0C9BE] text-[#8A2410]' : 'border-[#E1E4DE]',
      )}
    >
      <span className="grow">{props.children}</span>
      {props.onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={props.onDismiss} className="text-muted-foreground hover:text-foreground -m-1 p-1">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function RailButton(props: { id: PanelId; icon: React.ReactNode; panel: PanelId | null; setPanel: (p: PanelId | null) => void }) {
  const on = props.panel === props.id;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => props.setPanel(on ? null : props.id)}
      className={cn('flex h-16 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold', on ? 'bg-[#E8ECE4]' : 'hover:bg-[#F4F5F2]')}
    >
      {props.icon}
      {PANEL_TITLES[props.id]}
    </button>
  );
}

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the tooltip working on a disabled button. */}
        <span>
          <Button variant="ghost" size="icon" aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
            {props.children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function ToolButton(props: { label: string; selected?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          aria-pressed={props.selected}
          onClick={props.onClick}
          className={cn(
            'flex size-11 items-center justify-center rounded-[10px]',
            props.selected ? 'bg-white text-[#14181F]' : 'text-white hover:bg-white/10',
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function ZoomButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={props.label} onClick={props.onClick} className="size-9 rounded-lg text-lg hover:bg-[#F4F5F2]">
      {props.children}
    </button>
  );
}
