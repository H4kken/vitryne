// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";
import { Stroke } from "./Stroke";

/** The concept's "Select" arrow. */
export const SelectIcon = (p: IconProps) => (
  <Stroke
    {...p}
    size={22}
    d="M5 3 L5 19 L9.5 15 L12.5 21 L15 19.8 L12 14 L18 14 Z"
  />
);
