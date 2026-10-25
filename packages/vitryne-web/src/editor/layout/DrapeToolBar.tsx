// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { FastForward, Pause, Play, RotateCcw } from "lucide-react";
import type { PointerTool } from "@/worker/protocol";
import { EngineSession, type EngineState } from "@/worker/session";
import { SelectIcon } from "../icons/SelectIcon";
import { PinchIcon } from "../icons/PinchIcon";
import { ToolButton } from "./ToolButton";

/** The 3D view's floating tool bar: Select and Pinch fabric; play, fast and restart. */
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
  // The drape waits while placing, whatever the pause flag says.
  const running = !engine.controls.paused && !placing;
  // A pinch on the cloth while paused: the Play button flashes, it is what makes it work.
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (engine.playHint === 0) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(t);
  }, [engine.playHint]);
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-[14px] bg-primary p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.25)]">
      <ToolButton
        label="Select (1)"
        selected={tool === "select"}
        onClick={() => setTool("select")}
      >
        <SelectIcon />
      </ToolButton>
      <ToolButton
        label="Pinch fabric (2)"
        selected={tool === "pinch"}
        onClick={() => setTool("pinch")}
      >
        <PinchIcon />
      </ToolButton>
      <span className="mx-1 my-2 w-px bg-primary-foreground/20" />
      <ToolButton
        label={running ? "Pause (space)" : "Play (space)"}
        flash={flash}
        onClick={() => {
          // Play while placing means "drape now".
          if (placing) setTool("pinch");
          session.setControls({
            paused: placing ? false : !engine.controls.paused,
          });
        }}
      >
        {running ? <Pause className="size-5" /> : <Play className="size-5" />}
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
