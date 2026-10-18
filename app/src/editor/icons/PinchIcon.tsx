// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";
import { Stroke } from "./Stroke";

export const PinchIcon = (p: IconProps) => (
  <Stroke
    {...p}
    size={22}
    d="M8 4 V12 M12 3 V12 M16 5 V12 M8 12 C5 12 4 14 6 17 L9 21 H16 C19 20 20 17 20 14 V11 C20 9 17 9 16 11"
  />
);
