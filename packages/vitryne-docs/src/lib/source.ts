// SPDX-License-Identifier: AGPL-3.0-or-later
// The Fumadocs source (page tree, URLs, search data) built from the Astro collections.
import type { StaticSource } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { flattenTree } from "fumadocs-core/page-tree";
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

/**
 * The URLs of folders that have no page of their own (`/guide`, with `guide/` but no
 * `guide/index.mdx`), each to the first page under it in sidebar order, with its route.
 */
export function getFolderRedirects() {
  return source.getLanguages().flatMap(({ language, pages }) => {
    const urls = new Set(pages.map((page) => page.url));
    const inOrder = flattenTree(source.getPageTree(language).children).map(
      (item) => item.url,
    );
    const redirects = new Map<string, string>();
    for (const url of inOrder) {
      const segments = url.split("/").filter(Boolean);
      for (let n = 1; n < segments.length; n++) {
        const folder = "/" + segments.slice(0, n).join("/");
        if (!urls.has(folder) && !redirects.has(folder))
          redirects.set(folder, url);
      }
    }
    return [...redirects].map(([folder, to]) => ({
      language,
      slug: folder.slice(1),
      to,
    }));
  });
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
