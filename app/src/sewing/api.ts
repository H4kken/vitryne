// SPDX-License-Identifier: AGPL-3.0-or-later
// What Rust's sewing calls return (crates/drape-assets/src/seams.rs), and plain-language labels
// for them. Whole edges only (docs/PATENTS.md, rule 1): an edge is the outline between two of
// a cut's corners, named by those corners.

import type { Garment, Seam } from '@/format/schema.gen';

type Run = Seam['a'][number];

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
  pairing?: 'nodes' | 'length';
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

export function sameEdge(x: CutEdge, y: { cut: string; from: string; to: string }): boolean {
  return x.cut === y.cut && ((x.from === y.from && x.to === y.to) || (x.from === y.to && x.to === y.from));
}

function nodeName(g: Garment, cutId: string, nodeId: string): string {
  for (const p of g.pieces) {
    if (!p.cuts.some((c) => c.id === cutId)) continue;
    const n = p.outline.find((x) => x.id === nodeId);
    return n?.name ?? 'a corner';
  }
  return 'a corner';
}

function cutLabel(g: Garment, cutId: string): string {
  for (const p of g.pieces) {
    const c = p.cuts.find((x) => x.id === cutId);
    if (c) return c.name ?? p.name;
  }
  return 'a piece';
}

/** "Front, from hem, left side to underarm, left", or "Right sleeve + Front" for a chain. */
export function describeSide(g: Garment, runs: readonly Run[]): string {
  return runs
    .map((r) => `${cutLabel(g, r.cut)}: ${nodeName(g, r.cut, r.from)} to ${nodeName(g, r.cut, r.to)}`)
    .join(', then ');
}

/** The short form for a list: the pieces a side runs along. */
export function sideTitle(g: Garment, runs: readonly Run[]): string {
  return [...new Set(runs.map((r) => cutLabel(g, r.cut)))].join(' + ');
}

/** A seam's length difference as a plain sentence, once the seam exists (passive, no colour). */
export function differenceNote(percent: number | undefined): string | null {
  if (percent === undefined || !Number.isFinite(percent)) return null;
  const p = Math.abs(percent);
  if (p < 0.5) return 'The two sides are the same length.';
  return `Side two is ${p.toFixed(p < 10 ? 1 : 0)}% ${percent > 0 ? 'longer' : 'shorter'} than side one.`;
}
