// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";

export function FabricSwatch({
  color,
  size = "size-8",
}: {
  color: string | undefined;
  size?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${size} shrink-0 rounded-full border border-black/10`}
      style={{ background: color ?? DEFAULT_CLOTH_COLOR }}
    />
  );
}
