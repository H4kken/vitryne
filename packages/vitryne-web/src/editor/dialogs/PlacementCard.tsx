// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlaceSelect } from "@/placement/PlaceSelect";
import { choiceLabel } from "./bodyZones";
import { ImportThumb } from "./ImportThumb";
import type { Preview } from "./ImportDialog";

/** Pixels of movement before a press on a card becomes a drag. */
const DRAG_FROM = 5;

/** The body zone under a screen point, if any. */
export function zoneAt(x: number, y: number): string | null {
  return (
    document
      .elementsFromPoint(x, y)
      .map((el) => el.closest<HTMLElement>("[data-zone]")?.dataset.zone)
      .find((z) => z) ?? null
  );
}

/**
 * One piece of the import: pick it or drag it onto the body, choose its place from the list, or
 * leave it out. `slim` is the one-line form for pieces that are placed or left out.
 */
export function PlacementCard(props: {
  piece: Preview["pieces"][number];
  choice: string | undefined;
  slim: boolean;
  check: boolean;
  armed: boolean;
  dragging: boolean;
  /** The other pieces this one can go on. */
  others: { key: string; label: string }[];
  onArm: () => void;
  onDrag: (at: { x: number; y: number; over: string | null } | null) => void;
  onDrop: (zone: string) => void;
  onChoose: (value: string) => void;
  onHover: (on: boolean) => void;
  children?: ReactNode;
}) {
  const { piece: x, choice } = props;
  const fixed = x.cuts;
  const left = choice === "leave";
  return (
    <li className="m-0 list-none">
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border p-2",
          props.armed ? "border-select bg-select/5" : "border-border",
          props.dragging && "opacity-50",
          left && "opacity-70",
        )}
        onPointerEnter={() => props.onHover(true)}
        onPointerLeave={() => props.onHover(false)}
      >
        <button
          type="button"
          aria-pressed={props.armed}
          aria-label={`${x.name}: ${choiceLabel(choice)}. Pick it, then choose a part of the body.`}
          className="flex min-w-0 grow cursor-grab touch-none items-center gap-3 rounded-xl border-0 bg-transparent p-0 text-left select-none"
          onClick={props.onArm}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const from = { x: e.clientX, y: e.clientY };
            let dragging = false;
            const move = (m: PointerEvent) => {
              if (
                !dragging &&
                Math.hypot(m.clientX - from.x, m.clientY - from.y) < DRAG_FROM
              )
                return;
              dragging = true;
              props.onDrag({
                x: m.clientX,
                y: m.clientY,
                over: zoneAt(m.clientX, m.clientY),
              });
            };
            const end = (u: PointerEvent) => {
              el.removeEventListener("pointermove", move);
              el.removeEventListener("pointerup", end);
              el.removeEventListener("pointercancel", end);
              props.onDrag(null);
              if (!dragging) return;
              // The click that follows a drag must not pick the piece.
              const swallow = (c: Event) => c.stopImmediatePropagation();
              el.addEventListener("click", swallow, true);
              setTimeout(
                () => el.removeEventListener("click", swallow, true),
                50,
              );
              if (u.type === "pointerup") {
                const z = zoneAt(u.clientX, u.clientY);
                if (z) props.onDrop(z);
              }
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", end);
            el.addEventListener("pointercancel", end);
          }}
        >
          <ImportThumb outline={x.outline} size={props.slim ? 36 : 56} />
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold">
                {x.name}
              </span>
              {props.check && (
                <span className="bg-brand/15 text-brand shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold">
                  Check
                </span>
              )}
            </span>
            {!props.slim && (
              <span className="text-muted-foreground text-[13px]">
                {fixed
                  ? `Cut ${fixed === 2 ? "twice" : "once"} (sewing file)`
                  : `Cut ×${x.quantity} in the file`}
              </span>
            )}
          </span>
        </button>
        <PlaceSelect
          label={`Place of ${x.name}`}
          className="h-10 w-[180px] shrink-0 rounded-[10px] border-[1.5px] border-border-strong bg-card text-[13px]"
          placeholder="Not placed"
          value={choice ?? null}
          options={{
            one: fixed !== 2,
            pairs: fixed !== 1,
            on: fixed === 2 ? [] : props.others,
            flat: fixed !== 2,
            leave: true,
          }}
          onChange={props.onChoose}
        />
        {!left && (
          <button
            type="button"
            title="Leave it out of the import"
            aria-label={`Leave ${x.name} out`}
            onClick={() => props.onChoose("leave")}
            className="text-muted-foreground hover:text-foreground hover:bg-hover grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {props.children}
    </li>
  );
}
