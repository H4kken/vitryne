// SPDX-License-Identifier: AGPL-3.0-or-later

/** Up to 4 significant digits, never in exponent notation (a field shows "1400", not "1.400e+3"). */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // en-US without grouping: what the field reads back (`Number`), whatever the browser's language.
  return Number(v.toPrecision(4)).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 20,
  });
}
