// SPDX-License-Identifier: AGPL-3.0-or-later
// The sewing helpers (M8) against the T-shirt example and Rust's answers for it.
import { describe, expect, it } from 'vitest';
import { mainGarment } from '@/document/entities';
import { distToPolyline, runPoints } from '@/pattern/geometry';
import { openExample } from '@/test/rust';
import { type CutEdge, describeSide, differenceNote, parseDifferences, parseEdges, sameEdge } from './api';

describe('sewing helpers', () => {
  it('names a seam side and walks a run along the outline', () => {
    const { file, entities } = openExample('tshirt');
    const g = mainGarment(entities)!;
    const seam = g.seams![0]!;
    // Plain words: the cut and its corners, by name.
    expect(describeSide(g, seam.a)).toMatch(/front: underarm, right to hem, right side/i);
    // The run's points start and end on its corners.
    const piece = g.pieces.find((p) => p.cuts.some((c) => c.id === seam.a[0]!.cut))!;
    const r = seam.a[0]!;
    const pts = runPoints(piece, r.from, r.to, r.direction !== 'cw');
    const pos = (id: string) => piece.outline.find((n) => n.id === id)!.position;
    expect(pts[0]).toEqual(pos(r.from));
    expect(pts.at(-1)).toEqual(pos(r.to));
    expect(distToPolyline(pos(r.from), pts)).toBe(0);
    file.free();
  });

  it('knows which edges are sewn, and each seam\'s difference', () => {
    const { file, entities } = openExample('tshirt');
    const g = mainGarment(entities)!;
    const edges = parseEdges(file.sewing_edges());
    const run = g.seams![0]!.a[0]!;
    const sewn = edges.find((e) => sameEdge(e, run));
    expect(sewn?.sewn).toBe(true);
    const diffs = parseDifferences(file.seam_differences());
    expect(Object.keys(diffs)).toHaveLength(g.seams!.length);
    for (const v of Object.values(diffs)) expect(Math.abs(v)).toBeLessThan(25);
    file.free();
  });

  it('says the difference in a sentence, not a colour', () => {
    expect(differenceNote(0.2)).toBe('The two sides are the same length.');
    expect(differenceNote(8)).toBe('Side two is 8.0% longer than side one.');
    expect(differenceNote(-12.4)).toBe('Side two is 12% shorter than side one.');
    expect(differenceNote(undefined)).toBeNull();
    const e: CutEdge = { cut: 'c', from: 'a', to: 'b', length: 1, sewn: false };
    expect(sameEdge(e, { cut: 'c', from: 'b', to: 'a' })).toBe(true);
  });
});
