// SPDX-License-Identifier: AGPL-3.0-or-later
import { BodyZone } from "./BodyZone";
import { type View, zonesIn } from "./bodyZones";

/**
 * The body, front and back side by side, as places to drop a piece on (or to click after
 * picking one). A zone with pieces on it is tinted green; the one a piece is held over, blue.
 */
export function BodyMap(props: {
  /** Zone key → the names of the pieces on it. */
  occupied: Record<string, string[]>;
  /** The zones to point out (the piece held over one, or the card pointed at). */
  lit: ReadonlySet<string>;
  /** A piece is held or picked: the free zones invite a drop. */
  inviting: boolean;
  onZone: (key: string) => void;
  /** Draw only this side, smaller (a piece's details), instead of both. */
  only?: View;
}) {
  const { only, ...rest } = props;
  return (
    <div className={only ? "flex justify-center" : "grid grid-cols-2 gap-2"}>
      {(only ? [only] : (["front", "back"] as View[])).map((view) => (
        <figure key={view} className="m-0 flex flex-col items-center gap-1">
          <svg
            viewBox="0 0 200 340"
            className={only ? "h-56 w-auto" : "h-auto w-full max-w-[190px]"}
            role="group"
            aria-label={`The body, ${view}`}
          >
            <circle
              cx={100}
              cy={30}
              r={17}
              className="fill-none stroke-line"
              strokeWidth={1.5}
            />
            <rect
              x={93}
              y={46}
              width={14}
              height={11}
              rx={4}
              className="fill-none stroke-line"
              strokeWidth={1.5}
            />
            {zonesIn(view).map((z) => (
              <BodyZone key={z.zone} view={view} box={z} {...rest} />
            ))}
          </svg>
          {!only && (
            <figcaption className="text-muted-foreground text-[13px] font-semibold">
              {view === "front" ? "Front" : "Back"}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}
