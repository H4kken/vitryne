// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";

/** A pen nib over a dashed piece: starting from scratch. */
export const ScratchIcon = (p: IconProps) => (
  <svg
    width="30"
    height="30"
    viewBox="0 0 30 30"
    aria-hidden="true"
    className={p.className}
  >
    <path
      d="M5 25 V9 H17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeDasharray="3 3"
      strokeLinecap="round"
    />
    <path
      d="M12 22 L13 17 L23 7 L27 11 L17 21 Z M20 10 L24 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
