// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D view (the drape): the viewport, the selected piece's handles while placing, the status
// and notices, what to do when the 3D view keeps stopping, and the tool bar.

import { useRef, type ReactNode } from "react";
import { setPlacement } from "@/document/commands";
import type { Garment, Placement } from "@/format/schema.gen";
import { DocumentStore } from "@/document/store";
import { cn } from "@/lib/utils";
import { tidy } from "@/placement/places";
import type { PointerTool } from "@/worker/protocol";
import { EngineSession, type EngineState } from "@/worker/session";
import { Gizmo } from "../viewport/Gizmo";
import { Viewport } from "../viewport/Viewport";
import { StatusPill } from "./StatusPill";
import type { SplitView } from "../hooks/useSplitView";
import type { useSelection } from "../hooks/useSelection";
import { useElementSize } from "../hooks/useElementSize";
import { DrapeToolBar } from "./DrapeToolBar";

export function DrapeView(props: {
  view: SplitView;
  session: EngineSession;
  engine: EngineState;
  store: DocumentStore;
  garment: Garment | undefined;
  tool: PointerTool;
  setTool: (t: PointerTool) => void;
  placing: boolean;
  /** The selected cut, found in the garment. */
  selected: ReturnType<typeof useSelection>["selected"];
  /** The selected cut in the drape shown, for its handles (-1: none). */
  gizmoIndex: number;
  cards: ReactNode;
}) {
  const {
    session,
    engine,
    store,
    garment,
    tool,
    setTool,
    placing,
    selected,
    gizmoIndex,
    cards,
  } = props;
  const { show2d, show3d, splitRatio, isResizing } = props.view;
  const canvasBox = useRef<HTMLDivElement>(null);
  const canvasSize = useElementSize(canvasBox);
  return (
    <div
      key="window-3d"
      ref={canvasBox}
      aria-label="3D Drape view"
      aria-hidden={!show3d}
      style={{
        width: !show3d ? "0%" : !show2d ? "100%" : `${(1 - splitRatio) * 100}%`,
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
            placement={selected.cut.placement as Placement & { type: "wrap" }}
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
          <div className="max-w-md space-y-2 rounded-[20px] border bg-card p-7 text-[15px]">
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
      <DrapeToolBar
        session={session}
        engine={engine}
        tool={tool}
        setTool={setTool}
      />
    </div>
  );
}
