// SPDX-License-Identifier: AGPL-3.0-or-later
// Sewing (M8): the whole edges and each seam's length difference, asked of Rust whenever the
// pieces or seams change and something shows them; suggestions when the person asks; and the
// edges picked in the flat view for a seam being made (whole edges only, docs/PATENTS.md).

import { useCallback, useEffect, useState } from "react";
import { addSeam } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import {
  type CutEdge,
  parseDifferences,
  parseEdges,
  parseProposals,
  sameEdge,
  type SeamProposal,
} from "@/sewing/api";
import type { EngineSession } from "@/worker/session";

/** The edges picked for the seam being made: `open` is the side being picked. */
export interface Picks {
  a: CutEdge[];
  b: CutEdge[];
  open: "a" | "b";
}

export function useSewing(o: {
  session: EngineSession;
  store: DocumentStore;
  garment: Garment | undefined;
  /** Something shows the edges or the seams' differences. */
  shown: boolean;
  empty: boolean;
  showError: (what: string, e: Error) => void;
}) {
  const { session, store, garment, shown, empty, showError } = o;
  const [edges, setEdges] = useState<CutEdge[]>([]);
  const [differences, setDifferences] = useState<Record<string, number>>({});
  const [finding, setFinding] = useState(false);
  const sewingKey = garment ? `${garment.id}` : "";
  const seams = garment?.seams;
  const pieces = garment?.pieces;
  useEffect(() => {
    if (!shown || empty || !garment) return;
    let current = true;
    session.sewingEdges().then(
      (j) => current && setEdges(parseEdges(j)),
      () => current && setEdges([]),
    );
    session.seamDifferences().then(
      (j) => current && setDifferences(parseDifferences(j)),
      () => current && setDifferences({}),
    );
    return () => {
      current = false;
    };
    // `seams` and `pieces` change with edits to them; the rest of the garment doesn't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, shown, empty, sewingKey, seams, pieces]);
  // Suggestions and a half-made pick belong to the garment they were made for.
  const [proposalState, setProposalState] = useState<{
    key: string;
    list: SeamProposal[];
  } | null>(null);
  const [pickState, setPickState] = useState<{
    key: string;
    picks: Picks;
  } | null>(null);
  const proposals =
    proposalState?.key === sewingKey ? proposalState.list : null;
  const picks: Picks | null =
    pickState?.key === sewingKey ? pickState.picks : null;
  const setProposals = useCallback(
    (f: (l: SeamProposal[] | null) => SeamProposal[] | null) =>
      setProposalState((s) => {
        const list = f(s?.key === sewingKey ? s.list : null);
        return list ? { key: sewingKey, list } : null;
      }),
    [sewingKey],
  );
  const setPicks = useCallback(
    (p: Picks | null) => setPickState(p ? { key: sewingKey, picks: p } : null),
    [sewingKey],
  );

  const findSeams = useCallback(async () => {
    setFinding(true);
    try {
      const list = parseProposals(await session.suggestSeams());
      setProposals(() => list);
    } catch (e) {
      showError("Could not suggest seams", e as Error);
    } finally {
      setFinding(false);
    }
  }, [session, showError, setProposals]);

  const sew = useCallback(
    (p: {
      a: SeamProposal["a"];
      b: SeamProposal["b"];
      pairing?: SeamProposal["pairing"];
    }) => {
      if (!garment) return false;
      return store.execute((e) =>
        addSeam(e, garment.id, p, crypto.randomUUID()),
      );
    },
    [garment, store],
  );

  const acceptProposal = useCallback(
    (p: SeamProposal) => {
      // Edges taken, so the rest of the list is asked again.
      if (sew(p)) void findSeams();
    },
    [sew, findSeams],
  );

  /** Sews the picked sides (one or more whole edges each). */
  const completeSeam = useCallback(
    (p: Picks) => {
      const side = (list: CutEdge[]) =>
        JSON.stringify(
          list.length === 1
            ? { cut: list[0]?.cut, from: list[0]?.from, to: list[0]?.to }
            : list.map((x) => ({ cut: x.cut, from: x.from, to: x.to })),
        );
      session.joinEdges(side(p.a), side(p.b)).then(
        (j) => {
          const [made] = parseProposals(`[${j}]`);
          if (made) sew(made);
          setPicks(null);
        },
        (e: Error) => {
          setPicks(null);
          showError("Could not sew those edges", e);
        },
      );
    },
    [session, sew, showError, setPicks],
  );

  /**
   * A click on a whole edge adds it to the open side. A plain click ends that side (so two
   * clicks sew two edges); Shift keeps the side open for another edge, for a seam along
   * several edges.
   */
  const pickEdge = useCallback(
    (edge: CutEdge, more: boolean) => {
      const cur: Picks = picks ?? { a: [], b: [], open: "a" };
      const all = [...cur.a, ...cur.b];
      if (all.some((x) => sameEdge(x, edge))) {
        // Picking it again takes it back.
        const drop = (l: CutEdge[]) => l.filter((x) => !sameEdge(x, edge));
        const next = { ...cur, a: drop(cur.a), b: drop(cur.b) };
        setPicks(next.a.length || next.b.length ? next : null);
        return;
      }
      const next: Picks = { ...cur, [cur.open]: [...cur[cur.open], edge] };
      if (more) {
        setPicks(next);
        return;
      }
      if (next.open === "a") setPicks({ ...next, open: "b" });
      else completeSeam(next);
    },
    [picks, setPicks, completeSeam],
  );

  return {
    edges,
    differences,
    finding,
    proposals,
    picks,
    findSeams,
    acceptProposal,
    /** Takes a suggestion off the list. */
    skipProposal: (i: number) =>
      setProposals((list) => list?.filter((_, k) => k !== i) ?? null),
    pickEdge,
  };
}
