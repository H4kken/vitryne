// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";

/** A fabric in a list: its colour and name. */
export function FabricOption({
  color,
  name,
}: {
  color: string | undefined;
  name: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-full border border-black/10"
        style={{ background: color ?? DEFAULT_CLOTH_COLOR }}
      />
      {name}
    </span>
  );
}
