// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type EngineState } from "@/worker/session";

export function StatusPill({
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
  else if (engine.controls.paused)
    [text, dot] = ["Paused. Press Play to drape", "bg-line"];
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
