// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat view (the 2D window): the pattern pieces, the status and notices while the 3D view
// is hidden, the shape bar, and the tool bar.

import { type ReactNode, type RefObject, useState } from "react";
import { type CutEdge } from "@/sewing/api";
import { SewLengthBar } from "./SewLengthBar";
import { setLayouts } from "@/document/commands";
import type { Garment, OutlineNode, Vec2 } from "@/format/schema.gen";
import { type DocState, DocumentStore } from "@/document/store";
import { cn } from "@/lib/utils";
import { PatternPanel } from "@/pattern/panel/PatternPanel";
import { type ShapeKind } from "@/pattern/draw";
import { type EngineState } from "@/worker/session";
import { type NewPiece } from "../dialogs/NewPieceDialog";
import { ShapeBar } from "@/pattern/ShapeBar";
import { useFiles } from "../hooks/useFiles";
import { FirstPieceHint } from "./FirstPieceHint";
import { StatusPill } from "./StatusPill";
import type { SplitView } from "../hooks/useSplitView";
import type { useSelection } from "../hooks/useSelection";
import type { useSewing } from "../hooks/useSewing";
import { CanvasMenu } from "./CanvasMenu";
import type { PickedActions } from "../hooks/usePickedActions";
import { FlatToolBar } from "./FlatToolBar";
import type { PatternView, FlatTool } from "@/pattern/panel/types";

export function FlatView(props: {
  view: SplitView;
  pattern: RefObject<PatternView | null>;
  doc: DocState;
  store: DocumentStore;
  files: ReturnType<typeof useFiles>;
  engine: EngineState;
  garment: Garment | undefined;
  selection: ReturnType<typeof useSelection>;
  sewing: ReturnType<typeof useSewing>;
  cutColors: ReadonlyMap<string, string>;
  flatTool: FlatTool;
  setFlatTool: (t: FlatTool) => void;
  shapeKind: ShapeKind;
  setShapeKind: (k: ShapeKind) => void;
  modHeld: boolean;
  placing: boolean;
  /** The notices, shown here while the 3D view is hidden. */
  cards: ReactNode;
  importFile: () => void;
  /** The pen closed a piece: it is named and placed in a dialog. */
  onDrawn: (outline: OutlineNode[], origin: Vec2) => void;
  addNewPiece: (n: NewPiece, origin?: Vec2) => Promise<void>;
  onSew: () => void;
  picked: PickedActions;
}) {
  const {
    pattern,
    doc,
    store,
    files,
    engine,
    garment,
    cutColors,
    flatTool,
    setFlatTool,
    shapeKind,
    setShapeKind,
    modHeld,
    placing,
    cards,
    importFile,
    addNewPiece,
    onSew,
  } = props;
  const { show2d, show3d, splitRatio, isResizing } = props.view;
  const {
    shown: shownSelection,
    select,
    hovered: shownHovered,
    litSeam: shownLitSeam,
  } = props.selection;
  const { edges, picks, pickEdge, hoveredRuns } = props.sewing;
  const [hoveredEdge, setHoveredEdge] = useState<CutEdge | null>(null);
  return (
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
      <CanvasMenu
        piece={!!shownSelection}
        actions={props.picked}
        empty={
          garment
            ? [
                {
                  label: "Fit the pieces in view",
                  onSelect: () => pattern.current?.reset(),
                },
                { label: "Draw a piece", onSelect: () => setFlatTool("draw") },
                { label: "Import a pattern…", onSelect: importFile },
              ]
            : []
        }
      >
        <div className="absolute inset-0">
          <PatternPanel
            ref={pattern}
            garment={garment}
            selection={shownSelection}
            onSelect={select}
            tool={flatTool}
            panning={modHeld}
            sewing={{
              edges,
              picked: picks ? [...picks.a, ...picks.b] : [],
              onPick: pickEdge,
              hovered: hoveredEdge,
              onHover: setHoveredEdge,
              suggested: hoveredRuns,
            }}
            cutColors={cutColors}
            highlight={shownHovered}
            highlightSeam={shownLitSeam}
            empty={
              <FirstPieceHint
                onDraw={() => setFlatTool("draw")}
                onShape={() => setFlatTool("shape")}
                onImport={importFile}
                busy={!!files.busy}
              />
            }
            onDrawn={(outline, origin) => props.onDrawn(outline, origin)}
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
      </CanvasMenu>

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

      {!doc.empty && flatTool === "sew" && garment && (
        <SewLengthBar
          garment={garment}
          picked={picks?.a ?? []}
          hovered={hoveredEdge}
          second={picks?.open === "b"}
        />
      )}

      {!doc.empty && flatTool === "shape" && (
        <div className="absolute bottom-[76px] left-1/2 z-10 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <ShapeBar kind={shapeKind} onKind={setShapeKind} />
        </div>
      )}
      {!doc.empty && (
        <FlatToolBar
          flatTool={flatTool}
          setFlatTool={setFlatTool}
          onSew={onSew}
        />
      )}
    </div>
  );
}
