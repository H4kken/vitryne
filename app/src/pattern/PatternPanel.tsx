// SPDX-License-Identifier: AGPL-3.0-or-later
// The flat pieces view: every cut of the garment (a mirrored one drawn mirrored) with its
// folds, grain line, notches and internal lines, where its layout puts it. Wheel zooms around
// the cursor, dragging empty space pans. The select tool picks a cut and turns it by its round
// handle; the move tool drags cuts; the sew tool picks whole edges to sew (two clicks, edge
// then edge: nothing is measured or shown while picking, docs/PATENTS.md). Sewn edges are drawn
// in a colour per seam. Where a cut sits here is display only (`cut.layout`).

import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Garment, OutlineNode, Piece } from "@/format/schema.gen";
import {
  apply,
  type Box,
  bounds,
  type CutView,
  inside,
  layoutCuts,
  linePoints,
  outlinePoints,
  distToPolyline,
  type P,
  pathData,
  runPoints,
  type Transform,
  unapply,
} from "./geometry";
import { type CutEdge, sameEdge } from "@/sewing/api";

/** A cut, by its id (and its piece's). */
export type Selection = { kind: "cut"; pieceId: string; cutId: string } | null;

export type FlatTool = "select" | "move" | "sew";

/** The sew tool's edges and what the user has picked so far. */
export interface SewingState {
  edges: CutEdge[];
  /** The edges picked so far, both sides. */
  picked: CutEdge[];
  /** `more`: Shift was held, so the side being picked continues with another edge. */
  onPick: (edge: CutEdge, more: boolean) => void;
}

const SEAM_COLOURS = [
  "#3A63F0",
  "#D6457F",
  "#1F9D6B",
  "#D9822B",
  "#7B5CD6",
  "#2A9DB5",
];
/** How close the pointer must be to an edge to pick it, screen pixels. */
const EDGE_PICK_PX = 10;

/** What the zoom control can do to the view. */
export interface PatternView {
  zoom(factor: number): void;
  reset(): void;
}

const NOTCH_MM = 10;
/** Room under each cut for its name. */
const LABEL_GAP_MM = 34;
/** The turn handle: how far above the selection, and how big, in screen pixels. */
const HANDLE_PX = 26;
const HANDLE_R_PX = 7;
const SNAP_DEG = 15;

function fit(box: Box, aspect: number, margin = 60): Box {
  let w = box.maxX - box.minX + 2 * margin;
  let h = box.maxY - box.minY + 2 * margin;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - h / 2,
    maxY: cy + h / 2,
  };
}

/** The SVG transform for a cut's frame (SVG's y points down, so turns are clockwise there). */
function svgTransform(t: Transform, mirrored: boolean): string {
  return `translate(${t.x} ${-t.y}) rotate(${(-t.rot * 180) / Math.PI}) scale(${mirrored ? -1 : 1} 1)`;
}

/** The piece drawn in its own frame (the group around it mirrors, turns and moves it). */
/** The grid's steps, in millimetres, like millimetre paper: 1, 5 and 10 mm, then on by 5 and 2. */
const GRID_STEPS_MM = [1, 5, 10, 50, 100, 500, 1000, 5000];
/** A step's lines show from this spacing on screen, and reach full strength at the second. */
const GRID_MIN_PX = 5;
const GRID_FULL_PX = 80;

/**
 * Millimetre paper under the pieces, in pattern millimetres (the origin is the layout's): each
 * step fades in as zooming spreads its lines, and the coarser steps fall on the finer ones' lines
 * so every 5th and 10th line reads darker.
 */
