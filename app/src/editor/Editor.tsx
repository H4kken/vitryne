// SPDX-License-Identifier: AGPL-3.0-or-later
// The editor's frame, after the "Vitryne editor concept" canvas: a top bar, a rail that opens
// one panel at a time, and one canvas showing either the 3D drape or the flat pieces, with a
// status pill, a hint, zoom and a floating tool bar. The start screen covers it while nothing
// is open (the 3D engine starts underneath, so a preset opens fast). A DXF picked or dropped
// opens the import dialog; with the Select tool the 3D view shows where pieces start, and the
// selected one's handles.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud as CloudIcon,
  Download,
  FastForward,
  GripVertical,
  Link2,
  Spline,
  Pause,
  PencilRuler,
  PenTool,
  Play,
  RotateCcw,
  Shapes,
  SlidersHorizontal,
  SquarePlus,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SaveStatus } from "@/cloud/autosave";
import { AccountDialog, CloudProjectsDialog } from "@/cloud/CloudDialogs";
import { ProjectGrid } from "@/cloud/ProjectGrid";
import { moveProjects } from "@/cloud/projects";
import type { Cloud } from "@/cloud/useCloud";
import {
  type Addition,
  addPiece,
  addPieces,
  addSeam,
  cutColor,
  findCut,
  renameProject,
  removeCuts,
  setLayouts,
  setPlacement,
  type Bounds,
} from "@/document/commands";
import { mainGarment } from "@/document/entities";
import type { OutlineNode, Placement, Vec2 } from "@/format/schema.gen";
import { type DocState, DocumentStore, useDocument } from "@/document/store";
import { cn } from "@/lib/utils";
import {
  type FlatTool,
  PatternPanel,
  type PatternView,
  type Selection,
} from "@/pattern/PatternPanel";
import { newPiece, type ShapeKind } from "@/pattern/draw";
import { PAIRS, type Pair, type Place, tidy } from "@/placement/places";
import {
  FabricPanel,
  PANEL_TITLES,
  type PanelId,
  PiecesPanel,
  SettingsPanel,
} from "@/properties/panels";
import {
  type CutEdge,
  parseDifferences,
  parseEdges,
  parseProposals,
  sameEdge,
  type SeamProposal,
} from "@/sewing/api";
import { SeamsPanel } from "@/sewing/SeamsPanel";
import { DiskFiles } from "@/storage/storage";
import type { PointerTool } from "@/worker/protocol";
import { type EngineState, EngineSession, useEngine } from "@/worker/session";
import {
  type Example,
  fetchAvatar,
  fetchExample,
  listExamples,
} from "./examples";
import { Gizmo } from "./Gizmo";
import {
  CubeIcon,
  FabricIcon,
  FlatIcon,
  Logo,
  MoveIcon,
  PinchIcon,
  RedoIcon,
  SelectIcon,
  TurnIcon,
  UndoIcon,
} from "./icons";
import { ExportDialog } from "./ExportDialog";
import { ImportDialog, type TextFile } from "./ImportDialog";
import { type NewPiece, NewPieceDialog } from "./NewPieceDialog";
import { ShapeBar } from "@/pattern/ShapeBar";
import { StartScreen } from "./StartScreen";
import { useFiles } from "./useFiles";
import { useProjectRoute } from "./useProjectRoute";
import { useThumbnails } from "./useThumbnails";
import { Viewport } from "./Viewport";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Random bytes for new ids. */
const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(16)));

/** Text files from a drop or a file input: a DXF, and a garment.toml if there is one. */
async function readPattern(
  files: FileList | File[],
): Promise<{ dxf: TextFile; sidecar: TextFile | null } | null> {
  const list = [...files];
  const dxf = list.find((f) => /\.dxf$/i.test(f.name));
  if (!dxf) return null;
  const toml = list.find((f) => /\.toml$/i.test(f.name));
  return {
    dxf: { name: dxf.name, text: await dxf.text() },
    sidecar: toml ? { name: toml.name, text: await toml.text() } : null,
  };
}

