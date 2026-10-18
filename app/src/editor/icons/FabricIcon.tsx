// SPDX-License-Identifier: AGPL-3.0-or-later
import { type IconProps, Stroke } from "./Stroke";

export const FabricIcon = (p: IconProps) => (
  <Stroke
    {...p}
    size={24}
    d="M4 4 H20 V20 H4 Z M4 9.3 H20 M4 14.6 H20 M9.3 4 V20 M14.6 4 V20"
  />
);
