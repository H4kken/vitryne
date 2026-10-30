// SPDX-License-Identifier: AGPL-3.0-or-later
// Each page as the markdown it is written in, at its URL plus `.md` (`/developers/cloud.md`;
// the start page is `/index.md`): what /llms.txt links to (lib/llms.ts).
import type { APIRoute } from "astro";
import { getSections } from "@/lib/llms";

export function getStaticPaths() {
  return getSections()
    .flatMap((section) => section.pages)
    .map((page) => ({
      params: { slug: page.markdownUrl.replace(/^\/|\.md$/g, "") },
      props: { title: page.title, body: page.body },
    }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(`# ${props.title}\n\n${props.body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
