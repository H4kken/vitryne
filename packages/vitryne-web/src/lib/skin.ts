// SPDX-License-Identifier: AGPL-3.0-or-later
// The avatar's skin tone: a viewing preference kept in this browser, like the theme (it is not in
// the project file, so it never changes a drape, an export or what another viewer sees).
import { useSyncExternalStore } from "react";

/** Swatches, light to deep. */
export const SKIN_TONES: readonly string[] = [
  "#E8C4AC",
  "#D9A98C",
  "#BD8C70",
  "#A97C5B",
  "#8F6248",
  "#6F4A36",
  "#4E3226",
];

export const DEFAULT_SKIN = "#BD8C70";

const KEY = "vitryne.skin";
const listeners = new Set<() => void>();

function stored(): string {
  try {
    const v = localStorage.getItem(KEY);
    const tone = SKIN_TONES.find((t) => t.toLowerCase() === v?.toLowerCase());
    if (tone) return tone.toLowerCase();
  } catch {
    // Storage blocked: the default tone.
  }
  return DEFAULT_SKIN.toLowerCase();
}

let skin = stored();

export function setSkin(color: string) {
  skin = color.toLowerCase();
  try {
    if (skin === DEFAULT_SKIN.toLowerCase()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, skin);
  } catch {
    // The choice holds for this visit only.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSkin = () => useSyncExternalStore(subscribe, () => skin);
