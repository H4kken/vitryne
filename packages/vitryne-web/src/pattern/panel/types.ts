// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OutlineNode, Vec2 } from "@/format/schema.gen";
import { type CutView, type P, type Transform } from "@/pattern/geometry";
import { type CutEdge } from "@/sewing/api";

/**
 * A cut, by its id (and its piece's): the one the properties and the 3D view show. `also`: other
 * cuts picked with it in the flat view (a box dragged round them, or Shift-clicks), moved with it.
 */
export type Selection = {
  kind: "cut";
  pieceId: string;
  cutId: string;
  also?: readonly string[];
} | null;

export type FlatTool = "select" | "points" | "draw" | "shape" | "marks" | "sew";

/** The marks tool's pick: a line, fold or grain line of one cut's piece. */
export type MarkPick = {
  kind: "line" | "fold" | "grain";
  pieceId: string;
  cutId: string;
  /** The line's or fold's id (the grain line has none). */
  id: string;
} | null;

/** The point tool's pick: an outline node, or the edge from it, on one cut of its piece. */
export type PointPick = {
  kind: "node" | "edge";
  pieceId: string;
  cutId: string;
  nodeId: string;
} | null;

/** The sew tool's edges and what the user has picked so far. */
export interface SewingState {
  edges: CutEdge[];
  /** The edges picked so far, both sides. */
  picked: CutEdge[];
  /** The free edge under the pointer, if any. */
  hovered: CutEdge | null;
  onHover: (edge: CutEdge | null) => void;
  /** A suggestion hovered in the seams list: the runs it would sew. */
  suggested:
    | readonly {
        cut: string;
        from: string;
        to: string;
        direction?: string;
        line?: string;
      }[]
    | null;
  /** `more`: Shift was held, so the side being picked continues with another edge. */
  onPick: (edge: CutEdge, more: boolean) => void;
}

/** What the zoom control can do to the view. */
export interface PatternView {
  zoom(factor: number): void;
  reset(): void;
  /** Where a new piece's bottom left goes so it sits right of the pieces there (mm). */
  freeSpot(): Vec2;
  /** The cuts with these ids as the view has them (layout and box), for flipping. */
  views(ids: readonly string[]): CutView[];
}

/** A point drag: a node to `to`, or a curve's handle; both from where the pointer went down. */
export interface PointDrag {
  cut: CutView;
  /** The outline as it was (the document's). */
  nodes: readonly OutlineNode[];
  /** Where the pointer went down (view) and where the dragged thing was (piece frame). */
  start: P;
  from: P;
  moved: boolean;
  to: P;
}

export type Drag =
  /** `hit`: what a click (no drag) picks; undefined: it picks nothing (Cmd held). */
  | {
      kind: "pan";
      x: number;
      y: number;
      moved: boolean;
      hit?: CutView | null;
    }
  | ({ kind: "node"; k: number } & PointDrag)
  | ({ kind: "control"; k: number; which: 0 | 1 } & PointDrag)
  /**
   * The select tool: cuts dragged together (the one under the pointer and the rest of the
   * selection). A click without a drag picks `hit` alone, or with Shift takes it out if it
   * was `picked` already.
   */
  | {
      kind: "move";
      cuts: CutView[];
      start: P;
      moved: boolean;
      hit: CutView;
      shift: boolean;
      picked: boolean;
    }
  /** The select tool: a box dragged out over the view; `add` keeps what was picked (Shift). */
  | { kind: "box"; from: P; x: number; y: number; moved: boolean; add: boolean }
  /** The shape tool: a shape dragged out from `from` (a click puts a default one there). */
  | { kind: "shape"; from: P; x: number; y: number; moved: boolean }
  /** The marks tool: a line's point being put down (piece frame), dragged for a curve. */
  | {
      kind: "line";
      cut: CutView;
      at: P;
      x: number;
      y: number;
      moved: boolean;
    }
  /** The marks tool: the grain line being dragged out (piece frame). */
  | { kind: "grain"; cut: CutView; from: P }
  /** The pen: a point being put down (`closing`: on the first one), dragged for a curve. */
  | {
      kind: "pen";
      at: P;
      closing: boolean;
      x: number;
      y: number;
      moved: boolean;
    }
  | {
      kind: "turn";
      cut: CutView;
      centre: P;
      local: P;
      from: number;
      t: Transform;
    };
