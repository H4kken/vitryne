// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D view: a canvas whose drawing is handed to the engine worker. Pointer input goes to
// the worker with the active tool (pinch: pull the cloth; select: pick a
// piece with a click, orbit with a drag). Cmd (Ctrl) held turns the view and Option (Alt) slides
// it, whatever the tool. On a trackpad a two-finger drag up or down and a pinch zoom.

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
