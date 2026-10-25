// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";

/** A length in mm: drafted while typing, committed on Enter or leaving the field. */
export function LengthField(props: {
  value: number;
  onCommit: (mm: number) => void;
}) {
  const shown = props.value.toFixed(1);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = Number(draft?.replace(",", "."));
    if (draft !== null && draft !== shown && Number.isFinite(v) && v > 0)
      props.onCommit(v);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-body-text">
      Length
      <input
        aria-label="Edge length, mm"
        inputMode="decimal"
        className="h-8 w-20 rounded-lg border-[1.5px] border-border-strong bg-card px-2 text-right text-[13px] text-foreground tabular-nums"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      mm
    </label>
  );
}
