// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { DEFAULT_SKIN } from "@/lib/skin";

/** The concept's 3D look: its canvas ground, a sage garment, a warm skin tone. Values 0..1. */
const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Dark mode turns the ground and the skin down; the cloth keeps its colours. */
export const sceneStyle = (
  theme: "light" | "dark",
  skin: string = DEFAULT_SKIN,
) => [
  ...hex(theme === "dark" ? "#1A1E24" : "#ECEFE9"),
  ...hex(DEFAULT_CLOTH_COLOR),
  ...hex("#7F9783"),
  ...hex(skin).map((c) => (theme === "dark" ? c * 0.65 : c)),
];
