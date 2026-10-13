// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D view: a canvas whose drawing is handed to the engine worker. Pointer input goes to
// the worker with the active tool (turn: orbit; pinch: pull the cloth, or orbit off it;
// select: pick a piece with a click, orbit with a drag).

import { useEffect, useRef } from 'react';
import type { PointerTool } from '@/worker/protocol';
import { type EngineSession, useEngine } from '@/worker/session';

const MAX_DPR = 2;

/** The concept's 3D look: its canvas ground, a sage garment, the mannequin grey. Values 0..1. */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const SCENE_STYLE = [...hex('#ECEFE9'), ...hex('#9DB4A0'), ...hex('#7F9783'), ...hex('#CBD0C6')];

function canvasSize(el: HTMLElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  return { width: Math.max(1, Math.round(el.clientWidth * dpr)), height: Math.max(1, Math.round(el.clientHeight * dpr)) };
}

export function Viewport({ session, tool }: { session: EngineSession; tool: PointerTool }) {
  const engine = useEngine(session);
  // A new canvas per worker: an OffscreenCanvas can be handed over only once.
  return <ViewportCanvas key={engine.generation} session={session} tool={tool} />;
}

function ViewportCanvas({ session, tool }: { session: EngineSession; tool: PointerTool }) {
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
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      session.wheel(-e.deltaY / 100);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', wheel);
      session.detach();
    };
  }, [session]);

  const send = (phase: 'down' | 'move' | 'up', e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = 1 - ((e.clientY - r.top) / r.height) * 2;
    session.pointer(phase, x, y, e.clientX, e.clientY, phase === 'down' ? tool : undefined);
  };

  return (
    <canvas
      ref={ref}
      aria-label="3D view of the garment on the mannequin"
      className={`block h-full w-full touch-none outline-none ${tool === 'turn' ? 'cursor-grab active:cursor-grabbing' : tool === 'pinch' ? 'cursor-crosshair' : 'cursor-default'}`}
      tabIndex={-1}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not a pointer the browser tracks: the drag ends at the canvas edge.
        }
        send('down', e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) send('move', e);
      }}
      onPointerUp={(e) => send('up', e)}
      onPointerCancel={(e) => send('up', e)}
    />
  );
}
