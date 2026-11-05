// SPDX-License-Identifier: AGPL-3.0-or-later
// A new piece the pen just drew: its name, and where it goes on the body, one copy or a pair
// (the second mirrored), with the import dialog's places. Rust wraps it there (`place_piece`);
// the editor adds it as one edit. Ready shapes skip this: the shape bar puts them down.

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OutlineNode } from "@/format/schema.gen";
import { PlaceSelect } from "@/placement/PlaceSelect";
import { type Place, pairOf } from "@/placement/places";
import { Switch } from "@/components/ui/switch";
import { PieceThumb } from "./PieceThumb";

/** What the person chose: the outline (own frame), its name, and where (a PlaceSelect value). */
export interface NewPiece {
  outline: OutlineNode[];
  name: string;
  place: string;
}

export function NewPieceDialog(props: {
  /** Open with the pen's outline. Null: closed. */
  open: { outline: OutlineNode[] } | null;
  defaultName: string;
  onClose: () => void;
  onAdd: (p: NewPiece) => Promise<void>;
}) {
  const outline = props.open?.outline ?? null;
  const [name, setName] = useState(props.defaultName);
  // One place on the body, and whether the piece is cut as a symmetric pair (a second copy,
  // the mirror image, on the other side). A pair is on by default where a place has one (an
  // arm, a leg, a side); a front or a back is cut once.
  const [where, setWhere] = useState<Place>("body-front");
  const [pairOn, setPairOn] = useState(false);
  const pair = pairOf(where);
  const place = pairOn && pair ? `pair:${pair}` : `one:${where}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const add = async () => {
    if (!outline || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onAdd({
        outline,
        name: name.trim() || props.defaultName,
        place,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.open}
      onOpenChange={(open) => !open && !busy && props.onClose()}
    >
      <DialogContent className="flex max-h-[calc(100vh-32px)] flex-col gap-5 rounded-[20px] p-6 sm:max-w-[560px]">
        {/* A form so Enter in the name adds the piece; `contents` keeps the dialog's layout. */}
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              Add the piece
            </DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              Name it and choose where it goes on the body; you can move it
              afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6">
            <div className="flex items-start gap-4">
              <PieceThumb outline={outline} />
              <div className="flex grow flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`${ids}-name`}
                    className="text-[13px] font-semibold"
                  >
                    Name
                  </label>
                  <input
                    id={`${ids}-name`}
                    className="h-10 rounded-[10px] border-[1.5px] border-border-strong bg-card px-2.5 text-[15px]"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${ids}-place`}
                className="text-[13px] font-semibold"
              >
                Where it goes
              </label>
              <PlaceSelect
                id={`${ids}-place`}
                value={`one:${where}`}
                options={{ one: true, pairs: false, on: [], leave: false }}
                onChange={(v) => {
                  const next = v.slice(4) as Place;
                  setWhere(next);
                  // Coming from a place with no pair to one with: a pair is the usual wish.
                  if (!pair && pairOf(next)) setPairOn(true);
                }}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label
                  htmlFor={`${ids}-pair`}
                  className="text-[13px] font-semibold"
                >
                  Symmetric pair (left and right)
                </label>
                <span className="text-muted-foreground text-[13px]">
                  {pair && pairOn
                    ? "Cut twice, the second the mirror image. Changing one changes both."
                    : pair
                      ? "Cut once. Turn on for a mirror-image copy that follows every change."
                      : "This place has no other side: cut once."}
                </span>
              </div>
              <Switch
                id={`${ids}-pair`}
                checked={!!pair && pairOn}
                disabled={!pair}
                onCheckedChange={setPairOn}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="m-0 rounded-2xl border border-danger/30 bg-card px-4 py-3 text-[14px] text-danger"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={props.onClose}
              disabled={busy}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!outline || busy}>
              {busy ? "Adding…" : "Add piece"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
