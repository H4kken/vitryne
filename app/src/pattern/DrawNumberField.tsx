// SPDX-License-Identifier: AGPL-3.0-or-later

export function DrawNumberField(props: {
  label: string;
  unit: string;
  value: number;
  draft: string | null;
  onDraft: (v: string | null) => void;
  onEnter: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-[#4A514B]">
      {props.label}
      <input
        aria-label={`${props.label}, ${props.unit}`}
        inputMode="decimal"
        className="h-8 w-[72px] rounded-lg border-[1.5px] border-[#D5D9D1] bg-white px-2 text-right text-[13px] text-[#14181F] tabular-nums"
        value={props.draft ?? props.value.toFixed(1)}
        onChange={(e) => props.onDraft(e.target.value)}
        onFocus={(e) => props.onDraft(e.currentTarget.value)}
        onBlur={() =>
          props.draft === props.value.toFixed(1) && props.onDraft(null)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onEnter();
          }
          if (e.key === "Escape") {
            props.onDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      {props.unit}
    </label>
  );
}
