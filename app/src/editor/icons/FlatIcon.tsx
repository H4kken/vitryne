// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";
import { Stroke } from "./Stroke";

/** "Show flat pieces": a flat garment piece. */
export const FlatIcon = (p: IconProps) => (
  <Stroke {...p} d="M7 4 L12 7 L17 4 L21 8 L18 11 V20 H6 V11 L3 8 Z" />
);
