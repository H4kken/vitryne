// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Garment } from "@/format/schema.gen";
import {
  type CutView,
  outlinePoints,
  pathData,
  runPoints,
  type Transform,
} from "../geometry";
import { sameEdge } from "@/sewing/api";
import type { FlatTool, SewingState } from "./types";
import { LABEL_GAP_MM, SEAM_COLOURS, NODE_PX } from "./constants";
import { PieceDrawing } from "./PieceDrawing";
import { MarkMarks } from "./MarkMarks";
import { PointMarks } from "./PointMarks";
import type { usePointTool } from "./usePointTool";
import type { useMarksTool } from "./useMarksTool";
import { cutLabel } from "./cutLabel";

/** The SVG transform for a cut's frame (SVG's y points down, so turns are clockwise there). */
function svgTransform(t: Transform, mirrored: boolean): string {
  return `translate(${t.x} ${-t.y}) rotate(${(-t.rot * 180) / Math.PI}) scale(${mirrored ? -1 : 1} 1)`;
}

/**
 * One cut in the flat view, in its frame: the piece, its seams in a colour each, the sew tool's
 * free edges, the marks or point tool's marks, and its name below it.
 */
export function CutGroup(props: {
  v: CutView;
  garment: Garment | undefined;
  tool: FlatTool;
  inGroup: ReadonlySet<string>;
  highlight: string | null;
  highlightSeam: string | null;
  cutColors: ReadonlyMap<string, string> | undefined;
  /** An outline being dragged, and why it can't be kept. */
  shape: { pieceId: string; problem: string | null } | null;
  sewing: SewingState | undefined;
  marking: boolean;
  marks: ReturnType<typeof useMarksTool>;
  points: boolean;
  picked: ReturnType<typeof usePointTool>["picked"];
  handles: ReturnType<typeof usePointTool>["handles"];
  mmPerPx: number;
}) {
  const {
    v,
    garment,
    tool,
    inGroup,
    highlight,
    highlightSeam,
    cutColors,
    shape,
    sewing,
    marking,
    points,
    picked,
    handles,
    mmPerPx,
  } = props;
  const { markKind, lineDraft, foldFrom, grainLive, markPicked, lineProblem } =
    props.marks;
  const on = inGroup.has(v.cut.id);
  const lit = highlight === v.cut.id;
  // Another copy of the picked piece: a faint dashed box, so the link shows in the flat view.
  const linked =
    !on &&
    v.piece.cuts.length > 1 &&
    v.piece.cuts.some((c) => inGroup.has(c.id));
  return (
    <g
      key={v.cut.id}
      opacity={
        highlight && !lit
          ? 0.3
          : // The mirror image of a piece cut more than once: a touch softer, as a hint.
            v.cut.mirrored && v.piece.cuts.length > 1 && !on
            ? 0.9
            : undefined
      }
      className="transition-opacity duration-150"
    >
      <g transform={svgTransform(v.t, !!v.cut.mirrored)}>
        <PieceDrawing
          piece={v.piece}
          color={cutColors?.get(v.cut.id)}
          bad={!!shape?.problem && shape.pieceId === v.piece.id}
          marked={markPicked?.cutId === v.cut.id ? markPicked : null}
        />
        {on && (
          <path
            d={pathData(outlinePoints(v.piece), true)}
            fill="var(--select)"
            fillOpacity={0.07}
            stroke="none"
            className="pointer-events-none"
          />
        )}
        {lit && (
          <path
            d={pathData(outlinePoints(v.piece), true)}
            fill="none"
            stroke="var(--select)"
            strokeWidth={5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="pointer-events-none"
          />
        )}
        {/* Seams, one colour each, on the edges they sew. */}
        {(garment?.seams ?? []).flatMap((seam, i) =>
          [...seam.a, ...seam.b]
            .filter((r) => r.cut === v.cut.id && !r.line)
            .map((r, k) => {
              const lit = highlightSeam === seam.id;
              return (
                <path
                  key={`${seam.id}:${k}`}
                  d={pathData(
                    runPoints(v.piece, r.from, r.to, r.direction !== "cw"),
                    false,
                  )}
                  fill="none"
                  stroke={SEAM_COLOURS[i % SEAM_COLOURS.length]}
                  strokeWidth={lit ? 9 : 5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={lit ? 1 : highlightSeam ? 0.2 : 0.85}
                  vectorEffect="non-scaling-stroke"
                  className="transition-opacity duration-150"
                />
              );
            }),
        )}
        {/* The sew tool: free edges to pick, and the first pick. */}
        {tool === "sew" &&
          sewing?.edges
            .filter((e) => e.cut === v.cut.id && !e.sewn)
            .map((e) => {
              const on = sewing.picked.some((x) => sameEdge(x, e));
              const hot = !!sewing.hovered && sameEdge(sewing.hovered, e);
              return (
                <path
                  key={`${e.from}:${e.to}`}
                  d={pathData(runPoints(v.piece, e.from, e.to, true), false)}
                  fill="none"
                  stroke="var(--select)"
                  strokeWidth={on || hot ? 7 : 4}
                  strokeDasharray={on || hot ? undefined : "2 7"}
                  strokeLinecap="round"
                  opacity={on || hot ? 1 : 0.55}
                  vectorEffect="non-scaling-stroke"
                  className="transition-[stroke-width,opacity] duration-150"
                />
              );
            })}
        {/* A suggestion hovered in the seams list: the edges it would sew. */}
        {sewing?.suggested
          ?.filter((r) => r.cut === v.cut.id && !r.line)
          .map((r, k) => (
            <path
              key={`suggested:${k}`}
              d={pathData(
                runPoints(v.piece, r.from, r.to, r.direction !== "cw"),
                false,
              )}
              fill="none"
              stroke="var(--select)"
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="pointer-events-none animate-in fade-in duration-200"
            />
          ))}
        {marking && (
          <MarkMarks
            v={v}
            kind={markKind}
            line={lineDraft?.cutId === v.cut.id ? lineDraft : null}
            fold={foldFrom?.cutId === v.cut.id ? foldFrom : null}
            grain={grainLive?.cutId === v.cut.id ? grainLive : null}
            bad={
              lineDraft?.cutId === v.cut.id &&
              !!lineProblem(v, [
                ...lineDraft.points,
                ...(lineDraft.cursor
                  ? [
                      {
                        at: lineDraft.cursor,
                        ...(lineDraft.handle ? { out: lineDraft.handle } : {}),
                      },
                    ]
                  : []),
              ])
            }
            r={NODE_PX * mmPerPx}
          />
        )}
        {points && (
          <PointMarks
            piece={v.piece}
            pick={picked?.v.cut.id === v.cut.id ? picked : null}
            handles={picked?.v.cut.id === v.cut.id ? handles : []}
            r={NODE_PX * mmPerPx}
          />
        )}
      </g>
      {linked && (
        <rect
          x={v.box.minX - 12}
          y={-v.box.maxY - 12}
          width={v.box.maxX - v.box.minX + 24}
          height={v.box.maxY - v.box.minY + 24}
          fill="none"
          stroke="var(--select)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          strokeOpacity={0.45}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      <text
        x={(v.box.minX + v.box.maxX) / 2}
        y={-v.box.minY + LABEL_GAP_MM}
        textAnchor="middle"
        fill={on ? "var(--foreground)" : "var(--muted-foreground)"}
        fontWeight={on ? 600 : 400}
        className="pointer-events-none font-sans text-[22px] select-none"
      >
        {cutLabel(v)}
      </text>
    </g>
  );
}
