// SPDX-License-Identifier: AGPL-3.0-or-later
// What Rust's sewing calls return (packages/vitryne-engine/pattern/src/seams.rs), and plain-language labels
// for them. Whole edges only (docs/PATENTS.md, rule 1): an edge is the outline between two of
// a cut's corners, named by those corners.

import type { Garment, Seam } from "@/format/schema.gen";
import { bounds, outlinePoints, runPoints } from "@/pattern/geometry";

type Run = Seam["a"][number];

/** One whole edge of one cut, from corner `from` to corner `to` (counter-clockwise). */
export interface CutEdge {
  cut: string;
  from: string;
  to: string;
  /** mm. */
  length: number;
  sewn: boolean;
}

/** A seam Rust proposes (or two picked edges make), not yet in the file. */
export interface SeamProposal {
  a: Run[];
  b: Run[];
  pairing?: "nodes" | "length";
  score: number;
  length_ratio: number;
  difference_percent: number;
}

export function parseEdges(json: string): CutEdge[] {
  return JSON.parse(json) as CutEdge[];
}

export function parseProposals(json: string): SeamProposal[] {
  return JSON.parse(json) as SeamProposal[];
}

export function parseDifferences(json: string): Record<string, number> {
  return JSON.parse(json) as Record<string, number>;
}

export function sameEdge(
  x: CutEdge,
  y: { cut: string; from: string; to: string },
): boolean {
  return (
    x.cut === y.cut &&
    ((x.from === y.from && x.to === y.to) ||
      (x.from === y.to && x.to === y.from))
  );
}

function nodeName(g: Garment, cutId: string, nodeId: string): string {
  for (const p of g.pieces) {
    if (!p.cuts.some((c) => c.id === cutId)) continue;
    const n = p.outline.find((x) => x.id === nodeId);
    return n?.name ?? "a corner";
  }
  return "a corner";
}

/**
 * Where an outline run sits in its piece as the flat view draws it (a mirrored cut mirrored):
 * "the left side", "the top", ...; null near the middle, or for a line. For pieces whose
 * corners have no names (drawn ones). Within one piece only (docs/PATENTS.md, rule 5).
 */
function runPlace(g: Garment, r: Run): string | null {
  if (r.line !== undefined) return null;
  for (const p of g.pieces) {
    const cut = p.cuts.find((c) => c.id === r.cut);
    if (!cut) continue;
    const run = runPoints(p, r.from, r.to, r.direction !== "cw");
    if (!run.length) return null;
    const box = bounds(outlinePoints(p));
    const mean = (k: 0 | 1) => run.reduce((a, q) => a + q[k], 0) / run.length;
    let u = (2 * (mean(0) - box.minX)) / (box.maxX - box.minX || 1) - 1;
    const v = (2 * (mean(1) - box.minY)) / (box.maxY - box.minY || 1) - 1;
    if (cut.mirrored) u = -u;
    if (Math.max(Math.abs(u), Math.abs(v)) < 0.35) return null;
    if (Math.abs(u) >= Math.abs(v))
      return u < 0 ? "the left side" : "the right side";
    return v < 0 ? "the bottom" : "the top";
  }
  return null;
}

function cutLabel(g: Garment, cutId: string): string {
  for (const p of g.pieces) {
    const c = p.cuts.find((x) => x.id === cutId);
    if (c) return c.name ?? p.name;
  }
  return "a piece";
}

/** "Front, from hem, left side to underarm, left", or "Right sleeve + Front" for a chain. */
export function describeSide(g: Garment, runs: readonly Run[]): string {
  return runs
    .map((r) => {
      const [from, to] = [nodeName(g, r.cut, r.from), nodeName(g, r.cut, r.to)];
      // Unnamed corners (a drawn piece): where the edge is says more.
      const place =
        from === "a corner" && to === "a corner" ? runPlace(g, r) : null;
      return `${cutLabel(g, r.cut)}: ${place ?? `${from} to ${to}`}`;
    })
    .join(", then ");
}

/** The short form for a list: the pieces a side runs along. */
export function sideTitle(g: Garment, runs: readonly Run[]): string {
  return [...new Set(runs.map((r) => cutLabel(g, r.cut)))].join(" + ");
}

/** A seam's length difference as a plain sentence, once the seam exists (passive, no colour). */
export function differenceNote(percent: number | undefined): string | null {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  const p = Math.abs(percent);
  if (p < 0.5) return "The two sides are the same length.";
  return `Side two is ${p.toFixed(p < 10 ? 1 : 0)}% ${percent > 0 ? "longer" : "shorter"} than side one.`;
}
