// SPDX-License-Identifier: AGPL-3.0-or-later

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "Edited 5 minutes ago", "Edited yesterday", then the date. */
export function editedAgo(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000;
  const a = Math.abs(s);
  if (a < 60) return "Edited just now";
  if (a < 3600)
    return `Edited ${relative.format(Math.round(s / 60), "minute")}`;
  if (a < 86400)
    return `Edited ${relative.format(Math.round(s / 3600), "hour")}`;
  if (a < 7 * 86400)
    return `Edited ${relative.format(Math.round(s / 86400), "day")}`;
  return `Edited ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
