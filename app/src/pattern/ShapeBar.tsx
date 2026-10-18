// SPDX-License-Identifier: AGPL-3.0-or-later
// The shape tool's bar, over the flat view: the ready shapes to pick from, and how to put one
// down (drag out its size, or click for the starting one).

import { type ShapeKind, SHAPE_START } from "./draw";

const SHAPES: { kind: ShapeKind; label: string; glyph: React.ReactNode }[] = [
  {
    kind: "rectangle",
    label: "Rectangle",
    glyph: <rect x={5} y={3} width={18} height={22} rx={1} />,
  },
  {
    kind: "ellipse",
    label: "Ellipse",
    glyph: <ellipse cx={14} cy={14} rx={11} ry={11} />,
  },
  {
    kind: "tube",
    label: "Tube",
    glyph: <path d="M8 4 H20 L25 24 H3 Z" strokeLinejoin="round" />,
  },
];

const size = (k: ShapeKind) => {
  const s = SHAPE_START[k];
  return k === "tube"
    ? `${s.top} / ${s.width} × ${s.height} mm`
    : `${s.width} × ${s.height} mm`;
};

export function ShapeBar(props: {
  kind: ShapeKind;
  onKind: (k: ShapeKind) => void;
}) {
  return (
    // The bar's own pointer events don't reach the view (they would put a shape down).
    <div
      className="pointer-events-auto flex max-w-[calc(100vw-32px)] flex-col items-center gap-1.5"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        role="radiogroup"
        aria-label="Shape"
        className="flex items-center gap-1 rounded-[14px] border border-[#E1E4DE] bg-white p-1.5 shadow-[0_8px_24px_rgba(20,24,31,.12)]"
      >
        {SHAPES.map((s) => (
          <button
            key={s.kind}
            type="button"
            role="radio"
            aria-checked={props.kind === s.kind}
            title={`${s.label} (click: ${size(s.kind)})`}
            onClick={() => props.onKind(s.kind)}
            className={
              props.kind === s.kind
                ? "flex size-12 items-center justify-center rounded-[10px] bg-[#E9EBE6]"
                : "flex size-12 items-center justify-center rounded-[10px] hover:bg-[#F4F5F2]"
            }
          >
            <svg
              viewBox="0 0 28 28"
              className="size-7"
              fill="#14181F"
              stroke="#14181F"
              aria-hidden="true"
            >
              {s.glyph}
            </svg>
            <span className="sr-only">{s.label}</span>
          </button>
        ))}
      </div>
      <span className="rounded-lg bg-white/90 px-2 py-1 text-[13px] text-[#4A514B]">
        Drag to draw it · click for {size(props.kind)} · Shift: as wide as high
      </span>
    </div>
  );
}
