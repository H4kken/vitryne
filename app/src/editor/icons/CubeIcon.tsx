// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconProps } from "./Stroke";
import { Stroke } from "./Stroke";

/** "Show 3D": a cube. */
export const CubeIcon = (p: IconProps) => (
  <Stroke
    {...p}
    d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M12 12 L20 7.5 M12 12 V21 M12 12 L4 7.5"
  />
);
