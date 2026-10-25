// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";

/** The concept's 3D look: its canvas ground, a sage garment, the mannequin grey. Values 0..1. */
const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Dark mode turns the ground and the mannequin down; the cloth keeps its colours. */
export const sceneStyle = (theme: "light" | "dark") => [
  ...hex(theme === "dark" ? "#1A1E24" : "#ECEFE9"),
  ...hex(DEFAULT_CLOTH_COLOR),
  ...hex("#7F9783"),
  ...hex(theme === "dark" ? "#7E857A" : "#CBD0C6"),
];
