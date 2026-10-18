// SPDX-License-Identifier: AGPL-3.0-or-later
import { type IconProps, Stroke } from "./Stroke";

export const UndoIcon = (p: IconProps) => (
  <Stroke
    {...p}
    d="M8.4 4 L3.6 8.8 L8.4 13.6 M3.6 8.8 H14.4 a6 6 0 0 1 0 12 H9.6"
  />
);
