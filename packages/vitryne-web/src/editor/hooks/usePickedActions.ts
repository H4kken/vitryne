// SPDX-License-Identifier: AGPL-3.0-or-later
// What can be done with the picked pieces, for the Delete key and the right-click menus: take them
// out, or move the picked one a step outwards or inwards in the stack. One edit each.

import { findCut, moveInStack, removeCuts } from "@/document/commands";
import type { DocumentStore } from "@/document/store";
import type { Garment } from "@/format/schema.gen";
import type { Selection } from "@/pattern/panel/types";
import { moves, stackRoots, stepPlace } from "@/placement/stackOrder";

export function usePickedActions(o: {
  store: DocumentStore;
  garment: Garment | undefined;
  selection: Selection;
  showInfo: (text: string) => void;
  /** The picked pieces were taken out. */
  onRemoved: () => void;
}) {
  const { store, garment: g, selection, showInfo, onRemoved } = o;
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
  return { remove, canStep, step };
}

export type PickedActions = ReturnType<typeof usePickedActions>;
