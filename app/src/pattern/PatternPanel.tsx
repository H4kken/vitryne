// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat pieces view: every piece of the garment with its folds, grain line, notches and
// internal lines. Wheel zooms around the cursor, dragging pans, clicking a piece selects it.
// Pieces don't move until M7.

import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Garment, OutlineNode, Piece } from '@/format/schema.gen';
import { type Box, bounds, inside, layoutPieces, linePoints, outlinePoints, type P, pathData } from './geometry';

export type Selection = { kind: 'piece'; id: string } | null;

/** What the zoom control can do to the view. */
export interface PatternView {
  zoom(factor: number): void;
  reset(): void;
}

const NOTCH_MM = 10;
/** Room under each piece for its name. */
const LABEL_GAP_MM = 34;

function fit(box: Box, aspect: number, margin = 60): Box {
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
  const nodes = piece.outline;
  const byId = new Map(nodes.map((n: OutlineNode) => [n.id, n.position]));
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
  const box = bounds(outline);
  const cuts = piece.cuts.length;
  const pad = 12;
  return (
    <g transform={`translate(${dx} ${-dy})`}>
      <path d={pathData(outline, true)} fill="#FFFFFF" stroke="#14181F" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {(piece.lines ?? []).map((l) => (
        <path key={l.id} d={pathData(linePoints(l), false)} fill="none" stroke="#8E968A" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      ))}
      {(piece.folds ?? []).map((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        return a && b ? (
          <path key={f.id} d={pathData([a, b], false)} stroke="#8E968A" strokeWidth={1.6} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        ) : null;
      })}
      {ticks.map((t, i) => (
        <path key={i} d={pathData(t, false)} stroke="#14181F" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
      {piece.grain && (
        <path
          d={pathData([piece.grain.from, piece.grain.to], false)}
          stroke="#8E968A"
          strokeWidth={1.6}
          strokeLinecap="round"
          markerStart="url(#grain-arrow)"
          markerEnd="url(#grain-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {selected && (
        <rect
          x={box.minX - pad}
          y={-box.maxY - pad}
          width={box.maxX - box.minX + 2 * pad}
          height={box.maxY - box.minY + 2 * pad}
          fill="none"
          stroke="#3A63F0"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <text
        x={(box.minX + box.maxX) / 2}
        y={-box.minY + LABEL_GAP_MM}
        textAnchor="middle"
        fill={selected ? '#14181F' : '#5B625C'}
        fontWeight={selected ? 600 : 400}
        className="pointer-events-none font-sans text-[22px] select-none"
      >
        {piece.name}
        {cuts > 1 ? ` ×${cuts}` : ''}
      </text>
    </g>
  );
}

export function PatternPanel({
  garment,
  selection,
  onSelect,
  ref,
}: {
  garment: Garment | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  ref?: Ref<PatternView>;
}) {
  const layout = useMemo(() => layoutPieces(garment?.pieces ?? [], 80), [garment?.pieces]);
  // The same box in SVG coordinates (y down), with room for the labels.
  const all = useMemo(
    () => ({ minX: layout.box.minX, maxX: layout.box.maxX, minY: -layout.box.maxY, maxY: -layout.box.minY + LABEL_GAP_MM }),
    [layout.box],
  );
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const garmentId = garment?.id;
  // The view box the user panned or zoomed to, for one garment (another file frames itself).
  const [userView, setUserView] = useState<{ garment: string | undefined; box: Box } | null>(null);
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

  const aspect = size.w / size.h;
  // Room around the pieces for the status pill above and the hint and zoom below.
  const home = fit(all, aspect, 0.12 * Math.max(all.maxX - all.minX, (all.maxY - all.minY) * aspect));
  // Keep the aspect of the panel (the view box may come from another size).
  const vb = fit(view ?? home, aspect, 0);
  const mmPerPx = (vb.maxX - vb.minX) / size.w;

  /** Scales the view box by `k` (< 1 zooms in) around a point given as a fraction of the panel. */
  const zoomAt = (k: number, fx = 0.5, fy = 0.5) =>
    setUserView((u) => {
      const v = u && u.garment === garmentId ? u.box : null;
      const b = fit(v ?? home, aspect, 0);
      const w = (b.maxX - b.minX) * k;
      const h = (b.maxY - b.minY) * k;
      const x = b.minX + (b.maxX - b.minX) * fx - w * fx;
      const y = b.minY + (b.maxY - b.minY) * fy - h * fy;
      return { garment: garmentId, box: { minX: x, maxX: x + w, minY: y, maxY: y + h } };
    });

  useImperativeHandle(ref, () => ({
    zoom: (factor: number) => zoomAt(1 / factor),
    reset: () => setView(null),
  }));

  // The wheel listener is added once (non-passive); it calls the current zoomAt.
  const zoomRef = useRef(zoomAt);
  useEffect(() => {
    zoomRef.current = zoomAt;
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(e.deltaY * 0.0015), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const toPattern = (e: { clientX: number; clientY: number; currentTarget: Element }): P => {
    const r = e.currentTarget.getBoundingClientRect();
    return [vb.minX + (e.clientX - r.left) * mmPerPx, -(vb.minY + (e.clientY - r.top) * mmPerPx)];
  };

  return (
    <div
      ref={host}
      className="flat-grid h-full w-full cursor-default touch-none overflow-hidden"
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
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
        if (!d.moved) return;
        const dx = (e.clientX - d.x) * mmPerPx;
        const dy = (e.clientY - d.y) * mmPerPx;
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
      <svg
        className={garment ? 'block h-full w-full' : 'hidden'}
        viewBox={`${vb.minX} ${vb.minY} ${vb.maxX - vb.minX} ${vb.maxY - vb.minY}`}
        role="img"
        aria-label={`Flat pattern pieces: ${(garment?.pieces ?? []).map((p) => p.name).join(', ')}`}
      >
        <defs>
          <marker id="grain-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="#8E968A" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {layout.placed.map(({ piece, dx, dy }) => (
          <PieceShape key={piece.id} piece={piece} dx={dx} dy={dy} selected={selection?.kind === 'piece' && selection.id === piece.id} />
        ))}
      </svg>
    </div>
  );
}
