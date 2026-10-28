// SPDX-License-Identifier: AGPL-3.0-or-later
// What can be done with the picked pieces, for the Delete key and the right-click menus: take them
// out, or move the picked one a step outwards or inwards in the stack. One edit each.

import { type RefObject, useState } from "react";
import {
  findCut,
  flipCuts,
  moveInStack,
  removeCuts,
} from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Cut, Garment, Piece } from "@/format/schema.gen";
import type { Selection } from "@/pattern/panel/types";
import { flipLayouts, type FlipAxis } from "@/pattern/flip";
import type { PatternView } from "@/pattern/panel/types";
import { moves, stackRoots, stepPlace } from "@/placement/stackOrder";

/** What Copy took: each picked piece with the cut that was picked. */
export type Copied = { piece: Piece; cut: Cut }[];

export function usePickedActions(o: {
  store: DocumentStore;
  garment: Garment | undefined;
  selection: Selection;
  showInfo: (text: string) => void;
  /** The flat view, which knows where the cuts are. */
  pattern: RefObject<PatternView | null>;
  /** Pastes what was copied. */
  onPaste: (copied: Copied) => void;
  /** The picked pieces were taken out. */
  onRemoved: () => void;
}) {
  const {
    store,
    garment: g,
    selection,
    showInfo,
    onRemoved,
    onPaste,
    pattern,
  } = o;
  /** Kept for the whole editor session, so it can be pasted into another project too. */
  const [copied, setCopied] = useState<Copied>([]);
  /** The picked pieces, each once, with the first cut picked of it. */
  const picked = (): Copied => {
    if (!g || !selection) return [];
    const seen = new Set<string>();
    const found: Copied = [];
    for (const id of [selection.cutId, ...(selection.also ?? [])]) {
      const f = findCut(g, id);
      if (f && !seen.has(f.piece.id)) {
        seen.add(f.piece.id);
        found.push({ piece: f.piece, cut: f.cut });
      }
    }
    return found;
  };
  /** Takes the picked pieces; false if none. */
  const copy = (): boolean => {
    const found = picked();
    if (!found.length) return false;
    setCopied(found);
    showInfo(
      found.length === 1
        ? "Copied the piece."
        : `Copied ${found.length} pieces.`,
    );
    return true;
  };
  /** Pastes the picked pieces at once, leaving what was copied alone. */
  const duplicate = (): boolean => {
    const found = picked();
    if (!found.length) return false;
    onPaste(found);
    return true;
  };
  const paste = (): boolean => {
    if (!g || !copied.length) return false;
    onPaste(copied);
    return true;
  };
  /** Takes the picked pieces out; false if there are none. */
  const remove = (): boolean => {
    if (!g || !selection) return false;
    const ids = [selection.cutId, ...(selection.also ?? [])].filter(
      (id) => !!findCut(g, id),
    );
    let note: string | undefined;
    const done = store.execute((x) => {
      const cmd = removeCuts(x, g.id, ids);
      note = cmd.note;
      return cmd;
    });
    if (done) {
      onRemoved();
      if (note) showInfo(`${note}.`);
    }
    return true;
  };
  /** Flips the picked cuts about the middle of them, in the flat view; false if there are none. */
  const flip = (axis: FlipAxis): boolean => {
    if (!g || !selection) return false;
    const ids = [selection.cutId, ...(selection.also ?? [])].filter(
      (id) => !!findCut(g, id),
    );
    const views = pattern.current?.views(ids) ?? [];
    if (!views.length) return false;
    store.execute((e) => flipCuts(e, g.id, flipLayouts(views, axis)));
    return true;
  };
  /** Only a lone pick in the stack's roots moves (a piece placed on another goes with it). */
  const lone = !!g && !!selection && !selection.also?.length;
  const id = selection?.cutId;
  const canStep = (dir: 1 | -1) =>
    !!g &&
    lone &&
    !!id &&
    stackRoots(g).includes(id) &&
    moves(g, id, stepPlace(g, id, dir));
  const step = (dir: 1 | -1) => {
    if (!g || !id || !canStep(dir)) return;
    const to = stepPlace(g, id, dir);
    if (to !== null) store.execute((e) => moveInStack(e, g.id, id, to));
  };
  return {
    remove,
    canStep,
    step,
    copy,
    paste,
    duplicate,
    flip,
    canPaste: copied.length > 0,
  };
}

export type PickedActions = ReturnType<typeof usePickedActions>;
