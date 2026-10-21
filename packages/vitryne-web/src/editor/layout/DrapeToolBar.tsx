// SPDX-License-Identifier: AGPL-3.0-or-later
import { FastForward, Pause, Play, RotateCcw } from "lucide-react";
import type { PointerTool } from "@/worker/protocol";
import { EngineSession, type EngineState } from "@/worker/session";
import { SelectIcon } from "../icons/SelectIcon";
import { TurnIcon } from "../icons/TurnIcon";
import { PinchIcon } from "../icons/PinchIcon";
import { ToolButton } from "./ToolButton";

/** The 3D view's floating tool bar: Select, Turn view and Pinch fabric; play, fast and restart. */
export function DrapeToolBar({
  session,
  engine,
  tool,
  setTool,
  placing,
}: {
  session: EngineSession;
  engine: EngineState;
  tool: PointerTool;
  setTool: (t: PointerTool) => void;
  placing: boolean;
}) {
  return (
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
        label={engine.controls.paused ? "Play (space)" : "Pause (space)"}
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
        onClick={() => session.setControls({ fast: !engine.controls.fast })}
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
  );
}
