// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";
import { Stroke } from "./Stroke";

export const RedoIcon = (p: IconProps) => (
  <Stroke
    {...p}
    d="M15.6 4 L20.4 8.8 L15.6 13.6 M20.4 8.8 H9.6 a6 6 0 0 0 0 12 H14.4"
  />
);
