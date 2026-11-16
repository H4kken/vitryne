// SPDX-License-Identifier: AGPL-3.0-or-later

/** How far a hero word leans toward the pointer: the vector from the word to the pointer, scaled to
 * at most `max` px, and less when the pointer is already near (full strength from 300 px away). */
export function wordPull(dx: number, dy: number, max: number) {
  const d = Math.hypot(dx, dy) || 1;
  const k = (max * Math.min(d, 300)) / 300 / d;
  return { x: dx * k, y: dy * k };
}