export function Editor({ cloud }: { cloud: Cloud }) {
  const session = useMemo(() => new EngineSession(), []);
  const engine = useEngine(session);
  const store = useMemo(() => new DocumentStore(session), [session]);
  const disk = useMemo(() => new DiskFiles(), []);
  const doc = useDocument(store);
  const files = useFiles(session, store, disk, doc, cloud);
  useProjectRoute(files, doc.empty);
  useThumbnails(
    session,
    engine,
    files.ref?.cloud?.id ?? null,
    !files.blocked,
    cloud,
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  /** Why the account dialog was opened, and what to do once there is an account. */
  const [accountReason, setAccountReason] = useState<string | null>(null);
  const afterAccount = useRef<(() => void) | null>(null);
  const isAccount = !!cloud.user && !cloud.user.anonymous;
  /** Runs `then` with an account: at once, or once one is created or signed in to. */
  const needAccount = (reason: string, then: () => void) => {
    if (isAccount) return then();
    afterAccount.current = then;
    setAccountReason(reason);
    setAccountOpen(true);
  };
  useEffect(() => {
    if (!isAccount || !afterAccount.current) return;
    const then = afterAccount.current;
    afterAccount.current = null;
    setAccountOpen(false);
    setAccountReason(null);
    then();
  }, [isAccount]);

  /** Without an account, a new project replaces the draft: asked first. */
  const draft = cloud.user?.anonymous ? (cloud.projects?.[0] ?? null) : null;
  const [replacing, setReplacing] = useState<{
    name: string;
    answer: (go: boolean) => void;
  } | null>(null);
  const confirmReplace = (): Promise<boolean> =>
    draft
      ? new Promise((resolve) =>
          setReplacing({ name: draft.name, answer: resolve }),
        )
      : Promise.resolve(true);
  const startNew = (go: () => void) =>
    void confirmReplace().then((yes) => yes && go());
  const [googleError, setGoogleError] = useState<{
    code: string;
    message: string;
  } | null>(null);

  // Back from Google: say what went wrong, or finish what was left to do (move an anonymous
  // user's projects into the account reached, reopen the cloud project that was open).
  const cloudBackend = cloud.backend;
  const cloudRefresh = cloud.refresh;
  const userId = cloud.user?.id;
  const filesNow = useRef(files);
  useEffect(() => {
    filesNow.current = files;
  });
  useEffect(() => {
    void cloudBackend().then(
      async (b) => {
        if (!b.returned) return;
        b.returned = false;
        if (b.returnError) {
          setGoogleError(b.returnError);
          setAccountOpen(true);
          return;
        }
        const stash = b.takeReturn();
        if (!stash || !b.user()) return;
        const from = b.fromStash(stash);
        if (from) {
          const r = await moveProjects(from, b);
          cloudRefresh();
          const { showInfo, projectsMoved } = filesNow.current;
          projectsMoved(r.ids);
          if (r.failed.length)
            showInfo(
              `Signed in. These projects could not be moved from this browser and stay there: ${r.failed.join(", ")}.`,
            );
          else if (r.moved)
            showInfo(
              `Signed in. ${r.moved} project${r.moved === 1 ? "" : "s"} from this browser moved to your account.`,
            );
        } else if (stash.reopen) {
          filesNow.current.openCloud(stash.reopen);
        }
      },
      () => undefined,
    );
    // `userId`: run again once the session from the URL is in.
  }, [cloudBackend, cloudRefresh, userId]);

  const continueWithGoogle = (signIn: boolean) => {
    setGoogleError(null);
    files.leavePage(async () =>
      (await cloud.backend()).continueWithGoogle({
        signIn,
        reopen: files.ref?.cloud?.id,
      }),
    );
  };
  const [show2d, setShow2d] = useState(true);
  const [show3d, setShow3d] = useState(true);

  const toggle2d = () => {
    if (show2d && !show3d) return;
    setShow2d((v) => !v);
  };
  const toggle3d = () => {
    if (show3d && !show2d) return;
    setShow3d((v) => !v);
  };

  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const hasDragged = useRef(false);

  const toggleSplit = useCallback(() => {
    setSplitRatio((prev) => {
      if (Math.abs(prev - 0.5) < 0.05) return 0.35;
      if (prev < 0.45) return 0.65;
      return 0.5;
    });
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    hasDragged.current = false;
    const container = workspaceRef.current;
    if (!container) return;

    const startX = e.clientX;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 3) {
        hasDragged.current = true;
      }
      const rect = container.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const minPx = 220;
      const maxPx = Math.max(minPx, rect.width - minPx);
      const clampedX = Math.max(minPx, Math.min(maxPx, x));
      setSplitRatio(clampedX / rect.width);
    };

    const onPointerUp = () => {
      setIsResizing(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);
  const [panel, setPanelState] = useState<PanelId | null>("fabric");
  const [displayedPanel, setDisplayedPanel] = useState<PanelId>("fabric");
  const setPanel = useCallback((p: PanelId | null) => {
    setPanelState(p);
    if (p) setDisplayedPanel(p);
  }, []);
  const [tool, setTool] = useState<PointerTool>("turn");
  const [flatTool, setFlatTool] = useState<FlatTool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  // Cmd (Ctrl) held drags pieces as Move does until it is let go, from the tools that don't
  // use the key themselves.
  const [modHeld, setModHeld] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setModHeld(e.metaKey || e.ctrlKey);
    const blur = () => setModHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const moveHeld =
    modHeld &&
    (flatTool === "select" ||
      flatTool === "draw" ||
      flatTool === "marks" ||
      flatTool === "shape");
  const flatToolNow: FlatTool = moveHeld ? "move" : flatTool;
  const [importing, setImporting] = useState<TextFile | null>(null);
  /** A piece the pen drew, being named and placed: its outline and where it was drawn. */
  const [adding, setAdding] = useState<{
    outline: OutlineNode[];
    origin: Vec2;
    key: number;
  } | null>(null);
  const [importKey, setImportKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
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
  const sewingShown = panel === "seams" || (show2d && flatTool === "sew");
  const sewingKey = garment ? `${garment.id}` : "";
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
  const [proposalState, setProposalState] = useState<{
    key: string;
    list: SeamProposal[];
  } | null>(null);
  /** The edges picked for the seam being made: `open` is the side being picked. */
  interface Picks {
    a: CutEdge[];
    b: CutEdge[];
    open: "a" | "b";
  }
  const [pickState, setPickState] = useState<{
    key: string;
    picks: Picks;
  } | null>(null);
  const proposals =
    proposalState?.key === sewingKey ? proposalState.list : null;
  const picks: Picks | null =
    pickState?.key === sewingKey ? pickState.picks : null;
  const setProposals = useCallback(
    (f: (l: SeamProposal[] | null) => SeamProposal[] | null) =>
      setProposalState((s) => {
        const list = f(s?.key === sewingKey ? s.list : null);
        return list ? { key: sewingKey, list } : null;
      }),
    [sewingKey],
  );
  const setPicks = useCallback(
    (p: Picks | null) => setPickState(p ? { key: sewingKey, picks: p } : null),
    [sewingKey],
  );

  const findSeams = useCallback(async () => {
    setFinding(true);
    try {
      const list = parseProposals(await session.suggestSeams());
      setProposals(() => list);
    } catch (e) {
      files.showError("Could not suggest seams", e as Error);
    } finally {
      setFinding(false);
    }
  }, [session, files, setProposals]);

  const sew = useCallback(
    (p: {
      a: SeamProposal["a"];
      b: SeamProposal["b"];
      pairing?: SeamProposal["pairing"];
    }) => {
      if (!garment) return false;
      return store.execute((e) =>
        addSeam(e, garment.id, p, crypto.randomUUID()),
      );
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

  /** Sews the picked sides (one or more whole edges each). */
  const completeSeam = useCallback(
    (p: Picks) => {
      const side = (list: CutEdge[]) =>
        JSON.stringify(
          list.length === 1
            ? { cut: list[0]?.cut, from: list[0]?.from, to: list[0]?.to }
            : list.map((x) => ({ cut: x.cut, from: x.from, to: x.to })),
        );
      session.joinEdges(side(p.a), side(p.b)).then(
        (j) => {
          const [made] = parseProposals(`[${j}]`);
          if (made) sew(made);
          setPicks(null);
        },
        (e: Error) => {
          setPicks(null);
          files.showError("Could not sew those edges", e);
        },
      );
    },
    [session, sew, files, setPicks],
  );

  /**
   * A click on a whole edge adds it to the open side. A plain click ends that side (so two
   * clicks sew two edges); Shift keeps the side open for another edge, for a seam along
   * several edges. `finish` ends the open side without an edge.
   */
  const pickEdge = useCallback(
    (edge: CutEdge | null, more: boolean) => {
      const cur: Picks = picks ?? { a: [], b: [], open: "a" };
      const all = [...cur.a, ...cur.b];
      if (edge && all.some((x) => sameEdge(x, edge))) {
        // Picking it again takes it back.
        const drop = (l: CutEdge[]) => l.filter((x) => !sameEdge(x, edge));
        const next = { ...cur, a: drop(cur.a), b: drop(cur.b) };
        setPicks(next.a.length || next.b.length ? next : null);
        return;
      }
      const next: Picks = edge
        ? { ...cur, [cur.open]: [...cur[cur.open], edge] }
        : cur;
      if (more && edge) {
        setPicks(next);
        return;
      }
      if (next[next.open].length === 0) return;
      if (next.open === "a") setPicks({ ...next, open: "b" });
      else completeSeam(next);
    },
    [picks, setPicks, completeSeam],
  );
  const fabric = garment
    ? doc.entities.fabrics.find((f) => f.id === garment.fabric)
    : doc.entities.fabrics[0];
  // A selection only counts in the file it was made in.
  const selected =
    selection && garment ? findCut(garment, selection.cutId) : undefined;
  const shownSelection = selected ? selection : null;

  const select = useCallback(
    (s: Selection) => {
      setSelection(s);
      if (s) setPanel("pieces");
    },
    [setPanel],
  );

  // Placing pieces: the Select tool in 3D. The cloth waits where it starts.
  const placing = show3d && tool === "select" && !doc.empty;
  useEffect(() => {
    if (session.state.controls.placing !== placing)
      session.setControls({ placing });
  }, [placing, session]);

  // The seams are drawn on the cloth while the Seams panel is open.
  const showSeams = panel === "seams";
  useEffect(() => {
    if (session.state.controls.seams !== showSeams)
      session.setControls({ seams: showSeams });
  }, [showSeams, session]);

  // The flat view shows each cut in its colour.
  const cutColors = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of garment?.pieces ?? []) {
      for (const c of p.cuts) {
        const color = garment && cutColor(doc.entities, garment, c);
        if (color) out.set(c.id, color);
      }
    }
    return out;
  }, [doc.entities, garment]);

  // A click with Select in 3D picks a cut of the drape shown.
  const drapeCuts = engine.drape?.info.cuts;
  useEffect(
    () =>
      session.onPicked((i) => {
        const id = i >= 0 ? drapeCuts?.[i] : undefined;
        const f = id && garment ? findCut(garment, id) : undefined;
        select(
          f ? { kind: "cut", pieceId: f.piece.id, cutId: f.cut.id } : null,
        );
      }),
    [session, drapeCuts, garment, select],
  );

  // The selected cut's handles, while placing (and while it is in the drape shown).
  const gizmoIndex =
    placing && selection ? (drapeCuts?.indexOf(selection.cutId) ?? -1) : -1;
  useEffect(() => {
    session.showGizmo(gizmoIndex >= 0 ? gizmoIndex : null);
  }, [session, gizmoIndex]);

  useEffect(() => {
    const el = canvasBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setCanvasSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rewrap = useCallback(
    (cutId: string, place: Place) => {
      const g = garment;
      if (!g) return;
      session.rewrap(cutId, place).then(
        (json) => {
          const r = JSON.parse(json) as {
            placement: Omit<Placement, "type">;
            bounds: Bounds | null;
          };
          store.execute((e) =>
            setPlacement(
              e,
              g.id,
              cutId,
              { type: "wrap", ...r.placement },
              r.bounds ?? undefined,
            ),
          );
        },
        (e: Error) => files.showError("Could not move the piece", e),
      );
    },
    [garment, session, store, files],
  );

  /** A drawn piece or a ready shape added: wrapped where the person chose (Rust), one edit. */
  const addNewPiece = async (n: NewPiece, origin?: Vec2) => {
    const g = garment;
    if (!g) return;
    const places: string[] = n.place.startsWith("pair:")
      ? [...PAIRS[n.place.slice(5) as Pair].places]
      : [n.place.slice(4)];
    const uuid = () => crypto.randomUUID();
    const piece = newPiece({
      id: uuid(),
      name: n.name,
      outline: n.outline,
      cutIds: places.map(uuid),
      origin: origin ?? pattern.current?.freeSpot() ?? [0, 0],
    });
    const r = JSON.parse(
      await session.placePiece(JSON.stringify(piece), places),
    ) as { placements: Omit<Placement, "type">[]; bounds: Bounds | null };
    const placed = {
      ...piece,
      cuts: piece.cuts.map((c, k) => ({
        ...c,
        placement: { type: "wrap", ...r.placements[k] } as Placement,
      })) as typeof piece.cuts,
    };
    if (!store.execute((e) => addPiece(e, g.id, placed, r.bounds ?? undefined)))
      throw new Error(store.state.refused ?? "the piece could not be added");
    setAdding(null);
    setFlatTool("select");
    setSelection({ kind: "cut", pieceId: placed.id, cutId: placed.cuts[0].id });
  };

  /**
   * A file picked or dropped: a .vtry opens as a new project; a DXF goes to the import dialog (a
   * garment.toml with it is kept for it).
   */
  const [droppedSidecar, setDroppedSidecar] = useState<TextFile | null>(null);
  const startImport = async (list: FileList | File[]) => {
    const vtry = [...list].find((f) => /\.vtry$/i.test(f.name));
    if (vtry) return startNew(() => files.openVtry(vtry));
    const r = await readPattern(list);
    if (!r) {
      files.showError(
        "Not imported",
        new Error(
          "pick a DXF-AAMA pattern (.dxf) or a Vitryne project (.vtry)",
        ),
      );
      return;
    }
    // Pieces added to the open project aren't a new project; a new one replaces the draft.
    const show = () => {
      setDroppedSidecar(r.sidecar);
      setImportKey((k) => k + 1);
      setImporting(r.dxf);
    };
    if (doc.empty) startNew(show);
    else show();
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if ([...e.dataTransfer.items].some((i) => i.kind === "file"))
        e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      void startImport(e.dataTransfer.files);
    },
  };

  const runImport = async (o: {
    dxf: TextFile;
    sidecar: TextFile | null;
    choices: Record<string, unknown>;
    into: "new" | "add";
  }) => {
    const choices = JSON.stringify(o.choices);
    if (o.into === "add" && garment) {
      const a = JSON.parse(
        await session.importAddition({
          name: o.dxf.name,
          dxf: o.dxf.text,
          sidecar: o.sidecar?.text ?? "",
          choices,
          seed: seed(),
        }),
      ) as Addition;
      if (!store.execute((e) => addPieces(e, garment.id, a)))
        throw new Error(store.state.refused ?? "the pieces could not be added");
      if (a.notes.length) files.showInfo(a.notes.join(". "));
    } else {
      // With nothing open, starting the import already asked.
      if (!doc.empty && !(await confirmReplace())) return;
      const avatar = await fetchAvatar();
      const name = `${o.dxf.name.replace(/\.dxf$/i, "")}.vtry`;
      await files.importNew(async (rev) => ({
        name,
        ...(await session.importNew(
          {
            name: o.dxf.name,
            dxf: o.dxf.text,
            sidecar: o.sidecar?.text ?? "",
            choices,
            avatar,
            seed: seed(),
          },
          rev,
        )),
      }));
      setSelection(null);
      setShow3d(true);
    }
    setImporting(null);
  };

  const openPreset = (ex: Example) =>
    startNew(() =>
      files.openData(
        { name: ex.file.split("/").pop() ?? ex.file, form: "zip" },
        async () => ({ form: "zip", bytes: await fetchExample(ex) }),
      ),
    );
  /** An empty project, opened on the flat view (its hint says how to start). */
  const startScratch = () =>
    startNew(
      () =>
        void files
          .importNew(
            async (rev) => ({
              name: "Untitled.vtry",
              ...(await session.newEmpty(
                { avatar: await fetchAvatar(), seed: seed() },
                rev,
              )),
            }),
            null,
          )
          .then(() => {
            setSelection(null);
            setShow2d(true);
            setShow3d(false);
          })
          .catch((e: unknown) => {
            if ((e as Error).message !== "cancelled")
              files.showError("Could not start a project", e);
          }),
    );
  const importFile = () => fileInput.current?.click();
  const openFolder = () => startNew(() => files.openFolder());
  const exportIt = () =>
    needAccount("Create a free account to export.", () => setExporting(true));

  const { save } = files;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        // Let a field being edited commit first.
        if (typing) (e.target as HTMLElement).blur();
        save();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (mod && !typing && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing || mod) return;
      // Delete takes the picked pieces out, in 2D or 3D; the 2D tools that pick points or
      // lines keep it for those.
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !(
          show2d &&
          (flatTool === "points" || flatTool === "draw" || flatTool === "marks")
        )
      ) {
        const g = garment;
        const s = shownSelection;
        if (!g || !s) return;
        e.preventDefault();
        const ids = [s.cutId, ...(s.also ?? [])].filter(
          (id) => !!findCut(g, id),
        );
        let note: string | undefined;
        const done = store.execute((x) => {
          const cmd = removeCuts(x, g.id, ids);
          note = cmd.note;
          return cmd;
        });
        if (done) {
          setSelection(null);
          if (note) files.showInfo(`${note}.`);
        }
        return;
      }
      const c = session.state.controls;
      if (e.key === " ") session.setControls({ paused: !c.paused });
      else if (k === "f") session.setControls({ fast: !c.fast });
      else if (k === "r") session.resetDrape();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [session, store, save, show2d, flatTool, garment, shownSelection, files]);

  const message =
    files.notice?.kind === "error"
      ? files.notice.text
      : (examplesError ?? doc.refused);
  const saveState = files.busy
    ? `${files.busy}…`
    : saveStateText(files.saveStatus, doc, !!files.ref?.cloud);
  const stopped = files.saveStatus.kind === "stopped" ? files.saveStatus : null;

  const recoveryBanner = files.recovery && (
    <div
      className="mx-auto mt-2 flex w-[calc(100%-64px)] max-w-[1056px] flex-wrap items-center gap-3 rounded-2xl border border-[#E1E4DE] bg-white px-5 py-3 text-[15px]"
      role="status"
    >
      <span className="grow">
        Unsaved changes to <strong>{files.recovery.fileName}</strong> from{" "}
        {new Date(files.recovery.at).toLocaleString()} were kept in this
        browser.
      </span>
      <Button onClick={() => void files.recovery?.recover()}>Recover</Button>
      <Button variant="ghost" onClick={() => files.recovery?.discard()}>
        Discard
      </Button>
    </div>
  );

  const lastLoggedWarnings = useRef<string>("");
  useEffect(() => {
    const all = [...doc.warnings, ...(engine.drape?.info.warnings ?? [])];
    const key = all.join("\n");
    if (key && key !== lastLoggedWarnings.current) {
      lastLoggedWarnings.current = key;
      for (const w of all) {
        console.warn(`[vitryne] ${w}`);
      }
    } else if (!key) {
      lastLoggedWarnings.current = "";
    }
  }, [doc.warnings, engine.drape?.info.warnings]);

  const cards = (
    <>
      {engine.notice && (
        <Card onDismiss={() => session.clearNotice()}>{engine.notice}</Card>
      )}
      {files.notice?.kind === "info" && (
        <Card onDismiss={() => files.dismissNotice()}>{files.notice.text}</Card>
      )}
      {files.conflict && (
        <Card tone="error">
          <span className="block">
            This project was changed in another browser since you opened it.
            Your latest changes aren't saved.
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={files.conflict.reload}>
              Open the other version
            </Button>
            {isAccount ? (
              <Button
                size="sm"
                variant="outline"
                onClick={files.conflict.saveCopy}
              >
                Keep mine as a copy
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void files.conflict?.keepMine()}
              >
                Keep mine
              </Button>
            )}
          </span>
        </Card>
      )}
      {stopped?.reason === "account" && (
        <Card tone="error">
          <span className="block">
            Your draft is the one project you can keep without an account.
            Create a free account to keep this one too.
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAccountOpen(true)}>
              Create an account
            </Button>
          </span>
        </Card>
      )}
      {stopped?.reason === "error" && (
        <Card tone="error">
          <span className="block">Not saved: {stopped.text}</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={files.retrySave}>
              Try again
            </Button>
          </span>
        </Card>
      )}
      {engine.drapeError && (
        <Card tone="error">
          The drape could not be built: {engine.drapeError}
        </Card>
      )}
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
    </>
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Back to start"
              onClick={() => files.close()}
              className="flex items-center rounded-lg"
            >
              <Logo />
            </button>
          </TooltipTrigger>
          <TooltipContent>Back to files</TooltipContent>
        </Tooltip>
        <span className="mx-1 h-6 w-px bg-[#E1E4DE]" />
        {doc.entities.project ? (
          <ProjectName
            name={doc.entities.project.name ?? doc.fileName}
            onRename={(v) => {
              if (store.execute((e) => renameProject(e, v))) {
                files.save();
              }
            }}
          />
        ) : (
          <span className="max-w-[40vw] truncate text-[15px] font-semibold">
            {doc.fileName}
          </span>
        )}
        <span
          className={cn(
            "truncate text-[13px]",
            doc.dirty ? "text-foreground" : "text-muted-foreground",
          )}
          title={files.ref?.name}
        >
          {saveState}
        </span>
        <span className="grow" />
        <IconButton
          label={
            doc.undoLabel
              ? `Undo: ${doc.undoLabel} (${MOD}Z)`
              : "Nothing to undo"
          }
          disabled={!doc.undoLabel}
          onClick={() => store.undo()}
        >
          <UndoIcon />
        </IconButton>
        <IconButton
          label={
            doc.redoLabel
              ? `Redo: ${doc.redoLabel} (⇧${MOD}Z)`
              : "Nothing to redo"
          }
          disabled={!doc.redoLabel}
          onClick={() => store.redo()}
        >
          <RedoIcon />
        </IconButton>
        <div
          role="group"
          aria-label="Toggle views"
          className="flex items-center rounded-[10px] border border-input bg-card p-0.5"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={show2d ? "secondary" : "ghost"}
                size="icon-sm"
                className={cn(
                  "size-9 rounded-md transition-all",
                  show2d
                    ? "bg-secondary text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={show2d ? "Hide 2D pattern" : "Show 2D pattern"}
                aria-pressed={show2d}
                onClick={toggle2d}
              >
                <FlatIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {show2d ? "Hide 2D pattern" : "Show 2D pattern"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={show3d ? "secondary" : "ghost"}
                size="icon-sm"
                className={cn(
                  "size-9 rounded-md transition-all",
                  show3d
                    ? "bg-secondary text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={show3d ? "Hide 3D drape" : "Show 3D drape"}
                aria-pressed={show3d}
                onClick={toggle3d}
              >
                <CubeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {show3d ? "Hide 3D drape" : "Show 3D drape"}
            </TooltipContent>
          </Tooltip>
        </div>
        <CloudButton user={cloud.user} onClick={() => setAccountOpen(true)} />
        <Button
          className="gap-2 px-3.5 font-semibold shadow-xs"
          onClick={exportIt}
          disabled={doc.empty || !garment?.pieces.length}
          aria-label="Export"
        >
          <Download className="size-4" />
          <span>Export</span>
        </Button>
      </header>

      <div className="flex min-h-0 grow">
        {/* Rail */}
        <nav
          aria-label="Panels"
          className="flex w-20 shrink-0 flex-col gap-1.5 border-r bg-white px-2 py-3"
        >
          <RailButton
            id="fabric"
            icon={<FabricIcon />}
            panel={panel}
            setPanel={setPanel}
          />
          <RailButton
            id="pieces"
            icon={<Shapes className="size-6" strokeWidth={1.6} />}
            panel={panel}
            setPanel={setPanel}
          />
          <RailButton
            id="seams"
            icon={<Link2 className="size-6" strokeWidth={1.6} />}
            panel={panel}
            setPanel={setPanel}
          />
          <RailButton
            id="settings"
            icon={<SlidersHorizontal className="size-6" strokeWidth={1.6} />}
            panel={panel}
            setPanel={setPanel}
          />
        </nav>
        {/* Panel */}
        <aside
          aria-label={displayedPanel ? PANEL_TITLES[displayedPanel] : "Panel"}
          aria-hidden={!panel}
          style={{
            width: panel ? "300px" : "0px",
          }}
          className={cn(
            "relative h-full shrink-0 overflow-hidden bg-white",
            panel
              ? "border-r border-[#E1E4DE] opacity-100"
              : "pointer-events-none border-r-0 opacity-0",
            "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          )}
        >
          <div className="flex h-full w-[300px] shrink-0 flex-col gap-4 overflow-y-auto p-5">
            {displayedPanel && (
              <>
                <h2 className="font-display m-0 text-xl font-semibold">
                  {PANEL_TITLES[displayedPanel]}
                </h2>
                {displayedPanel === "fabric" && (
                  <FabricPanel
                    store={store}
                    entities={doc.entities}
                    fabric={fabric}
                    garment={garment}
                    fabrics={doc.entities.fabrics}
                  />
                )}
                {displayedPanel === "pieces" && (
                  <PiecesPanel
                    store={store}
                    entities={doc.entities}
                    garment={garment}
                    fabrics={doc.entities.fabrics}
                    selection={shownSelection}
                    onSelect={select}
                    onRewrap={rewrap}
                    onPlaceIn3d={
                      placing
                        ? null
                        : () => (setShow3d(true), setTool("select"))
                    }
                  />
                )}
                {displayedPanel === "seams" && (
                  <SeamsPanel
                    store={store}
                    garment={garment}
                    differences={differences}
                    proposals={proposals}
                    finding={finding}
                    onFind={() => void findSeams()}
                    onAccept={acceptProposal}
                    onSkip={(i) =>
                      setProposals(
                        (list) => list?.filter((_, k) => k !== i) ?? null,
                      )
                    }
                    picking={show2d && flatTool === "sew"}
                    picks={
                      picks
                        ? {
                            a: picks.a.length,
                            b: picks.b.length,
                            open: picks.open,
                          }
                        : null
                    }
                    onFinishSide={() => pickEdge(null, false)}
                    onStartPicking={() => (setShow2d(true), setFlatTool("sew"))}
                    onStopPicking={() => (
                      setFlatTool("select"),
                      setPicks(null)
                    )}
                  />
                )}
                {displayedPanel === "settings" && (
                  <SettingsPanel store={store} entities={doc.entities} />
                )}
              </>
            )}
          </div>
        </aside>

        {/* Workspace views: 2D window on the left, 3D on the right */}
        <section
          ref={workspaceRef}
          aria-label="Workspace views"
          className="relative flex min-w-0 grow overflow-hidden"
          {...dropProps}
        >
          {/* 2D Window (Left) */}
          <div
            key="window-2d"
            aria-label="2D Pattern view"
            aria-hidden={!show2d}
            style={{
              width: !show2d ? "0%" : !show3d ? "100%" : `${splitRatio * 100}%`,
            }}
            className={cn(
              "relative h-full shrink-0 min-w-0 overflow-hidden bg-canvas-flat",
              !show2d && "pointer-events-none opacity-0",
              isResizing
                ? "transition-none"
                : "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            )}
          >
            <div className="absolute inset-0">
              <PatternPanel
                ref={pattern}
                garment={garment}
                selection={shownSelection}
                onSelect={select}
                tool={flatTool}
                moving={moveHeld}
                sewing={{
                  edges,
                  picked: picks ? [...picks.a, ...picks.b] : [],
                  onPick: pickEdge,
                }}
                cutColors={cutColors}
                empty={
                  <FirstPieceHint
                    onDraw={() => setFlatTool("draw")}
                    onShape={() => setFlatTool("shape")}
                    onImport={importFile}
                    busy={!!files.busy}
                  />
                }
                onDrawn={(outline, origin) =>
                  setAdding({ outline, origin, key: Date.now() })
                }
                shapeKind={shapeKind}
                onShape={(outline, origin) =>
                  void addNewPiece(
                    {
                      outline,
                      name: `Piece ${(garment?.pieces.length ?? 0) + 1}`,
                      place: "one:body-front",
                    },
                    origin,
                  ).catch((e: Error) =>
                    files.showError("Could not add the shape", e),
                  )
                }
                onEdit={(build) => {
                  let note: string | undefined;
                  const done = store.execute((e) => {
                    const cmd = build(e);
                    note = cmd.note;
                    return cmd;
                  });
                  if (done && note) files.showInfo(`${note}.`);
                }}
                onArrange={(moved) =>
                  garment &&
                  store.execute((e) =>
                    setLayouts(
                      e,
                      garment.id,
                      Object.fromEntries(
                        [...moved].map(([cutId, t]) => [
                          cutId,
                          { position: [t.x, t.y], rotation: t.rot },
                        ]),
                      ),
                    ),
                  )
                }
              />
            </div>

            {/* 2D Window badge and status (notices shown here when 3D is hidden) */}
            <div
              className={cn(
                "absolute top-4 left-4 z-10 flex max-w-[calc(100%-32px)] flex-col items-start gap-2 transition-opacity duration-300",
                show3d ? "pointer-events-none opacity-0" : "opacity-100",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill engine={engine} show3d={show3d} placing={placing} />
              </div>
              {!show3d && cards}
            </div>

            <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-[10px] border border-[#E1E4DE] bg-white p-0.5">
              <ZoomButton
                label="Zoom out"
                onClick={() => pattern.current?.zoom(1 / 1.25)}
              >
                −
              </ZoomButton>
              <button
                type="button"
                onClick={() => pattern.current?.reset()}
                className="h-9 min-w-11 rounded-lg px-1 text-[13px] font-medium hover:bg-[#F4F5F2]"
              >
                Fit
              </button>
              <ZoomButton
                label="Zoom in"
                onClick={() => pattern.current?.zoom(1.25)}
              >
                +
              </ZoomButton>
            </div>

            {!doc.empty && flatTool === "shape" && (
              <div className="absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
                <ShapeBar kind={shapeKind} onKind={setShapeKind} />
              </div>
            )}
            {!doc.empty && (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-[#14181F] p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
                <ToolButton
                  label="Select"
                  selected={flatToolNow === "select"}
                  onClick={() => setFlatTool("select")}
                >
                  <SelectIcon />
                </ToolButton>
                <ToolButton
                  label="Move"
                  selected={flatToolNow === "move"}
                  onClick={() => setFlatTool("move")}
                >
                  <MoveIcon />
                </ToolButton>
                <ToolButton
                  label="Edit points"
                  selected={flatTool === "points"}
                  onClick={() => setFlatTool("points")}
                >
                  <Spline className="size-5" />
                </ToolButton>
                <ToolButton
                  label="Draw a piece"
                  selected={flatToolNow === "draw"}
                  onClick={() => setFlatTool("draw")}
                >
                  <PenTool className="size-5" />
                </ToolButton>
                <ToolButton
                  label="Lines, notches, folds and grain"
                  selected={flatToolNow === "marks"}
                  onClick={() => setFlatTool("marks")}
                >
                  <PencilRuler className="size-5" />
                </ToolButton>
                <ToolButton
                  label="Add a shape"
                  selected={flatToolNow === "shape"}
                  onClick={() => setFlatTool("shape")}
                >
                  <SquarePlus className="size-5" />
                </ToolButton>
                <ToolButton
                  label="Sew two edges"
                  selected={flatTool === "sew"}
                  onClick={() => {
                    setFlatTool("sew");
                    setPanel("seams");
                  }}
                >
                  <Link2 className="size-5" />
                </ToolButton>
              </div>
            )}
          </div>

          {/* Resize toggle between the 2 windows */}
          <div
            key="window-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitRatio * 100)}
            aria-label="Resize 2D and 3D views"
            aria-hidden={!(show2d && show3d)}
            tabIndex={show2d && show3d ? 0 : -1}
            onPointerDown={show2d && show3d ? startResize : undefined}
            onDoubleClick={
              show2d && show3d
                ? (e) => {
                    e.stopPropagation();
                    setSplitRatio(0.5);
                  }
                : undefined
            }
            onKeyDown={
              show2d && show3d
                ? (e) => {
                    if (e.key === "ArrowLeft") {
                      setSplitRatio((r) => Math.max(0.15, r - 0.05));
                    } else if (e.key === "ArrowRight") {
                      setSplitRatio((r) => Math.min(0.85, r + 0.05));
                    } else if (e.key === "Enter" || e.key === " ") {
                      toggleSplit();
                    }
                  }
                : undefined
            }
            className={cn(
              "group relative z-20 flex w-0 shrink-0 cursor-col-resize select-none items-center justify-center focus:outline-hidden",
              show2d && show3d
                ? "opacity-100 scale-100"
                : "pointer-events-none opacity-0 scale-90",
              isResizing
                ? "transition-none"
                : "transition-[opacity,transform] duration-250 ease-in-out",
            )}
          >
            {/* Visible border line */}
            <div
              className={cn(
                "absolute inset-y-0 -left-px w-px transition-colors",
                isResizing
                  ? "bg-primary w-0.5 -left-[1px]"
                  : "bg-[#E1E4DE] group-hover:bg-primary/50 group-hover:w-0.5 group-hover:-left-[1px]",
              )}
            />

            {/* Invisible wider hit area for easy grabbing */}
            <div className="absolute inset-y-0 -left-2 w-4 cursor-col-resize" />

            {/* Centered toggle / grip pill */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Resize or toggle view split"
                  disabled={!(show2d && show3d)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasDragged.current) toggleSplit();
                  }}
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 z-30 flex h-10 w-4 items-center justify-center rounded-full border border-[#E1E4DE] bg-white shadow-xs transition-all",
                    "group-hover:scale-110 group-hover:border-foreground/30 group-hover:bg-[#F4F5F2]",
                    isResizing &&
                      "scale-110 border-primary bg-primary text-primary-foreground shadow-sm",
                  )}
                >
                  <GripVertical
                    className={cn(
                      "size-3 transition-colors",
                      isResizing
                        ? "text-primary-foreground"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Drag to resize · Click to toggle layout · Double-click to center
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 3D Window (Right) */}
          <div
            key="window-3d"
            ref={canvasBox}
            aria-label="3D Drape view"
            aria-hidden={!show3d}
            style={{
              width: !show3d
                ? "0%"
                : !show2d
                  ? "100%"
                  : `${(1 - splitRatio) * 100}%`,
            }}
            className={cn(
              "bg-canvas-3d relative h-full shrink-0 min-w-0 overflow-hidden",
              !show3d && "pointer-events-none opacity-0",
              isResizing
                ? "transition-none"
                : "transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            )}
          >
            {/* The 3D view stays mounted under hidden/shown state */}
            <div className="absolute inset-0">
              <Viewport session={session} tool={tool} />
            </div>

            {placing &&
              engine.gizmo &&
              selected?.cut.placement.type === "wrap" &&
              gizmoIndex >= 0 && (
                <Gizmo
                  view={engine.gizmo}
                  width={canvasSize.w}
                  height={canvasSize.h}
                  placement={
                    selected.cut.placement as Placement & { type: "wrap" }
                  }
                  onPreview={(p) => session.placeCut(gizmoIndex, tidy(p))}
                  onCommit={(p) =>
                    garment &&
                    store.execute((e) =>
                      setPlacement(e, garment.id, selected.cut.id, tidy(p)),
                    )
                  }
                />
              )}

            {/* 3D Window badge and status */}
            <div className="absolute top-4 left-4 z-10 flex max-w-[calc(100%-32px)] flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill engine={engine} show3d={show3d} placing={placing} />
              </div>
              {cards}
            </div>

            {engine.phase === "failed" && (
              <div className="bg-background/90 absolute inset-0 z-20 flex items-center justify-center p-8">
                <div className="max-w-md space-y-2 rounded-[20px] border bg-white p-7 text-[15px]">
                  <p className="font-display m-0 text-xl font-semibold">
                    The 3D view keeps stopping
                  </p>
                  <p className="text-muted-foreground m-0">
                    It was not restarted again. Last reason: {engine.failure}
                  </p>
                  <p className="m-0">
                    Your project is still here: save it, then reload the page.
                  </p>
                </div>
              </div>
            )}

            <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-[10px] border border-[#E1E4DE] bg-white p-0.5">
              <ZoomButton label="Zoom out" onClick={() => session.wheel(-1)}>
                −
              </ZoomButton>
              <ZoomButton label="Zoom in" onClick={() => session.wheel(1)}>
                +
              </ZoomButton>
            </div>

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-[#14181F] p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
              <ToolButton
                label="Select"
                selected={tool === "select"}
                onClick={() => setTool("select")}
              >
                <SelectIcon />
              </ToolButton>
              <ToolButton
                label="Turn view"
                selected={tool === "turn"}
                onClick={() => setTool("turn")}
              >
                <TurnIcon />
              </ToolButton>
              <ToolButton
                label="Pinch fabric"
                selected={tool === "pinch"}
                onClick={() => setTool("pinch")}
              >
                <PinchIcon />
              </ToolButton>
              <span className="mx-1 my-2 w-px bg-white/20" />
              <ToolButton
                label={
                  engine.controls.paused ? "Play (space)" : "Pause (space)"
                }
                onClick={() => {
                  // Play while placing means "drape now".
                  if (placing) setTool("turn");
                  session.setControls({
                    paused: placing ? false : !engine.controls.paused,
                  });
                }}
              >
                {engine.controls.paused ? (
                  <Play className="size-5" />
                ) : (
                  <Pause className="size-5" />
                )}
              </ToolButton>
              <ToolButton
                label="Fast drape (F)"
                selected={engine.controls.fast}
                onClick={() =>
                  session.setControls({ fast: !engine.controls.fast })
                }
              >
                <FastForward className="size-5" />
              </ToolButton>
              <ToolButton
                label="Drape again from the start (R)"
                onClick={() => session.resetDrape()}
              >
                <RotateCcw className="size-5" />
              </ToolButton>
            </div>
          </div>
        </section>
      </div>

      {isResizing && (
        <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
      )}

      {doc.empty && (
        <StartScreen
          examples={examples}
          busy={files.busy}
          onPreset={openPreset}
          onScratch={startScratch}
          onImport={importFile}
          dropProps={dropProps}
          onOpenFolder={disk.opensFolders ? openFolder : null}
          account={
            <CloudButton
              user={cloud.user}
              onClick={() => setAccountOpen(true)}
            />
          }
          projects={
            // Nobody signed in yet: nothing saved, so no list to wait for.
            !cloud.user || cloud.projects ? (
              <ProjectGrid
                cloud={cloud}
                projects={cloud.projects ?? []}
                title={draft ? "Your draft" : "Your projects"}
                note={
                  draft && (
                    <p className="text-body-text m-0 text-[15px]">
                      Without an account you keep one project.{" "}
                      <button
                        type="button"
                        onClick={() => setAccountOpen(true)}
                        className="text-foreground font-semibold underline underline-offset-4"
                      >
                        Create a free account
                      </button>{" "}
                      to keep more and open them anywhere.
                    </p>
                  )
                }
                busy={!!files.busy}
                onOpen={(id) => files.openCloud(id)}
              />
            ) : null
          }
          banner={
            <>
              {recoveryBanner}
              {message && (
                <div className="mx-auto mt-2 w-[calc(100%-64px)] max-w-[1056px]">
                  <Card
                    tone="error"
                    onDismiss={() => (
                      files.dismissNotice(),
                      setExamplesError(null)
                    )}
                  >
                    {message}
                  </Card>
                </div>
              )}
            </>
          }
        />
      )}
      {!doc.empty && files.recovery && (
        <div className="absolute inset-x-0 top-16 z-20">{recoveryBanner}</div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".dxf,.toml,.vtry"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          if (list.length) void startImport(list);
        }}
      />
      <ImportDialog
        key={importKey}
        dxf={importing}
        initialSidecar={droppedSidecar}
        session={session}
        projectName={
          doc.empty ? null : (doc.entities.project?.name ?? doc.fileName)
        }
        onClose={() => setImporting(null)}
        onImport={runImport}
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

      {accountOpen && (
        <AccountDialog
          cloud={cloud}
          open
          onOpenChange={(o) => {
            setAccountOpen(o);
            if (!o) {
              setGoogleError(null);
              setAccountReason(null);
              afterAccount.current = null;
            }
          }}
          reason={accountReason}
          onInfo={files.showInfo}
          onMoved={files.projectsMoved}
          onGoogle={continueWithGoogle}
          returnError={googleError}
        />
      )}
      <CloudProjectsDialog
        cloud={cloud}
        open={cloudOpen}
        onOpenChange={setCloudOpen}
        busy={!!files.busy}
        onOpen={(id) => files.openCloud(id)}
      />

      <Dialog
        open={!!replacing}
        onOpenChange={(open) =>
          !open && (replacing?.answer(false), setReplacing(null))
        }
      >
        <DialogContent className="rounded-[20px] p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              Replace your draft?
            </DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              Without an account you keep one project. Your draft,{" "}
              {replacing?.name}, is replaced as soon as you change the new one.
              Create a free account to keep both.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => (replacing?.answer(false), setReplacing(null))}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const r = replacing;
                setReplacing(null);
                needAccount(
                  "Create a free account to keep several projects.",
                  () => r?.answer(true),
                );
              }}
            >
              Create an account
            </Button>
            <Button
              onClick={() => (replacing?.answer(true), setReplacing(null))}
            >
              Replace my draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!files.unsaved}
        onOpenChange={(open) => !open && files.unsaved?.cancel()}
      >
        <DialogContent className="rounded-[20px] p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              Your latest changes aren't saved
            </DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              The latest changes to {doc.entities.project?.name ?? doc.fileName}{" "}
              haven't reached the cloud (
              {files.saveStatus.kind === "offline" ||
              files.saveStatus.kind === "stopped"
                ? files.saveStatus.text
                : "not saved yet"}
              ). They are lost if you leave without them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => files.unsaved?.cancel()}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => files.unsaved?.discard()}>
              Leave without them
            </Button>
            <Button onClick={() => void files.unsaved?.save()}>
              Try again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!files.blocked && !doc.empty}>
        <DialogContent
          className="rounded-[20px] p-6"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              Open in another tab
            </DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              {files.blocked === "taken"
                ? `${doc.entities.project?.name ?? doc.fileName} was opened in another tab, which now saves it. Changes made here from now on wouldn't be saved.`
                : `${doc.entities.project?.name ?? doc.fileName} is open in another tab of this browser. One tab at a time edits a project.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => files.close()}>
              Close the project
            </Button>
            <Button onClick={() => void files.takeOver()}>
              Open here instead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({
  engine,
  show3d,
  placing,
}: {
  engine: EngineState;
  show3d: boolean;
  placing: boolean;
}) {
  let text: string;
  let dot = "bg-live live-dot";
  if (engine.phase === "failed")
    [text, dot] = ["3D view stopped", "bg-destructive"];
  else if (engine.progress)
    text = `${engine.progress.task}… ${Math.round(engine.progress.fraction * 100)}%`;
  else if (engine.phase === "starting")
    [text, dot] = ["Starting the 3D view…", "bg-line live-dot"];
  else if (engine.drapeError)
    [text, dot] = ["The drape stopped", "bg-destructive"];
  else if (engine.drape && !engine.drape.info.cuts.length)
    [text, dot] = ["No pieces yet", "bg-line"];
  else if (!show3d)
    [text, dot] = ["Flat pieces. 3D follows your edits", "bg-live"];
  else if (placing)
    [text, dot] = ["Placing pieces. The drape waits", "bg-line"];
  else if (engine.controls.paused) [text, dot] = ["Paused", "bg-line"];
  else text = "Fabric is settling live";
  const s = engine.stats;
  const detail = s
    ? `${s.vertices.toLocaleString()} points · ${s.fps.toFixed(0)} fps · ${Number.isNaN(s.frameMs) ? "–" : s.frameMs.toFixed(1)} ms of GPU per frame · ${s.simTime.toFixed(1)} s simulated`
    : "No drape yet";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="status"
          className="flex items-center gap-2 rounded-full border border-[#E1E4DE] bg-white px-3.5 py-2 text-sm font-medium"
        >
          <span className={cn("size-2 rounded-full", dot)} />
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

/** The account, in the top bar and on the start screen. */
function CloudButton(props: {
  user: { email: string | null; anonymous: boolean } | null;
  onClick: () => void;
}) {
  const label = props.user?.email ?? (props.user ? "Cloud" : "Sign in");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-[220px] gap-1.5 px-3 font-medium"
          onClick={props.onClick}
        >
          <CloudIcon />
          <span className="truncate max-sm:hidden">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {props.user?.anonymous
          ? "Your draft is kept in this browser: create a free account to keep it for good"
          : "Your account"}
      </TooltipContent>
    </Tooltip>
  );
}

function Card(props: {
  tone?: "error";
  onDismiss?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role={props.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex max-w-[480px] items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm leading-snug shadow-[0_8px_24px_rgba(20,24,31,.08)]",
        props.tone === "error"
          ? "border-[#F0C9BE] text-[#8A2410]"
          : "border-[#E1E4DE]",
      )}
    >
      <span className="grow">{props.children}</span>
      {props.onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={props.onDismiss}
          className="text-muted-foreground hover:text-foreground -m-1 p-1"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function RailButton(props: {
  id: PanelId;
  icon: React.ReactNode;
  panel: PanelId | null;
  setPanel: (p: PanelId | null) => void;
}) {
  const on = props.panel === props.id;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => props.setPanel(on ? null : props.id)}
      className={cn(
        "flex h-16 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors duration-200",
        on ? "bg-[#E8ECE4]" : "hover:bg-[#F4F5F2]",
      )}
    >
      {props.icon}
      {PANEL_TITLES[props.id]}
    </button>
  );
}

// The project's name in the top bar reads as text and edits in place on click: Enter or leaving
// the field renames, Escape keeps the old name, an empty name is ignored.
function ProjectName(props: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const text = draft ?? props.name;
  const commit = () => {
    const v = draft?.trim();
    if (!cancelled.current && v && v !== props.name) props.onRename(v);
    cancelled.current = false;
    setDraft(null);
  };
  return (
    <span className="inline-grid max-w-[40vw] text-[15px] font-semibold">
      {/* The hidden copy sizes the field to its text. */}
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 truncate border-[1.5px] px-2 whitespace-pre"
      >
        {text || " "}
      </span>
      <input
        aria-label="Project name"
        title="Rename"
        spellCheck={false}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(props.name);
          e.currentTarget.select();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="col-start-1 row-start-1 h-8 min-w-0 truncate rounded-lg border-[1.5px] border-transparent bg-transparent px-2 outline-none hover:border-[#D5D9D1] focus:border-[#14181F] focus:text-clip"
      />
    </span>
  );
}

function IconButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span keeps the tooltip working on a disabled button. */}
        <span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          >
            {props.children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function ToolButton(props: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          aria-pressed={props.selected}
          onClick={props.onClick}
          className={cn(
            "flex size-11 items-center justify-center rounded-[10px]",
            props.selected
              ? "bg-white text-[#14181F]"
              : "text-white hover:bg-white/10",
          )}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

/** The flat view of a garment with no pieces yet. */
function FirstPieceHint(props: {
  onDraw: () => void;
  onShape: () => void;
  onImport: () => void;
  busy: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-[#E1E4DE] bg-white px-7 py-6 text-center shadow-[0_10px_24px_rgba(20,24,31,.08)]">
        <h2 className="font-display m-0 text-xl font-semibold">
          Draw your first piece
        </h2>
        <p className="text-body-text m-0 text-[15px]">
          Draw its outline with the pen, start from a shape with typed sizes, or
          bring pieces in from a DXF pattern.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="gap-2" onClick={props.onDraw}>
            <PenTool className="size-4" />
            Draw
          </Button>
          <Button variant="secondary" className="gap-2" onClick={props.onShape}>
            <SquarePlus className="size-4" />
            Shape
          </Button>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={props.onImport}
            disabled={props.busy}
          >
            <Upload className="size-4" />
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}

function ZoomButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      className="size-9 rounded-lg text-lg hover:bg-[#F4F5F2]"
    >
      {props.children}
    </button>
  );
}

/** The title bar's save state. */
function saveStateText(s: SaveStatus, doc: DocState, inCloud: boolean): string {
  if (doc.empty) return "";
  switch (s.kind) {
    case "saving":
      return "Saving…";
    case "offline":
      return "Not saved yet: changes kept in this browser, trying again";
    case "stopped":
      return "Not saved";
    case "waiting":
      return "Changes not saved yet";
    case "saved":
      return doc.dirty
        ? "Changes not saved yet"
        : inCloud
          ? "Saved"
          : "Not saved: change something to keep it";
  }
}
