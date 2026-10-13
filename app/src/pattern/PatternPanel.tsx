// SPDX-License-Identifier: AGPL-3.0-or-later
// The 2D pattern: every piece of the garment with its folds, grain line, notches and internal
// lines. Wheel zooms around the cursor, dragging pans, clicking a piece selects it. Pieces
// don't move until M7.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Garment, OutlineNode, Piece } from '@/format/schema.gen';
import { cn } from '@/lib/utils';
import { type Box, inside, layoutPieces, linePoints, outlinePoints, type P, pathData } from './geometry';

export type Selection = { kind: 'piece'; id: string } | null;

const NOTCH_MM = 10;

function fit(box: Box, aspect: number, margin = 40): Box {
  let w = box.maxX - box.minX + 2 * margin;
  let h = box.maxY - box.minY + 2 * margin;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };
}

function PieceShape({ piece, dx, dy, selected }: { piece: Piece; dx: number; dy: number; selected: boolean }) {
  const outline = outlinePoints(piece);
  const nodes = piece.outline as OutlineNode[];
  const byId = new Map(nodes.map((n) => [n.id, n.position]));
  // Notches: a tick into the piece, along the inward normal (the outline is counter-clockwise).
  const ticks = nodes.flatMap((n, k) => {
    if (n.type !== 'notch') return [];
    const prev = nodes[(k + nodes.length - 1) % nodes.length];
    const next = n.edge.points[0] ?? nodes[(k + 1) % nodes.length]?.position;
    const before = prev?.edge.points.at(-1) ?? prev?.position;
    if (!next || !before) return [];
    const tx = next[0] - before[0];
    const ty = next[1] - before[1];
    const len = Math.hypot(tx, ty) || 1;
    const [x, y] = n.position;
    return [[[x, y], [x - (ty / len) * NOTCH_MM, y + (tx / len) * NOTCH_MM]] as P[]];
  });
  const box = useMemo(() => {
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }, [outline]);
  const cuts = piece.cuts.length;
  return (
    <g transform={`translate(${dx} ${-dy})`}>
      <path
        d={pathData(outline, true)}
        className={cn('stroke-[1.5] transition-colors', selected ? 'fill-red-500/25 stroke-red-400' : 'fill-neutral-500/10 stroke-neutral-300')}
        vectorEffect="non-scaling-stroke"
      />
      {(piece.lines ?? []).map((l) => (
        <path key={l.id} d={pathData(linePoints(l), false)} className="fill-none stroke-sky-400" vectorEffect="non-scaling-stroke" />
      ))}
      {(piece.folds ?? []).map((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        return a && b ? (
          <path key={f.id} d={pathData([a, b], false)} className="stroke-amber-300 [stroke-dasharray:6_4]" vectorEffect="non-scaling-stroke" />
        ) : null;
      })}
      {ticks.map((t, i) => (
        <path key={i} d={pathData(t, false)} className="stroke-neutral-100 stroke-2" vectorEffect="non-scaling-stroke" />
      ))}
      {piece.grain && (
        <path
          d={pathData([piece.grain.from, piece.grain.to], false)}
          className="stroke-neutral-400"
          markerEnd="url(#grain-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text x={box.cx} y={-box.cy} textAnchor="middle" dominantBaseline="middle" className="pointer-events-none fill-neutral-200 text-[28px] select-none">
        {piece.name}
        {cuts > 1 ? ` ×${cuts}` : ''}
      </text>
    </g>
  );
}

export function PatternPanel(props: { garment: Garment | undefined; selection: Selection; onSelect: (s: Selection) => void }) {
  const { garment, selection, onSelect } = props;
  const layout = useMemo(() => layoutPieces(garment?.pieces ?? []), [garment?.pieces]);
  // The same box in SVG coordinates (y down).
  const all = useMemo(
    () => ({ minX: layout.box.minX, maxX: layout.box.maxX, minY: -layout.box.maxY, maxY: -layout.box.minY }),
    [layout.box],
  );
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  // The view box the user panned or zoomed to, for one garment (another file frames itself).
  const [userView, setUserView] = useState<{ garment: string | undefined; box: Box } | null>(null);
  const garmentId = garment?.id;
  const view = userView && userView.garment === garmentId ? userView.box : null;
  const setView = (box: Box | null) => setUserView(box ? { garment: garmentId, box } : null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = view ?? fit(all, size.w / size.h);
  // Keep the aspect of the panel (the view box may come from another size).
  const vb = fit(shown, size.w / size.h, 0);
  const mmPerPx = (vb.maxX - vb.minX) / size.w;

  const toPattern = (e: { clientX: number; clientY: number; currentTarget: Element }): P => {
    const r = e.currentTarget.getBoundingClientRect();
    return [vb.minX + (e.clientX - r.left) * mmPerPx, -(vb.minY + (e.clientY - r.top) * mmPerPx)];
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const k = Math.exp(e.deltaY * 0.0015);
      setUserView((u) => {
        const v = u && u.garment === garmentId ? u.box : null;
        const b = fit(v ?? fit(all, r.width / r.height), r.width / r.height, 0);
        const w = (b.maxX - b.minX) * k;
        const h = (b.maxY - b.minY) * k;
        const x = b.minX + (b.maxX - b.minX) * fx - w * fx;
        const y = b.minY + (b.maxY - b.minY) * fy - h * fy;
        return { garment: garmentId, box: { minX: x, maxX: x + w, minY: y, maxY: y + h } };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [all, garmentId]);

  return (
    <div
      ref={host}
      className="h-full w-full cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser no longer tracks: panning just stops at the panel's edge.
        }
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = (e.clientX - d.x) * mmPerPx;
        const dy = (e.clientY - d.y) * mmPerPx;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
        if (!d.moved) return;
        d.x = e.clientX;
        d.y = e.clientY;
        setView({ minX: vb.minX - dx, maxX: vb.maxX - dx, minY: vb.minY - dy, maxY: vb.maxY - dy });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        const p = toPattern(e);
        const hit = layout.placed.findLast(({ piece, dx, dy }) => inside([p[0] - dx, p[1] - dy], outlinePoints(piece)));
        onSelect(hit ? { kind: 'piece', id: hit.piece.id } : null);
      }}
      onDoubleClick={() => setView(null)}
    >
      {!garment && <div className="text-muted-foreground flex h-full items-center justify-center text-sm">No pattern</div>}
      <svg className={cn('block h-full w-full', !garment && 'hidden')} viewBox={`${vb.minX} ${vb.minY} ${vb.maxX - vb.minX} ${vb.maxY - vb.minY}`}>
        <defs>
          <marker id="grain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="fill-neutral-400" />
          </marker>
        </defs>
        {layout.placed.map(({ piece, dx, dy }) => (
          <PieceShape key={piece.id} piece={piece} dx={dx} dy={dy} selected={selection?.kind === 'piece' && selection.id === piece.id} />
        ))}
      </svg>
    </div>
  );
}
