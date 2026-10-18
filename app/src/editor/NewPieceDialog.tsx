// SPDX-License-Identifier: AGPL-3.0-or-later
// A new piece: a ready shape with typed sizes (rectangle, ellipse, tube), or the outline the
// pen just drew; its name; and where it goes on the body, one copy or a pair (the second
// mirrored), with the import dialog's places. Rust wraps it there (`place_piece`); the editor
// adds it as one edit.

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
import { cn } from "@/lib/utils";
import {
  type ShapeKind,
  type ShapeSize,
  shapeOutline,
  shapeProblem,
} from "@/pattern/draw";
import { bounds, nodesPoints, type P, pathData } from "@/pattern/geometry";
import { PlaceSelect } from "@/placement/PlaceSelect";

const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "rectangle", label: "Rectangle" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "tube", label: "Tube" },
];

/** Each shape's sizes to start from, mm. */
const START: Record<ShapeKind, ShapeSize> = {
  rectangle: { width: 500, height: 700 },
  ellipse: { width: 300, height: 300 },
  tube: { width: 600, top: 400, height: 600 },
};

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

function SizeField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-[13px] font-semibold">
        {props.label}
      </label>
      <div className="flex items-center gap-1.5 text-[13px] text-[#4A514B]">
        <input
          id={props.id}
          inputMode="decimal"
          className="h-10 w-24 rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white px-2.5 text-right text-[15px] text-[#14181F] tabular-nums"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
        mm
      </div>
    </div>
  );
}

export function NewPieceDialog(props: {
  /** Open with the pen's outline, or with none: pick a ready shape. Null: closed. */
  open: { outline: OutlineNode[] | null } | null;
  defaultName: string;
  onClose: () => void;
  onAdd: (p: NewPiece) => Promise<void>;
}) {
  const drawn = props.open?.outline ?? null;
  const [kind, setKind] = useState<ShapeKind>("rectangle");
  const [sizes, setSizes] = useState<Record<ShapeKind, Record<string, string>>>(
    () =>
      Object.fromEntries(
        Object.entries(START).map(([k, s]) => [
          k,
          Object.fromEntries(Object.entries(s).map(([f, v]) => [f, String(v)])),
        ]),
      ) as Record<ShapeKind, Record<string, string>>,
  );
  const [name, setName] = useState(props.defaultName);
  const [place, setPlace] = useState("one:body-front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const typed = sizes[kind];
  const num = (f: string) => Number((typed[f] ?? "").replace(",", "."));
  const size: ShapeSize = {
    width: num("width"),
    height: num("height"),
    ...(kind === "tube" ? { top: num("top") } : {}),
  };
  const problem = drawn ? null : shapeProblem(kind, size);
  const outline =
    drawn ??
    (problem ? null : shapeOutline(kind, size, () => crypto.randomUUID()));
  const set = (f: string) => (v: string) =>
    setSizes((s) => ({ ...s, [kind]: { ...s[kind], [f]: v } }));

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
            {drawn ? "Add the piece" : "Add a shape"}
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {drawn
              ? "Name it and choose where it goes on the body; you can move it afterwards."
              : "Pick a shape and type its sizes, then choose where it goes on the body."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex min-h-0 grow flex-col gap-5 overflow-y-auto px-6">
          {!drawn && (
            <div
              role="group"
              aria-label="Shape"
              className="flex gap-1 rounded-xl bg-[#F4F5F2] p-1"
            >
              {SHAPES.map((s) => (
                <button
                  key={s.kind}
                  type="button"
                  aria-pressed={kind === s.kind}
                  onClick={() => setKind(s.kind)}
                  className={cn(
                    "h-10 flex-1 rounded-[9px] px-3 text-[15px] font-semibold",
                    kind === s.kind &&
                      "bg-white shadow-[0_1px_3px_rgba(20,24,31,.15)]",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-start gap-4">
            <Thumb outline={outline} />
            <div className="flex grow flex-col gap-3">
              {!drawn && (
                <div className="flex flex-wrap gap-3">
                  {kind === "tube" ? (
                    <>
                      <SizeField
                        id={`${ids}-top`}
                        label="Top width"
                        value={typed.top ?? ""}
                        onChange={set("top")}
                      />
                      <SizeField
                        id={`${ids}-width`}
                        label="Bottom width"
                        value={typed.width ?? ""}
                        onChange={set("width")}
                      />
                      <SizeField
                        id={`${ids}-height`}
                        label="Length"
                        value={typed.height ?? ""}
                        onChange={set("height")}
                      />
                    </>
                  ) : (
                    <>
                      <SizeField
                        id={`${ids}-width`}
                        label="Width"
                        value={typed.width ?? ""}
                        onChange={set("width")}
                      />
                      <SizeField
                        id={`${ids}-height`}
                        label="Height"
                        value={typed.height ?? ""}
                        onChange={set("height")}
                      />
                    </>
                  )}
                </div>
              )}
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

          {(problem || error) && (
            <p
              role="alert"
              className="m-0 rounded-2xl border border-[#F0C9BE] bg-white px-4 py-3 text-[14px] text-[#8A2410]"
            >
              {problem ? `Can't make this shape: ${problem}` : error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            {drawn ? "Discard" : "Cancel"}
          </Button>
          <Button onClick={() => void add()} disabled={!outline || busy}>
            {busy ? "Adding…" : "Add piece"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
