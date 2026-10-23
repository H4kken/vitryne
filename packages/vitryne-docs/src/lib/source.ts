// SPDX-License-Identifier: AGPL-3.0-or-later
// The Fumadocs source (page tree, URLs, search data) built from the Astro collections.
import type { StaticSource } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { type CollectionEntry, getCollection } from "astro:content";
import * as path from "node:path";
import { structure, type StructuredData } from "fumadocs-core/mdx-plugins";
import { i18n } from "./i18n";

export const source = loader({
  source: await createSource(),
  baseUrl: "/",
  i18n,
});

/** Every page in every language (untranslated ones fall back to English), with its route. */
export function getLocalizedPages() {
  return source.getLanguages().flatMap(({ language, pages }) =>
    pages.map((page) => ({
      language,
      page,
      // The Astro rest parameter: the URL without its slashes, `undefined` for the root.
      slug: page.url.replace(/^\/|\/$/g, "") || undefined,
    })),
  );
}

export function getStructuredData(
  entry: CollectionEntry<"docs">,
): StructuredData {
  return structure(entry.body ?? "");
}

/** The page's Open Graph image, made at build time by `pages/og/docs/[...slug]`. */
export function getPageImageUrl(page: { url: string }): string {
  return `/og/docs${page.url === "/" ? "" : page.url}/image.webp`;
}

async function createSource() {
  const out: StaticSource<{
    metaData: CollectionEntry<"meta">["data"];
    pageData: CollectionEntry<"docs">["data"] & {
      _raw: CollectionEntry<"docs">;
    };
  }> = { files: [] };

  for (const page of await getCollection("docs")) {
    out.files.push({
      type: "page",
      path: path.relative("content/docs", page.filePath!),
      data: { ...page.data, _raw: page },
    });
  }
  for (const meta of await getCollection("meta")) {
    out.files.push({
      type: "meta",
      path: path.relative("content/docs", meta.filePath!),
      data: meta.data,
    });
  }
  return out;
}
