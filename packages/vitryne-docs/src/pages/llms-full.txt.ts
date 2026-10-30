// SPDX-License-Identifier: AGPL-3.0-or-later
// /llms-full.txt: every docs page in one file, for language models (lib/llms.ts).
import type { APIRoute } from "astro";
import { llmsFull } from "@/lib/llms";

export const GET: APIRoute = () =>
  new Response(llmsFull(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
