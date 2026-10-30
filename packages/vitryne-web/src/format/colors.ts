// SPDX-License-Identifier: AGPL-3.0-or-later
// Fabric colours (appearances, packages/vitryne-docs/content/docs/developers/file-format.md, Appearance): the swatches the editor offers, and
// the colour cloth has without one (the 3D view's, sceneStyle).

/** The cloth colour of a garment or piece that has no appearance. */
export const DEFAULT_CLOTH_COLOR = "#9db4a0";

/** Swatches, named for people (an appearance picked from one takes its name). */
export const COLOR_SWATCHES: readonly { name: string; color: string }[] = [
  { name: "White", color: "#f4f2ec" },
  { name: "Black", color: "#22252a" },
  { name: "Heather grey", color: "#9a9c9e" },
  { name: "Navy", color: "#1f2a44" },
  { name: "Denim blue", color: "#3b5a80" },
  { name: "Sky blue", color: "#8fb8de" },
  { name: "Forest green", color: "#2f5d43" },
  { name: "Sage", color: "#9db4a0" },
  { name: "Mustard", color: "#d4a62a" },
  { name: "Terracotta", color: "#c0643f" },
  { name: "Red", color: "#b5282e" },
  { name: "Blush pink", color: "#e8b4b0" },
];

const HEX = /^#[0-9a-f]{6}$/;

/** `#RRGGBB` or `#rrggbb` as the format stores it (lowercase), or undefined if it isn't one. */
export function normalizeColor(c: string): string | undefined {
  const lower = c.trim().toLowerCase();
  return HEX.test(lower) ? lower : undefined;
}

/** A name for a colour: its swatch's, else the colour itself. */
export function colorName(color: string): string {
  return COLOR_SWATCHES.find((s) => s.color === color)?.name ?? color;
}
