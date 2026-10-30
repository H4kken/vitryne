// SPDX-License-Identifier: AGPL-3.0-or-later
import { cn } from "@/lib/utils";

/** Whether the pieces make a new project or join the open one. */
export function ImportTarget(props: {
  projectName: string;
  value: "new" | "add";
  onChange: (v: "new" | "add") => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-[14px] font-semibold">Import into</legend>
      <div className="flex gap-1 rounded-xl bg-hover p-1">
        {(["new", "add"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={props.value === k}
            onClick={() => props.onChange(k)}
            className={cn(
              "h-10 flex-1 rounded-[9px] px-3 text-[15px] font-semibold",
              props.value === k &&
                "bg-card shadow-[0_1px_3px_rgba(20,24,31,.15)]",
            )}
          >
            {k === "new" ? "A new project" : props.projectName}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
