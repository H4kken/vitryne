// SPDX-License-Identifier: AGPL-3.0-or-later
// How the modifier keys are written in hints: the Mac's symbols there, words elsewhere.

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** Command (Mac) or "Ctrl+", for a shortcut like `${MOD}Z`. */
export const MOD = MAC ? "⌘" : "Ctrl+";
/** Shift; `altKey` is Option on a Mac. */
export const SHIFT = MAC ? "⇧" : "Shift";
export const ALT = MAC ? "⌥" : "Alt";
