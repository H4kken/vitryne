// SPDX-License-Identifier: AGPL-3.0-or-later
// The Seams panel: which edges are sewn to which, suggestions to accept or skip, and picking two
// whole edges by hand. Plain words (the target is someone who has never drafted a pattern).
// Design rules from docs/PATENTS.md: whole edges only; two picks, no readout while picking; a
// length difference is shown only on a seam that exists, as a sentence.

import { Button } from '@/components/ui/button';
import { removeSeam, reverseSeam } from '@/document/commands';
import type { DocumentStore } from '@/document/store';
import type { Garment } from '@/format/schema.gen';
import { describeSide, differenceNote, type SeamProposal, sideTitle } from './api';

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted-foreground m-0 text-[13px] font-semibold tracking-[0.06em] uppercase">{children}</h3>;
}

export function SeamsPanel(props: {
  store: DocumentStore;
  garment: Garment | undefined;
  /** Length differences by seam id (Rust), for the seams that exist. */
  differences: Record<string, number>;
  /** Suggested seams, or null before the user asked. */
  proposals: SeamProposal[] | null;
  finding: boolean;
  onFind: () => void;
  onAccept: (p: SeamProposal) => void;
  onSkip: (index: number) => void;
  /** Whole-edge picking in the flat view. */
  picking: boolean;
  /** One edge is picked, and the second is awaited. */
  firstPicked: boolean;
  onStartPicking: () => void;
  onStopPicking: () => void;
}) {
  const { store, garment } = props;
  if (!garment) return <p className="text-muted-foreground m-0 text-sm">This project has no garment.</p>;
  const seams = garment.seams ?? [];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground m-0 text-sm leading-snug">
        A seam joins one edge of a piece to an edge of another. Sew whole edges, from corner to corner.
      </p>

      <div className="flex flex-col gap-3">
        <Heading>Suggestions</Heading>
        {props.proposals === null ? (
          <Button variant="outline" onClick={props.onFind} disabled={props.finding}>
            {props.finding ? 'Looking…' : 'Suggest seams'}
          </Button>
        ) : props.proposals.length === 0 ? (
          <p className="text-muted-foreground m-0 text-sm">Nothing left to suggest. Pick edges by hand below.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {props.proposals.map((p, i) => (
              <li key={i} className="rounded-xl border border-[#E1E4DE] p-3">
                <div className="text-[14px] leading-snug font-semibold">
                  {sideTitle(garment, p.a)} <span className="text-muted-foreground font-normal">with</span> {sideTitle(garment, p.b)}
                </div>
                <div className="text-muted-foreground mt-1 text-[12.5px] leading-snug">
                  {describeSide(garment, p.a)}
                  <br />
                  {describeSide(garment, p.b)}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => props.onAccept(p)}>
                    Sew
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => props.onSkip(i)}>
                    Skip
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {props.proposals !== null && (
          <Button variant="ghost" size="sm" onClick={props.onFind} disabled={props.finding}>
            Suggest again
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Heading>Pick two edges</Heading>
        {props.picking ? (
          <>
            <p className="m-0 text-sm leading-snug" role="status">
              {props.firstPicked ? 'Now pick the edge it is sewn to.' : 'Click an edge in the flat view, then the edge it is sewn to.'}
            </p>
            <Button variant="outline" onClick={props.onStopPicking}>
              Done
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={props.onStartPicking}>
            Pick edges in the flat view
          </Button>
        )}
      </div>

      {seams.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <Heading>Sewn ({seams.length})</Heading>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {seams.map((s, i) => {
              const note = differenceNote(props.differences[s.id]);
              return (
                <li key={s.id} className="rounded-xl border border-[#E1E4DE] p-3">
                  <div className="text-[14px] leading-snug font-semibold">{s.name ?? `Seam ${i + 1}`}</div>
                  <div className="text-muted-foreground mt-1 text-[12.5px] leading-snug">
                    {sideTitle(garment, s.a)} with {sideTitle(garment, s.b)}
                  </div>
                  {note && <div className="mt-1 text-[12.5px] leading-snug">{note}</div>}
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => store.execute((e) => reverseSeam(e, garment.id, s.id))}>
                      Flip direction
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => store.execute((e) => removeSeam(e, garment.id, s.id))}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
