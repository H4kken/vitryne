// SPDX-License-Identifier: AGPL-3.0-or-later
// The 3D view: a canvas whose drawing is handed to the engine worker. Pointer input goes to
// the worker as is (it decides between dragging cloth and orbiting, after its pick).

import { useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw, FastForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { type EngineSession, useEngine } from '@/worker/session';

const MAX_DPR = 2;

function canvasSize(el: HTMLElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  return { width: Math.max(1, Math.round(el.clientWidth * dpr)), height: Math.max(1, Math.round(el.clientHeight * dpr)) };
}

export function Viewport({ session }: { session: EngineSession }) {
  const engine = useEngine(session);
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#17171c]">
      {/* A new canvas per worker: an OffscreenCanvas can be handed over only once. */}
      <ViewportCanvas key={engine.generation} session={session} />
      <div className="absolute top-2 right-2 flex gap-1">
        <ControlButton
          label={engine.controls.paused ? 'Play (space)' : 'Pause (space)'}
          onClick={() => session.setControls({ paused: !engine.controls.paused })}
        >
          {engine.controls.paused ? <Play /> : <Pause />}
        </ControlButton>
        <ControlButton
          label="Fast drape (F)"
          active={engine.controls.fast}
          onClick={() => session.setControls({ fast: !engine.controls.fast })}
        >
          <FastForward />
        </ControlButton>
        <ControlButton label="Restart the drape (R)" onClick={() => session.resetDrape()}>
          <RotateCcw />
        </ControlButton>
      </div>
      {engine.progress && (
        <div className="bg-background/80 absolute inset-x-0 bottom-4 mx-auto w-72 rounded-md p-3 text-sm backdrop-blur">
          <div className="mb-2">{engine.progress.task}…</div>
          <div className="bg-muted h-1.5 overflow-hidden rounded">
            <div className="bg-primary h-full transition-[width]" style={{ width: `${engine.progress.fraction * 100}%` }} />
          </div>
        </div>
      )}
      {engine.drapeError && (
        <div className="bg-destructive/15 text-destructive absolute inset-x-4 bottom-4 rounded-md p-3 text-sm">
          The drape could not be built: {engine.drapeError}
        </div>
      )}
      {engine.phase === 'failed' && (
        <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-8 text-sm">
          <div className="max-w-md space-y-2">
            <p className="font-medium">The 3D engine keeps stopping, so it was not restarted again.</p>
            <p className="text-muted-foreground">Last reason: {engine.failure}</p>
            <p>Your document is still here: you can save it, then reload the page.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton(props: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="secondary"
          aria-label={props.label}
          aria-pressed={props.active}
          className={cn('size-8 opacity-80 hover:opacity-100', props.active && 'bg-primary text-primary-foreground')}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function ViewportCanvas({ session }: { session: EngineSession }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
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
    session.pointer(phase, x, y, e.clientX, e.clientY);
  };

  return (
    <canvas
      ref={ref}
      className="block h-full w-full touch-none outline-none"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
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
