// SPDX-License-Identifier: AGPL-3.0-or-later
import { useSyncExternalStore } from "react";

/** What the person picked; "system" follows the operating system's setting. */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "vitryne.theme";
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked: the system setting decides.
  }
  return "system";
}

let choice = stored();

/** The theme in effect: the choice, or the system's setting. */
export function resolvedTheme(): "light" | "dark" {
  return choice === "system" ? (dark.matches ? "dark" : "light") : choice;
}

function apply() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark");
  for (const l of listeners) l();
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // The choice holds for this visit only.
  }
  apply();
}

dark.addEventListener("change", apply);
apply();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useThemeChoice = () =>
  useSyncExternalStore(subscribe, () => choice);
export const useResolvedTheme = () =>
  useSyncExternalStore(subscribe, resolvedTheme);
