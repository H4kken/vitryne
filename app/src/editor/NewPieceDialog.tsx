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
import { bounds, nodesPoints, type P, pathData } from "@/pattern/geometry";
import { PlaceSelect } from "@/placement/PlaceSelect";

/** What the person chose: the outline (own frame), its name, and where (a PlaceSelect value). */
export interface NewPiece {
  outline: OutlineNode[];
  name: string;
  place: string;
}

function Thumb({ outline }: { outline: readonly OutlineNode[] | null }) {
  const pts = outline ? nodesPoints(outline) : [];
  const b = pts.length ? bounds(pts) : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 || 1;
  return (
    <svg
      width={120}
      height={120}
      viewBox={`${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      className="shrink-0 rounded-xl bg-[#F4F5F2]"
      aria-hidden="true"
    >
      {pts.length > 0 && (
        <path
          d={pathData(pts as P[], true)}
          fill="#FFFFFF"
          stroke="#14181F"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
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
            <Thumb outline={outline} />
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
