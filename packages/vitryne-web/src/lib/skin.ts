// SPDX-License-Identifier: AGPL-3.0-or-later
// The avatar's skin tone: a viewing preference kept in this browser, like the theme (it is not in
// the project file, so it never changes a drape, an export or what another viewer sees).
import { useSyncExternalStore } from "react";

/** Swatches, light to deep, named for people. */
export const SKIN_TONES: readonly { name: string; color: string }[] = [
  { name: "Fair", color: "#E8C4AC" },
  { name: "Light", color: "#D9A98C" },
  { name: "Medium", color: "#BD8C70" },
  { name: "Olive", color: "#A97C5B" },
  { name: "Tan", color: "#8F6248" },
  { name: "Brown", color: "#6F4A36" },
  { name: "Deep", color: "#4E3226" },
];

export const DEFAULT_SKIN = "#BD8C70";

const KEY = "vitryne.skin";
const listeners = new Set<() => void>();

function stored(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
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
