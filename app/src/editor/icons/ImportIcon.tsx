// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";

/** "Import your own pattern" (the concept's upload arrow). */
export const ImportIcon = (p: IconProps) => (
  <svg
    width="30"
    height="30"
    viewBox="0 0 30 30"
    aria-hidden="true"
    className={p.className}
  >
    <path
      d="M15 21 V6 M8 12 L15 5 L22 12 M5 25 H25"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
