// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import type { PointerTool } from "@/worker/protocol";
import { type EngineSession } from "@/worker/session";

const MAX_DPR = 2;

/** The concept's 3D look: its canvas ground, a sage garment, the mannequin grey. Values 0..1. */
const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const SCENE_STYLE = [
  ...hex("#ECEFE9"),
  ...hex(DEFAULT_CLOTH_COLOR),
  ...hex("#7F9783"),
  ...hex("#CBD0C6"),
];

function canvasSize(el: HTMLElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  return {
    width: Math.max(1, Math.round(el.clientWidth * dpr)),
    height: Math.max(1, Math.round(el.clientHeight * dpr)),
  };
}

export function ViewportCanvas({
  session,
  tool,
}: {
  session: EngineSession;
  tool: PointerTool;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    session.setStyle(SCENE_STYLE);
    session.attach(canvas, canvasSize(canvas));
    const ro = new ResizeObserver(() => {
      const s = canvasSize(canvas);
      session.resize(s.width, s.height);
    });
    ro.observe(canvas);
    // A wheel notch zooms. On a trackpad a two-finger drag turns the camera and a pinch (which
    // browsers send as a wheel with ctrl held) zooms. Trackpads send small, often fractional
    // deltas or sideways ones; a wheel notch is a big, whole, vertical one.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        session.wheel(-e.deltaY / 15);
        return;
      }
      const trackpad =
        e.deltaMode === 0 &&
        (e.deltaX !== 0 ||
          Math.abs(e.deltaY) < 50 ||
          !Number.isInteger(e.deltaY));
      if (trackpad) session.orbit(-e.deltaX, -e.deltaY);
      else session.wheel(-e.deltaY / 100);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", wheel);
      session.detach();
    };
  }, [session]);

  const send = (
    phase: "down" | "move" | "up",
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = 1 - ((e.clientY - r.top) / r.height) * 2;
    session.pointer(
      phase,
      x,
      y,
      e.clientX,
      e.clientY,
      phase === "down" ? tool : undefined,
    );
  };

  return (
    <canvas
      ref={ref}
      aria-label="3D view of the garment on the mannequin"
      className={`block h-full w-full touch-none outline-none ${tool === "turn" ? "cursor-grab active:cursor-grabbing" : tool === "pinch" ? "cursor-crosshair" : "cursor-default"}`}
      tabIndex={-1}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not a pointer the browser tracks: the drag ends at the canvas edge.
        }
        send("down", e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) send("move", e);
      }}
      onPointerUp={(e) => send("up", e)}
      onPointerCancel={(e) => send("up", e)}
    />
  );
}
