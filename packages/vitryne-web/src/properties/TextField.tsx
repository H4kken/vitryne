// SPDX-License-Identifier: AGPL-3.0-or-later
// A text that edits the document: it keeps a draft while typing and commits on Enter or when
// it loses focus (Escape drops the draft).

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDraft } from "./useDraft";

export function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const id = useId();
  const d = useDraft(props.value);
  const commit = () => {
    if (d.editing && d.text !== props.value) props.onCommit(d.text);
    d.clear();
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {props.label}
      </Label>
      <Input
        id={id}
        className="h-11 rounded-[10px] border-[1.5px] border-border-strong bg-card px-3 text-[15px] shadow-none"
        value={d.text}
        placeholder={props.placeholder}
        onChange={(e) => d.setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            d.clear();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
