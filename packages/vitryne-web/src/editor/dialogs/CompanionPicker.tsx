// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { TextFile } from "./ImportDialog";
import { companionAccept, type PatternKind } from "./importSource";

/** A button that picks the file that comes with a pattern (the dialog also takes it dropped). */
export function CompanionPicker(props: {
  kind: PatternKind;
  label: string;
  variant?: "outline" | "ghost";
  /** A large dashed area, for when the file is the next thing to do. */
  area?: boolean;
  onFile: (f: TextFile) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={companionAccept(props.kind)}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f)
            void f.text().then((text) => props.onFile({ name: f.name, text }));
        }}
      />
      {props.area ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="border-border-strong text-body-text hover:border-foreground hover:text-foreground flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 border-dashed bg-transparent px-4 py-6 text-[15px] font-semibold"
        >
          {props.label}
        </button>
      ) : (
        <Button
          variant={props.variant ?? "outline"}
          size="sm"
          onClick={() => input.current?.click()}
        >
          {props.label}
        </Button>
      )}
    </>
  );
}
