// SPDX-License-Identifier: AGPL-3.0-or-later
// /llms.txt: an index of the docs for language models (lib/llms.ts).
import type { APIRoute } from "astro";
import { llmsIndex } from "@/lib/llms";

export const GET: APIRoute = () =>
  new Response(llmsIndex(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
