// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from "react";

// The project's name in the top bar reads as text and edits in place on click: Enter or leaving
// the field renames, Escape keeps the old name, an empty name is ignored.
export function ProjectName(props: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const text = draft ?? props.name;
  const commit = () => {
    const v = draft?.trim();
    if (!cancelled.current && v && v !== props.name) props.onRename(v);
    cancelled.current = false;
    setDraft(null);
  };
  return (
    <span className="inline-grid max-w-[40vw] text-[15px] font-semibold">
      {/* The hidden copy sizes the field to its text. */}
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 truncate border-[1.5px] px-2 whitespace-pre"
      >
        {text || " "}
      </span>
      <input
        aria-label="Project name"
        title="Rename"
        spellCheck={false}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(props.name);
          e.currentTarget.select();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="col-start-1 row-start-1 h-8 min-w-0 truncate rounded-lg border-[1.5px] border-transparent bg-transparent px-2 outline-none hover:border-[#D5D9D1] focus:border-[#14181F] focus:text-clip"
      />
    </span>
  );
}
