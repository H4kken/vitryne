// SPDX-License-Identifier: AGPL-3.0-or-later
// Placing a cut and adding a piece: Rust works out the wrap (where the person chose), and the
// document takes it as one edit.

import { type RefObject, useCallback } from "react";
import {
  addPiece,
  type Bounds,
  findCut,
  setPlacement,
} from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment, Placement, Vec2 } from "@/format/schema.gen";

import { newPiece } from "@/pattern/draw";
import { PAIRS, type Pair, type Place } from "@/placement/places";
import type { EngineSession } from "@/worker/session";
import type { NewPiece } from "../dialogs/NewPieceDialog";
import type { PatternView } from "@/pattern/panel/types";

export function usePieceActions(o: {
  session: EngineSession;
  store: DocumentStore;
  garment: Garment | undefined;
  /** The flat view, for a free spot to draw a new piece. */
  pattern: RefObject<PatternView | null>;
  showError: (what: string, e: Error) => void;
  /** A piece was added: its first cut. */
  onAdded: (pieceId: string, cutId: string) => void;
}) {
  const { session, store, garment, pattern, showError, onAdded } = o;
  /** A cut wrapped at another place of the body. */
  const rewrap = useCallback(
    (cutId: string, place: Place) => {
      const g = garment;
      if (!g) return;
      session.rewrap(cutId, place).then(
        (json) => {
          const r = JSON.parse(json) as {
            placement: Omit<Placement, "type">;
            bounds: Bounds | null;
          };
          // How far out the person pushed it past the layers is theirs, and stays.
          const old = findCut(g, cutId)?.cut.placement;
          const offset = old?.type === "wrap" ? old.offset : undefined;
          store.execute((e) =>
            setPlacement(
              e,
              g.id,
              cutId,
              {
                type: "wrap",
                ...r.placement,
                ...(offset ? { offset } : {}),
              },
              r.bounds ?? undefined,
            ),
          );
        },
        (e: Error) => showError("Could not move the piece", e),
      );
    },
    [garment, session, store, showError],
  );

  /** A drawn piece or a ready shape added: wrapped where the person chose (Rust), one edit. */
  const addNewPiece = async (n: NewPiece, origin?: Vec2) => {
    const g = garment;
    if (!g) return;
    const places: string[] = n.place.startsWith("pair:")
      ? [...PAIRS[n.place.slice(5) as Pair].places]
      : [n.place.slice(4)];
    const uuid = () => crypto.randomUUID();
    const piece = newPiece({
      id: uuid(),
      name: n.name,
      outline: n.outline,
      cutIds: places.map(uuid),
      origin: origin ?? pattern.current?.freeSpot() ?? [0, 0],
    });
    const r = JSON.parse(
      await session.placePiece(JSON.stringify(piece), places),
    ) as { placements: Omit<Placement, "type">[]; bounds: Bounds | null };
    const placed = {
      ...piece,
      cuts: piece.cuts.map((c, k) => ({
        ...c,
        placement: { type: "wrap", ...r.placements[k] } as Placement,
      })) as typeof piece.cuts,
    };
    if (!store.execute((e) => addPiece(e, g.id, placed, r.bounds ?? undefined)))
      throw new Error(store.state.refused ?? "the piece could not be added");
    onAdded(placed.id, placed.cuts[0].id);
  };

  return { rewrap, addNewPiece };
}