function Grid({ box, mmPerPx }: { box: Box; mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  return (
    <g
      fill="none"
      stroke="#7F8B78"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      shapeRendering="crispEdges"
      pointerEvents="none"
    >
      {GRID_STEPS_MM.map((step) => {
        const px = step / mmPerPx;
        if (
          px < GRID_MIN_PX ||
          px > Math.max(box.maxX - box.minX, box.maxY - box.minY) / mmPerPx
        )
          return null;
        const strength = Math.min(
          1,
          (px - GRID_MIN_PX) / (GRID_FULL_PX - GRID_MIN_PX),
        );
        let d = "";
        for (
          let x = Math.ceil(box.minX / step) * step;
          x <= box.maxX;
          x += step
        )
          d += `M${x} ${box.minY}V${box.maxY}`;
        for (
          let y = Math.ceil(box.minY / step) * step;
          y <= box.maxY;
          y += step
        )
          d += `M${box.minX} ${y}H${box.maxX}`;
        return (
          <path
            key={step}
            d={d}
            vectorEffect="non-scaling-stroke"
            strokeOpacity={0.06 + 0.3 * strength}
          />
        );
      })}
    </g>
  );
}

/** The scale bar's longest length on screen, pixels. */
const SCALE_MAX_PX = 120;

/** A map's scale bar: the longest round length (1, 2 or 5 times a power of ten mm) that fits. */
function ScaleBar({ mmPerPx }: { mmPerPx: number }) {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  const most = SCALE_MAX_PX * mmPerPx;
  const pow = 10 ** Math.floor(Math.log10(most));
  const mm = [5, 2, 1].map((k) => k * pow).find((v) => v <= most) ?? pow;
  const label =
    mm >= 1000
      ? `${mm / 1000} m`
      : mm >= 10
        ? `${mm / 10} cm`
        : `${+mm.toPrecision(3)} mm`;
  return (
    <div className="pointer-events-none absolute right-4 bottom-[68px] flex flex-col items-end gap-1 text-[12px] font-medium text-[#4A514B]">
      <span>{label}</span>
      <span
        className="h-1.5 border-x-[1.5px] border-b-[1.5px] border-[#4A514B]"
        style={{ width: mm / mmPerPx }}
      />
    </div>
  );
}

/** `color`: the cut's own (its appearance), drawn light so the lines stay readable. */
function PieceDrawing({ piece, color }: { piece: Piece; color?: string }) {
  const outline = outlinePoints(piece);
  const nodes = piece.outline;
  const byId = new Map(nodes.map((n: OutlineNode) => [n.id, n.position]));
  // Notches: a tick into the piece, along the inward normal (the outline is counter-clockwise).
  const ticks = nodes.flatMap((n, k) => {
    if (n.type !== "notch") return [];
    const prev = nodes[(k + nodes.length - 1) % nodes.length];
    const next = n.edge.points[0] ?? nodes[(k + 1) % nodes.length]?.position;
    const before = prev?.edge.points.at(-1) ?? prev?.position;
    if (!next || !before) return [];
    const tx = next[0] - before[0];
    const ty = next[1] - before[1];
    const len = Math.hypot(tx, ty) || 1;
    const [x, y] = n.position;
    return [
      [
        [x, y],
        [x - (ty / len) * NOTCH_MM, y + (tx / len) * NOTCH_MM],
      ] as P[],
    ];
  });
  return (
    <>
      <path d={pathData(outline, true)} fill="#FFFFFF" stroke="none" />
      <path
        d={pathData(outline, true)}
        fill={color ?? "none"}
        fillOpacity={0.55}
        stroke="#14181F"
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {(piece.lines ?? []).map((l) => (
        <path
          key={l.id}
          d={pathData(linePoints(l), false)}
          fill="none"
          stroke="#8E968A"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {(piece.folds ?? []).map((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        return a && b ? (
          <path
            key={f.id}
            d={pathData([a, b], false)}
            stroke="#8E968A"
            strokeWidth={1.6}
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null;
      })}
      {ticks.map((t, i) => (
        <path
          key={i}
          d={pathData(t, false)}
          stroke="#14181F"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
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
    </>
  );
}

function cutLabel(v: CutView): string {
  return v.cut.name ?? v.piece.name;
}

type Drag =
  | { kind: "pan"; x: number; y: number; moved: boolean; hit: CutView | null }
  | { kind: "move"; cut: CutView; start: P; t: Transform; moved: boolean }
  | {
      kind: "turn";
      cut: CutView;
      centre: P;
      local: P;
      from: number;
      t: Transform;
    };

export function PatternPanel({
  garment,
  selection,
  onSelect,
  tool,
  onArrange,
  sewing,
  cutColors,
  ref,
}: {
  garment: Garment | undefined;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: FlatTool;
  /** A cut moved or turned: its new layout (one edit per drag). */
  onArrange: (cutId: string, t: Transform) => void;
  /** For the sew tool: the whole edges to pick from. */
  sewing?: SewingState;
  /** Each coloured cut's colour (#rrggbb), by cut id. */
  cutColors?: ReadonlyMap<string, string>;
  ref?: Ref<PatternView>;
}) {
  const layout = useMemo(() => layoutCuts(garment), [garment]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const garmentId = garment?.id;
  // The view box the user panned or zoomed to, for one garment (another file frames itself).
  const [userView, setUserView] = useState<{
    garment: string | undefined;
    box: Box;
  } | null>(null);
  const view = userView && userView.garment === garmentId ? userView.box : null;
  const setView = (box: Box | null) =>
    setUserView(box ? { garment: garmentId, box } : null);
  const drag = useRef<Drag | null>(null);
  /** A cut being dragged or turned, drawn where the pointer has it until the edit lands. */
  const [live, setLive] = useState<{ cutId: string; t: Transform } | null>(
    null,
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cuts = layout.cuts.map((v) => {
    if (live?.cutId !== v.cut.id) return v;
    return { ...v, t: live.t, box: bounds(v.pts.map((p) => apply(live.t, p))) };
  });
  // The same box in SVG coordinates (y down), with room for the labels.
  const all = {
    minX: layout.box.minX,
    maxX: layout.box.maxX,
    minY: -layout.box.maxY,
    maxY: -layout.box.minY + LABEL_GAP_MM,
  };
  const aspect = size.w / size.h;
  // Room around the pieces for the status pill above and the hint and zoom below.
  const home = fit(
    all,
    aspect,
    0.12 * Math.max(all.maxX - all.minX, (all.maxY - all.minY) * aspect),
  );
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
      return {
        garment: garmentId,
        box: { minX: x, maxX: x + w, minY: y, maxY: y + h },
      };
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
      zoomRef.current(
        Math.exp(e.deltaY * 0.0015),
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const toPattern = (e: { clientX: number; clientY: number }): P => {
    const r = host.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return [
      vb.minX + (e.clientX - r.left) * mmPerPx,
      -(vb.minY + (e.clientY - r.top) * mmPerPx),
    ];
  };

  /** The free whole edge nearest to `p`, if the pointer is on one. */
  const edgeHit = (p: P): CutEdge | null => {
    if (!sewing) return null;
    let best: { e: CutEdge; d: number } | null = null;
    for (const v of cuts) {
      const q = unapply(v.t, p);
      const local: P = v.cut.mirrored ? [-q[0], q[1]] : q;
      for (const e of sewing.edges) {
        if (e.cut !== v.cut.id || e.sewn) continue;
        const d = distToPolyline(local, runPoints(v.piece, e.from, e.to, true));
        if (d <= EDGE_PICK_PX * mmPerPx && (!best || d < best.d))
          best = { e, d };
      }
    }
    return best?.e ?? null;
  };

  const hitCut = (p: P) =>
    [...cuts].reverse().find((v) => inside(unapply(v.t, p), v.pts)) ?? null;
  const selected = selection
    ? cuts.find((v) => v.cut.id === selection.cutId)
    : undefined;
  // The turn handle, above the selection's top middle (pattern coordinates, y up).
  const handle: P | null = selected
    ? [
        (selected.box.minX + selected.box.maxX) / 2,
        selected.box.maxY + HANDLE_PX * mmPerPx,
      ]
    : null;
  const select = (v: CutView | null) =>
    onSelect(v ? { kind: "cut", pieceId: v.piece.id, cutId: v.cut.id } : null);
  // Panning or zooming during a drag would move the fit under the pointer: freeze it.
  const freeze = () => {
    if (!view) setView(vb);
  };

  return (
    <div
      ref={host}
      className={`flat-grid relative h-full w-full touch-none overflow-hidden ${tool === "move" ? "cursor-move" : tool === "sew" ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser no longer tracks: the drag just stops at the panel's edge.
        }
        const p = toPattern(e);
        if (
          selected &&
          handle &&
          Math.hypot(p[0] - handle[0], p[1] - handle[1]) <=
            (HANDLE_R_PX + 4) * mmPerPx
        ) {
          const centre: P = [
            (selected.box.minX + selected.box.maxX) / 2,
            (selected.box.minY + selected.box.maxY) / 2,
          ];
          freeze();
          drag.current = {
            kind: "turn",
            cut: selected,
            centre,
            local: unapply(selected.t, centre),
            from: Math.atan2(p[1] - centre[1], p[0] - centre[0]),
            t: selected.t,
          };
          return;
        }
        if (tool === "sew") {
          const edge = edgeHit(p);
          if (edge) {
            sewing?.onPick(edge, e.shiftKey);
            return;
          }
        }
        const hit = hitCut(p);
        if (tool === "move" && hit) {
          freeze();
          select(hit);
          drag.current = {
            kind: "move",
            cut: hit,
            start: p,
            t: hit.t,
            moved: false,
          };
          return;
        }
        drag.current = {
          kind: "pan",
          x: e.clientX,
          y: e.clientY,
          moved: false,
          hit,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.kind === "pan") {
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3)
            d.moved = true;
          if (!d.moved) return;
          const dx = (e.clientX - d.x) * mmPerPx;
          const dy = (e.clientY - d.y) * mmPerPx;
          d.x = e.clientX;
          d.y = e.clientY;
          setView({
            minX: vb.minX - dx,
            maxX: vb.maxX - dx,
            minY: vb.minY - dy,
            maxY: vb.maxY - dy,
          });
          return;
        }
        const p = toPattern(e);
        if (d.kind === "move") {
          d.moved = true;
          setLive({
            cutId: d.cut.cut.id,
            t: {
              ...d.t,
              x: d.t.x + p[0] - d.start[0],
              y: d.t.y + p[1] - d.start[1],
            },
          });
          return;
        }
        // Turn about the box's centre: that point of the cut stays put.
        let rot =
          d.t.rot + Math.atan2(p[1] - d.centre[1], p[0] - d.centre[0]) - d.from;
        if (e.shiftKey) {
          const step = (SNAP_DEG * Math.PI) / 180;
          rot = Math.round(rot / step) * step;
        }
        rot = Math.atan2(Math.sin(rot), Math.cos(rot));
        const [x, y] = apply({ x: 0, y: 0, rot }, d.local);
        setLive({
          cutId: d.cut.cut.id,
          t: { x: d.centre[0] - x, y: d.centre[1] - y, rot },
        });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.kind === "pan") {
          if (!d.moved) select(d.hit);
          return;
        }
        if (
          live &&
          live.cutId === d.cut.cut.id &&
          (d.kind === "turn" || d.moved)
        ) {
          const round = (x: number) => Math.round(x * 1000) / 1000;
          onArrange(d.cut.cut.id, {
            x: round(live.t.x),
            y: round(live.t.y),
            rot: Math.round(live.t.rot * 1e4) / 1e4,
          });
        }
        setLive(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLive(null);
      }}
      onDoubleClick={() => setView(null)}
    >
      <svg
        className={garment ? "block h-full w-full" : "hidden"}
        viewBox={`${vb.minX} ${vb.minY} ${vb.maxX - vb.minX} ${vb.maxY - vb.minY}`}
        role="img"
        aria-label={`Flat pattern pieces: ${cuts.map(cutLabel).join(", ")}`}
      >
        <defs>
          <marker
            id="grain-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1 L9 5 L1 9"
              fill="none"
              stroke="#8E968A"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <Grid box={vb} mmPerPx={mmPerPx} />
        {cuts.map((v) => {
          const on = selection?.cutId === v.cut.id;
          return (
            <g key={v.cut.id}>
              <g transform={svgTransform(v.t, !!v.cut.mirrored)}>
                <PieceDrawing
                  piece={v.piece}
                  color={cutColors?.get(v.cut.id)}
                />
                {/* Seams, one colour each, on the edges they sew. */}
                {(garment?.seams ?? []).flatMap((seam, i) =>
                  [...seam.a, ...seam.b]
                    .filter((r) => r.cut === v.cut.id && !r.line)
                    .map((r, k) => (
                      <path
                        key={`${seam.id}:${k}`}
                        d={pathData(
                          runPoints(
                            v.piece,
                            r.from,
                            r.to,
                            r.direction !== "cw",
                          ),
                          false,
                        )}
                        fill="none"
                        stroke={SEAM_COLOURS[i % SEAM_COLOURS.length]}
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                        vectorEffect="non-scaling-stroke"
                      />
                    )),
                )}
                {/* The sew tool: free edges to pick, and the first pick. */}
                {tool === "sew" &&
                  sewing?.edges
                    .filter((e) => e.cut === v.cut.id && !e.sewn)
                    .map((e) => {
                      const on = sewing.picked.some((x) => sameEdge(x, e));
                      return (
                        <path
                          key={`${e.from}:${e.to}`}
                          d={pathData(
                            runPoints(v.piece, e.from, e.to, true),
                            false,
                          )}
                          fill="none"
                          stroke="#3A63F0"
                          strokeWidth={on ? 7 : 4}
                          strokeDasharray={on ? undefined : "2 7"}
                          strokeLinecap="round"
                          opacity={on ? 1 : 0.55}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
              </g>
              <text
                x={(v.box.minX + v.box.maxX) / 2}
                y={-v.box.minY + LABEL_GAP_MM}
                textAnchor="middle"
                fill={on ? "#14181F" : "#5B625C"}
                fontWeight={on ? 600 : 400}
                className="pointer-events-none font-sans text-[22px] select-none"
              >
                {cutLabel(v)}
                {v.cut.mirrored ? " (mirrored)" : ""}
              </text>
            </g>
          );
        })}
        {selected && handle && (
          <g>
            <rect
              x={selected.box.minX - 12}
              y={-selected.box.maxY - 12}
              width={selected.box.maxX - selected.box.minX + 24}
              height={selected.box.maxY - selected.box.minY + 24}
              fill="none"
              stroke="#3A63F0"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={pathData([[handle[0], selected.box.maxY + 12], handle], false)}
              stroke="#3A63F0"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={handle[0]}
              cy={-handle[1]}
              r={HANDLE_R_PX * mmPerPx}
              fill="#FFFFFF"
              stroke="#3A63F0"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              className="cursor-grab"
            >
              <title>Drag to turn (Shift: 15° steps)</title>
            </circle>
          </g>
        )}
      </svg>
      {garment && <ScaleBar mmPerPx={mmPerPx} />}
    </div>
  );
}
