// SPDX-License-Identifier: AGPL-3.0-or-later
// The size of a saved picture: the viewport's shape, `longSide` pixels on its longer side, and
// never more than the GPU can draw.

export function imageSize(
  viewW: number,
  viewH: number,
  longSide: number,
  maxSide: number,
): { width: number; height: number } {
  const cw = Math.max(1, viewW);
  const ch = Math.max(1, viewH);
  const side = Math.max(1, Math.min(longSide, maxSide));
  const k = side / Math.max(cw, ch);
  return {
    width: Math.max(1, Math.round(cw * k)),
    height: Math.max(1, Math.round(ch * k)),
  };
}
