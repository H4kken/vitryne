// SPDX-License-Identifier: AGPL-3.0-or-later
import { COLOR_SWATCHES, colorName } from "@/format/colors";

/**
 * A colour: swatches, and any other from the system's picker (its drag is one gesture,
 * `onPick(c, true)` until `onDragEnd`). `value` is the target's own colour, `shown` what it
 * looks like without one; `onReset` takes its own away.
 */
export function ColorField(props: {
  label: string;
  value: string | undefined;
  shown: string;
  onPick: (color: string, dragging: boolean) => void;
  onDragEnd: () => void;
  onReset?: { label: string; run: () => void };
}) {
  const current = props.value ?? props.shown;
  const custom =
    props.value !== undefined &&
    !COLOR_SWATCHES.some((s) => s.color === props.value);
  const pick = (c: string, dragging: boolean) => {
    if (c !== props.value) props.onPick(c, dragging);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="size-7 shrink-0 rounded-full border border-black/10"
          style={{ background: current }}
        />
        <span className="text-[15px] font-semibold">{props.label}</span>
        <span className="text-muted-foreground text-[13px]">
          {props.value ? colorName(props.value) : "None yet"}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={props.label}
        className="grid grid-cols-7 gap-1.5"
      >
        {COLOR_SWATCHES.map((s) => (
          <button
            key={s.color}
            type="button"
            role="radio"
            aria-checked={props.value === s.color}
            aria-label={s.name}
            title={s.name}
            onClick={() => pick(s.color, false)}
            className={`aspect-square w-full rounded-full border border-black/10 transition-shadow ${
              props.value === s.color
                ? "ring-2 ring-[#14181F] ring-offset-2"
                : "hover:ring-2 hover:ring-[#B5B9B0] hover:ring-offset-1"
            }`}
            style={{ background: s.color }}
          />
        ))}
        <label
          title="Any colour"
          className={`relative flex aspect-square w-full cursor-pointer items-center justify-center rounded-full border border-black/10 ${
            custom
              ? "ring-2 ring-[#14181F] ring-offset-2"
              : "hover:ring-2 hover:ring-[#B5B9B0] hover:ring-offset-1"
          }`}
          style={{
            background: custom
              ? props.value
              : "conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)",
          }}
        >
          <span className="sr-only">Any colour</span>
          <input
            type="color"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={current}
            onChange={(e) => pick(e.target.value, true)}
            onBlur={props.onDragEnd}
          />
        </label>
      </div>
      {props.onReset && props.value !== undefined && (
        <button
          type="button"
          onClick={props.onReset.run}
          className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
        >
          {props.onReset.label}
        </button>
      )}
    </div>
  );
}
