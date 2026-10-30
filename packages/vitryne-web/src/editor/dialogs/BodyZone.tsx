// SPDX-License-Identifier: AGPL-3.0-or-later
import { cn } from "@/lib/utils";
import { type View, type ZoneBox, zoneKey } from "./bodyZones";

/** One part of the body on the map: a button that takes a dropped or picked piece. */
export function BodyZone(props: {
  view: View;
  box: ZoneBox;
  occupied: Record<string, string[]>;
  lit: ReadonlySet<string>;
  inviting: boolean;
  onZone: (key: string) => void;
}) {
  const { view, box } = props;
  const key = zoneKey(view, box.zone);
  const names = props.occupied[key] ?? [];
  const lit = props.lit.has(key);
  const label = `${box.label}, ${view}`;
  return (
    <g
      data-zone={key}
      role="button"
      tabIndex={0}
      aria-label={
        names.length ? `${label}: ${names.join(", ")}` : `${label}: empty`
      }
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring [&:focus-visible>rect]:stroke-[3]"
      onClick={() => props.onZone(key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onZone(key);
        }
      }}
    >
      <title>{label}</title>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={box.rx}
        strokeWidth={1.5}
        strokeDasharray={
          props.inviting && !names.length && !lit ? "4 3" : undefined
        }
        className={cn(
          "transition-colors",
          lit
            ? "fill-select/25 stroke-select"
            : names.length
              ? "fill-live/20 stroke-live"
              : "fill-card stroke-line",
        )}
      />
      {names.length > 0 && (
        <text
          x={box.x + box.w / 2}
          y={box.y + box.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground pointer-events-none text-[15px] font-bold"
        >
          {names.length}
        </text>
      )}
    </g>
  );
}
