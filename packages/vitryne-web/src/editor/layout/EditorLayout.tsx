// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame, after the "Vitryne editor concept" canvas: a top bar, a rail that opens
// one panel at a time, and the flat pieces and the 3D drape side by side, each with a status
// pill, notices and a floating tool bar. It is the layout of every URL: the route's screen goes
// in its outlet (src/routes/: the start screen at `/`, a loading or error page while a project
// URL opens), over the editor, so the 3D engine starts underneath and a preset opens fast. It
// owns the engine, the document and the open file; the hooks beside it (../hooks/) hold the
// rest of the editor's state, and the components here draw it.

import { useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { AccountDialog } from "@/cloud/AccountDialog";
import { CloudProjectsDialog } from "@/cloud/CloudProjectsDialog";
import type { Cloud } from "@/cloud/useCloud";
import { mainGarment } from "@/document/entities";
import { DocumentStore, useDocument } from "@/document/store";
import type { OutlineNode, Vec2 } from "@/format/schema.gen";

import type { ShapeKind } from "@/pattern/draw";
import { DiskFiles } from "@/storage/storage";
import type { PointerTool } from "@/worker/protocol";
import { EngineSession, useEngine } from "@/worker/session";
import { BlockedDialog } from "../dialogs/BlockedDialog";
import { ExportDialog } from "../dialogs/ExportDialog";
import { ImportDialog } from "../dialogs/ImportDialog";
import { NewPieceDialog } from "../dialogs/NewPieceDialog";
import { ReplaceDraftDialog } from "../dialogs/ReplaceDraftDialog";
import { UnsavedDialog } from "../dialogs/UnsavedDialog";
import { EditorContext } from "../EditorContext";
import { useAccountGate } from "../hooks/useAccountGate";
import { useCutColors } from "../hooks/useCutColors";
import { useDraftReplace } from "../hooks/useDraftReplace";
import { useDrapeControls } from "../hooks/useDrapeControls";
import { useExamples } from "../hooks/useExamples";
import { useFiles } from "../hooks/useFiles";
import { useFollowOpen } from "../hooks/useFollowOpen";
import { useGoogleReturn } from "../hooks/useGoogleReturn";
import { useImport } from "../hooks/useImport";
import { useModHeld } from "../hooks/useModHeld";
import { useNewProject } from "../hooks/useNewProject";
import { useOtherFabrics } from "../hooks/useOtherFabrics";
import { usePanel } from "../hooks/usePanel";
import { usePickedActions } from "../hooks/usePickedActions";
import { usePieceActions } from "../hooks/usePieceActions";
import { useSelection } from "../hooks/useSelection";
import { useSewing } from "../hooks/useSewing";
import { useShortcuts } from "../hooks/useShortcuts";
import { useSplitView } from "../hooks/useSplitView";
import { useStarted } from "../hooks/useStarted";
import { useThumbnails } from "../hooks/useThumbnails";
import { useWarningsLog } from "../hooks/useWarningsLog";
import { StartPage } from "../start/StartPage";
import { DrapeView } from "./DrapeView";
import { FlatView } from "./FlatView";
import { NoticeCards } from "./NoticeCards";
import { Rail } from "./Rail";
import { RecoveryBanner } from "./RecoveryBanner";
import { SidePanel } from "./SidePanel";
import { Splitter } from "./Splitter";
import { useDrapeMemory } from "../hooks/useDrapeMemory";
import { TopBar } from "./TopBar";
import type { FlatTool, PatternView } from "@/pattern/panel/types";

export function EditorLayout({ cloud }: { cloud: Cloud }) {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const store = useMemo(() => new DocumentStore(session), [session]);
  const disk = useMemo(() => new DiskFiles(), []);
  const doc = useDocument(store);
  const files = useFiles(session, store, disk, doc, cloud);
  useDrapeMemory(session, store, doc, engine);
  const ready = useStarted(files.started);
  useFollowOpen(files, doc.empty, ready);
  const navigate = useNavigate();
  const openProject = (id: string) =>
    void navigate({ to: "/design/$id", params: { id } });
  useThumbnails(
    session,
    engine,
    files.ref?.cloud?.id ?? null,
    !files.blocked,
    cloud,
  );
  useWarningsLog(doc.warnings, engine.drape?.info.warnings);

  const isAccount = !!cloud.user && !cloud.user.anonymous;
  const account = useAccountGate(isAccount);
  const openAccount = () => account.setOpen(true);
  const [cloudOpen, setCloudOpen] = useState(false);
  const draftReplace = useDraftReplace(cloud);
  const google = useGoogleReturn(cloud, files, openAccount);
  const examples = useExamples();

  const { workspaceRef, ...view } = useSplitView();
  const panels = usePanel();
  const loadOthers = useOtherFabrics(
    isAccount,
    cloud.backend,
    files.ref?.cloud?.id ?? null,
    store,
  );
  const [tool, setTool] = useState<PointerTool>("select");
  const [flatTool, setFlatTool] = useState<FlatTool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const modHeld = useModHeld();
  /** A piece the pen drew, being named and placed: its outline and where it was drawn. */
  const [adding, setAdding] = useState<{
    outline: OutlineNode[];
    origin: Vec2;
    key: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pattern = useRef<PatternView>(null);

  const garment = mainGarment(doc.entities);
  const selection = useSelection({
    session,
    garment,
    panel: panels.panel,
    setPanel: panels.setPanel,
  });
  const sewing = useSewing({
    session,
    store,
    garment,
    shown: panels.panel === "pieces" || (view.show2d && flatTool === "sew"),
    empty: doc.empty,
    showError: files.showError,
  });
  const { placing, gizmoIndex } = useDrapeControls({
    session,
    engine,
    garment,
    show3d: view.show3d,
    tool,
    empty: doc.empty,
    sewing: view.show2d && flatTool === "sew",
    selection: selection.selection,
    select: selection.select,
  });
  const cutColors = useCutColors(doc.entities, garment);
  // How far out each cut starts in the drape shown (the Layers view says so).
  const info = engine.drape?.info;
  const startsOut = useMemo(
    () =>
      new Map(
        (info?.cuts ?? []).map((id, k) => [id, info?.starts_out_mm[k] ?? 0]),
      ),
    [info],
  );
  const { rewrap, addNewPiece, pasteCopies } = usePieceActions({
    session,
    store,
    garment,
    pattern,
    showError: files.showError,
    onAdded: (pieceId, cutId) => {
      setAdding(null);
      setFlatTool("select");
      selection.setSelection({ kind: "cut", pieceId, cutId });
    },
  });
  const imports = useImport({
    session,
    store,
    files,
    garment,
    empty: doc.empty,
    startNew: draftReplace.startNew,
    confirmReplace: draftReplace.confirmReplace,
    onNewProject: () => {
      selection.setSelection(null);
      view.setShow3d(true);
    },
  });
  const begin = useNewProject({
    session,
    files,
    startNew: draftReplace.startNew,
    onScratch: () => {
      selection.setSelection(null);
      view.setShow2d(true);
      view.setShow3d(false);
    },
  });
  const importFile = () => fileInput.current?.click();
  const exportIt = () =>
    account.need("Create a free account to export.", () => setExporting(true));
  const sewTool = () => {
    setFlatTool("sew");
    selection.setSelection(null);
    selection.setOpenSeam(null);
    panels.setPanel("pieces");
  };
  const picked = usePickedActions({
    store,
    garment,
    selection: selection.shown,
    showInfo: files.showInfo,
    pattern,
    onRemoved: () => selection.setSelection(null),
    onPaste: (copied) =>
      void pasteCopies(copied).catch((e: Error) =>
        files.showError("Could not paste", e),
      ),
  });
  useShortcuts({
    session,
    store,
    save: files.save,
    fileInput,
    show2d: view.show2d,
    show3d: view.show3d,
    setTool,
    flatTool,
    setFlatTool,
    onSew: sewTool,
    garment,
    removePicked: picked.remove,
    copyPicked: picked.copy,
    pastePicked: picked.paste,
    duplicatePicked: picked.duplicate,
    flipPicked: picked.flip,
    clearPicked: () => {
      if (!selection.shown) return false;
      selection.setSelection(null);
      return true;
    },
  });

  const message =
    files.notice?.kind === "error"
      ? files.notice.text
      : (examples.error ?? doc.refused);
  const recoveryBanner = files.recovery && (
    <RecoveryBanner recovery={files.recovery} />
  );
  const cards = (
    <NoticeCards
      session={session}
      engine={engine}
      files={files}
      isAccount={isAccount}
      onAccount={openAccount}
      message={message}
      onDismissMessage={() => {
        files.dismissNotice();
        examples.dismissError();
        store.dismissRefused();
      }}
    />
  );
  const startScreen = (
    <StartPage
      cloud={cloud}
      examples={examples.examples ?? []}
      busy={files.busy}
      hasDraft={!!draftReplace.draft}
      onPreset={begin.openPreset}
      onScratch={begin.startScratch}
      onImport={importFile}
      dropProps={imports.dropProps}
      onOpenFolder={disk.opensFolders ? begin.openFolder : null}
      onAccount={openAccount}
      onOpenProject={openProject}
      recoveryBanner={recoveryBanner}
      message={message}
      onDismissMessage={() => {
        files.dismissNotice();
        examples.dismissError();
      }}
    />
  );

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        doc={doc}
        store={store}
        files={files}
        view={view}
        cloud={cloud}
        garment={garment}
        onAccount={openAccount}
        onExport={exportIt}
      />

      <div className="relative flex min-h-0 grow">
        <Rail panel={panels.panel} setPanel={panels.setPanel} />
        <SidePanel
          panels={panels}
          store={store}
          doc={doc}
          garment={garment}
          loadOthers={loadOthers}
          selection={selection}
          sewing={sewing}
          rewrap={rewrap}
          onPlaceIn3d={
            placing ? null : () => (view.setShow3d(true), setTool("select"))
          }
          startsOut={startsOut}
          onFlip={(axis) => void picked.flip(axis)}
        />

        {/* Workspace views: 2D window on the left, 3D on the right */}
        <section
          ref={workspaceRef}
          aria-label="Workspace views"
          className="relative flex min-w-0 grow overflow-hidden"
          {...imports.dropProps}
        >
          <FlatView
            view={view}
            pattern={pattern}
            doc={doc}
            store={store}
            files={files}
            engine={engine}
            garment={garment}
            selection={selection}
            sewing={sewing}
            cutColors={cutColors}
            flatTool={flatTool}
            setFlatTool={setFlatTool}
            shapeKind={shapeKind}
            setShapeKind={setShapeKind}
            modHeld={modHeld}
            placing={placing}
            cards={!view.show3d && cards}
            importFile={importFile}
            onDrawn={(outline, origin) =>
              setAdding({ outline, origin, key: Date.now() })
            }
            addNewPiece={addNewPiece}
            onSew={sewTool}
            picked={picked}
          />
          <Splitter view={view} />
          <DrapeView
            view={view}
            session={session}
            engine={engine}
            store={store}
            garment={garment}
            tool={tool}
            setTool={setTool}
            placing={placing}
            selected={selection.selected}
            gizmoIndex={gizmoIndex}
            cards={cards}
            picked={picked}
          />
        </section>
      </div>

      {view.isResizing && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
      )}

      <EditorContext
        value={{
          files,
          doc,
          ready,
          examples: examples.examples,
          examplesError: examples.error,
          startScreen,
        }}
      >
        <Outlet />
      </EditorContext>
      {!doc.empty && recoveryBanner && (
        <div className="absolute inset-x-0 top-16 z-20">{recoveryBanner}</div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".dxf,.toml,.val,.vit,.vst,.sm2d,.smis,.smms,.vtry"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          if (list.length) void imports.startImport(list);
        }}
      />
      <ImportDialog
        key={imports.importKey}
        pattern={imports.importing}
        initialCompanion={imports.droppedCompanion}
        session={session}
        projectName={
          doc.empty ? null : (doc.entities.project?.name ?? doc.fileName)
        }
        onClose={imports.closeImport}
        onImport={imports.runImport}
      />
      <NewPieceDialog
        key={adding?.key}
        open={adding}
        defaultName={`Piece ${(garment?.pieces.length ?? 0) + 1}`}
        onClose={() => setAdding(null)}
        onAdd={(n) => addNewPiece(n, adding?.origin)}
      />
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        session={session}
        garmentName={doc.entities.project?.name ?? garment?.name ?? "garment"}
        projectFile={async () => {
          const data = await session.save((await store.settled()).rev, "zip");
          if (data.form !== "zip")
            throw new Error("internal: the worker did not give the zip form");
          return data.bytes;
        }}
      />

      {account.open && (
        <AccountDialog
          cloud={cloud}
          open
          onOpenChange={(o) => {
            if (o) return account.setOpen(true);
            google.clearError();
            account.dismiss();
          }}
          reason={account.reason}
          onInfo={files.showInfo}
          onMoved={files.projectsMoved}
          onGoogle={google.continueWithGoogle}
          returnError={google.error}
          recovering={google.recovering}
        />
      )}
      <CloudProjectsDialog
        cloud={cloud}
        open={cloudOpen}
        onOpenChange={setCloudOpen}
        busy={!!files.busy}
        onOpen={openProject}
      />

      <ReplaceDraftDialog
        name={draftReplace.replacing?.name ?? null}
        onAnswer={draftReplace.answer}
        onAccount={() => {
          const answer = draftReplace.take();
          account.need("Create a free account to keep several projects.", () =>
            answer?.(true),
          );
        }}
      />
      <UnsavedDialog files={files} doc={doc} />
      <BlockedDialog files={files} doc={doc} />
    </div>
  );
}
