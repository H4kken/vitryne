// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D view: a canvas whose drawing is handed to the engine worker. Pointer input goes to
// the worker with the active tool (turn: orbit; pinch: pull the cloth, or orbit off it;
// select: pick a piece with a click, orbit with a drag). On a trackpad a two-finger drag turns
// the camera and a pinch zooms, whatever the tool.

import type { PointerTool } from "@/worker/protocol";
import { type EngineSession, useEngine } from "@/worker/session";
import { ViewportCanvas } from "./ViewportCanvas";

export function Viewport({
  session,
  tool,
}: {
  session: EngineSession;
  tool: PointerTool;
}) {
  const engine = useEngine(session);
  // A new canvas per worker: an OffscreenCanvas can be handed over only once.
  return (
    <ViewportCanvas key={engine.generation} session={session} tool={tool} />
  );
}
