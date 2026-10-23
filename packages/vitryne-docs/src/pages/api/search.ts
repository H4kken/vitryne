// SPDX-License-Identifier: AGPL-3.0-or-later
// The search index, written as a static file at build time (components/search.tsx reads it).
import type { APIRoute } from "astro";
import { createFromSource } from "fumadocs-core/search/server";
import { getStructuredData, source } from "@/lib/source";
import { tabOfPath } from "@/lib/tabs";

const server = createFromSource(source, {
  buildIndex(page) {
    return {
      // The URL, not the content entry's id: an untranslated page is the English entry again,
      // under another language's URL.
      id: page.url,
      title: page.data.title,
      description: page.data.description,
      structuredData: getStructuredData(page.data._raw),
      url: page.url,
      tag: tabOfPath(page.path),
    };
  },
});

export const GET: APIRoute = () => server.staticGET();
