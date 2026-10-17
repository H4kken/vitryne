// SPDX-License-Identifier: AGPL-3.0-or-later
// The handles of the cut being placed, over the 3D view (docs/ARCHITECTURE.md, Placement): up
// and down the body, around it, away from it, and a ring to turn the piece. The worker says
// where they are on screen and how far a handle's point moves per unit of what it changes;
// a drag shows the cut moving at once (`onPreview`) and is one edit when let go (`onCommit`).

import { useRef, useState } from "react";
import type { Placement } from "@/format/schema.gen";
import type { GizmoHandle, GizmoView } from "@/worker/protocol";

type Wrap = Placement & { type: "wrap" };
type Kind = "along" | "around" | "out" | "turn";

const LABELS: Record<Kind, string> = {
  along: "Drag to move it up or down the body",
  around: "Drag to move it around the body",
  out: "Drag to move it closer to or away from the body",
  turn: "Drag to turn it",
};

type Px = [number, number];

export function Gizmo(props: {
  view: GizmoView;
  width: number;
  height: number;
  placement: Wrap;
  onPreview: (p: Wrap) => void;
  onCommit: (p: Wrap) => void;
}) {
  const { view, width: w, height: h } = props;
  const [active, setActive] = useState<Kind | null>(null);
  const [hover, setHover] = useState<Kind | null>(null);
  const drag = useRef<{ kind: Kind; last: Px; p: Wrap } | null>(null);

  const px = ([x, y]: [number, number]): Px => [
    ((x + 1) / 2) * w,
    ((1 - y) / 2) * h,
  ];
  /** A handle's screen motion per unit, in pixels (y down). */
  const perPx = (hd: GizmoHandle): Px => [
    (hd.per[0] * w) / 2,
    (-hd.per[1] * h) / 2,
  ];
  const centre = px(view.centre);
  const d = (pts: [number, number][]) =>
    pts
      .map(
        (q, i) =>
          `${i ? "L" : "M"}${px(q)[0].toFixed(1)} ${px(q)[1].toFixed(1)}`,
      )
      .join(" ");

  /** How much of a handle's value a pointer move gives: its projection on the handle's motion. */
  const along = (hd: GizmoHandle, dx: number, dy: number) => {
    const [a, b] = perPx(hd);
    const n = a * a + b * b;
    return n > 1e-9 ? (dx * a + dy * b) / n : 0;
  };

  const start = (kind: Kind) => (e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not a pointer the browser tracks: the drag ends at the edge.
    }
    drag.current = { kind, last: [e.clientX, e.clientY], p: props.placement };
    setActive(kind);
  };

  const move = (e: React.PointerEvent<SVGElement>) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.last[0];
    const dy = e.clientY - g.last[1];
    if (!dx && !dy) return;
    const p = { ...g.p };
    if (g.kind === "along") p.top = (p.top ?? 0) + along(view.along, dx, dy);
    else if (g.kind === "around")
      p.angle = (p.angle ?? 0) + along(view.around, dx, dy);
    else if (g.kind === "out")
      p.radius = Math.max(5, (p.radius ?? 0) + along(view.out, dx, dy));
    else {
      // Turning: the change in the pointer's angle about the centre, signed by which way the
      // piece's x turns into its y on screen.
      const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
      };
      const a0 = Math.atan2(
        g.last[1] - r.top - centre[1],
        g.last[0] - r.left - centre[0],
      );
      const a1 = Math.atan2(
        e.clientY - r.top - centre[1],
        e.clientX - r.left - centre[0],
      );
      let da = a1 - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const [tx, ty] = perPx(view.around);
      const [ax, ay] = perPx(view.along);
      const sign = tx * ay - ty * ax >= 0 ? 1 : -1;
      p.rotation = (p.rotation ?? 0) + sign * da;
    }
    g.p = p;
    g.last = [e.clientX, e.clientY];
    props.onPreview(p);
  };

  const end = () => {
    const g = drag.current;
    drag.current = null;
    setActive(null);
    if (g && g.p !== props.placement) props.onCommit(g.p);
  };

  const handleProps = (kind: Kind) => ({
    onPointerDown: start(kind),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onPointerEnter: () => setHover(kind),
    onPointerLeave: () => setHover(null),
    className: "pointer-events-auto cursor-grab active:cursor-grabbing",
  });

  const stroke = (kind: Kind) =>
    active === kind || hover === kind ? "#E4572E" : "#3A63F0";
  const width = (kind: Kind) => (active === kind || hover === kind ? 3.5 : 2.5);

  /** An arrow head at the end of a polyline, `size` px. */
  const head = (pts: [number, number][], size = 9) => {
    const [p, q] = pts.slice(-2);
    if (!p || !q) return "";
    const a = px(p);
    const b = px(q);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    return `M${b[0] - ux * size - uy * size * 0.6} ${b[1] - uy * size + ux * size * 0.6} L${b[0]} ${b[1]} L${b[0] - ux * size + uy * size * 0.6} ${b[1] - uy * size - ux * size * 0.6}`;
  };

  const handle = (
    kind: Kind,
    pts: [number, number][],
    ends: "both" | "end" | "none",
  ) => (
    <g {...handleProps(kind)}>
      <title>{LABELS[kind]}</title>
      {/* A wide invisible stroke, easy to grab. */}
      <path d={d(pts)} fill="none" stroke="transparent" strokeWidth={18} />
      <path
        d={d(pts)}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={width(kind) + 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <path
        d={d(pts)}
        fill="none"
        stroke={stroke(kind)}
        strokeWidth={width(kind)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {ends !== "none" && (
        <path
          d={head(pts)}
          fill="none"
          stroke={stroke(kind)}
          strokeWidth={width(kind)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {ends === "both" && (
        <path
          d={head([...pts].reverse())}
          fill="none"
          stroke={stroke(kind)}
          strokeWidth={width(kind)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  );

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={w}
      height={h}
      role="group"
      aria-label="Handles to place the piece"
    >
      {handle("turn", view.ring, "none")}
      {handle("along", view.along.line, "both")}
      {handle("around", view.around.line, "both")}
      {handle("out", view.out.line, "end")}
      <circle
        cx={centre[0]}
        cy={centre[1]}
        r={5}
        fill="#FFFFFF"
        stroke="#3A63F0"
        strokeWidth={2}
      />
    </svg>
  );
}
