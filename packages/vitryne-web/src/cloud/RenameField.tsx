// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";

export function RenameField({
  name,
  onDone,
  ref,
}: {
  name: string;
  onDone: (name: string | null) => void;
  ref: React.Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState(name);
  return (
    <input
      ref={ref}
      aria-label="Project name"
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      className="-mx-1 rounded-md border-[1.5px] border-[#14181F] px-1 text-[15px] font-semibold outline-none"
    />
  );
}
