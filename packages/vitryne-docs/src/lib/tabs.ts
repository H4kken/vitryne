// SPDX-License-Identifier: AGPL-3.0-or-later
// The docs' tabs, one per reader: the Guide (designing garments, `content/docs/(guide)/`, at
// the root of the site), Self-hosting and Developers. Each is a root folder (`"root": true` in
// its meta.json): its own sidebar, and a search tag so search stays within it.
import { i18n } from "./i18n";

export const tabs = [
  { tag: "guide", label: "Guide" },
  { tag: "self-hosting", label: "Self-hosting" },
  { tag: "developers", label: "Developers" },
] as const;

export type Tab = (typeof tabs)[number]["tag"];

/** The tab of a page from its content path (`developers/algorithms.md`, `(guide)/index.mdx`). */
export function tabOfPath(path: string): Tab {
  const folder = path.split("/")[0].replace(/^\((.*)\)$/, "$1");
  return tabs.find((tab) => tab.tag === folder)?.tag ?? "guide";
}

/** The tab of a URL (`/developers/algorithms`, `/fr/self-hosting`); the Guide has no prefix. */
export function tabOfUrl(pathname: string): Tab {
  const segments = pathname.split("/").filter(Boolean);
  if ((i18n.languages as readonly string[]).includes(segments[0]))
    segments.shift();
  return tabs.find((tab) => tab.tag === segments[0])?.tag ?? "guide";
}
