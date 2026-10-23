// SPDX-License-Identifier: AGPL-3.0-or-later
// The docs' languages. English is the source and lives at the root (/getting-started); another
// language lives under its code (/fr/getting-started) and its pages sit next to the English ones
// (`getting-started.fr.mdx`, `meta.fr.json`). A page not translated yet shows the English.
// To add one: its code in `languages`, its name in `languageNames`; the language switch appears
// once there are two.
import { defineI18n } from "fumadocs-core/i18n";

export const i18n = defineI18n({
  defaultLanguage: "en",
  languages: ["en"],
  hideLocale: "default-locale",
  parser: "dot",
});

export type Language = (typeof i18n.languages)[number];

/** Each language's name in the language switch, in that language. */
export const languageNames: Record<Language, string> = {
  en: "English",
};
