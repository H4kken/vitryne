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
  const [place, setPlace] = useState("one:body-front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const add = async () => {
    if (!outline) return;
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
                  className="h-10 rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white px-2.5 text-[15px]"
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
              value={place}
              options={{ one: true, pairs: true, on: [], leave: false }}
              onChange={setPlace}
            />
            <span className="text-muted-foreground text-[13px]">
              {place.startsWith("pair:")
                ? "Cut 2 (a pair): the second copy is the mirror image."
                : "Cut once."}
            </span>
          </div>

          {error && (
            <p
              role="alert"
              className="m-0 rounded-2xl border border-[#F0C9BE] bg-white px-4 py-3 text-[14px] text-[#8A2410]"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Discard
          </Button>
          <Button onClick={() => void add()} disabled={!outline || busy}>
            {busy ? "Adding…" : "Add piece"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
