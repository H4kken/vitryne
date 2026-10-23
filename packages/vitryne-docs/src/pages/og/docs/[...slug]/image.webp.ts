// SPDX-License-Identifier: AGPL-3.0-or-later
// Each page's Open Graph image (the preview when a link is shared), made at build time, one per
// page and language.
import type { APIRoute } from "astro";
import { generateOGImage } from "fumadocs-ui/og/takumi";
import { getLocalizedPages } from "@/lib/source";

export function getStaticPaths() {
  return getLocalizedPages().map(({ page, slug }) => ({
    params: { slug },
    props: { title: page.data.title, description: page.data.description },
  }));
}

export const GET: APIRoute = ({ props }) =>
  generateOGImage({
    title: props.title,
    description: props.description,
    site: "Vitryne",
    format: "webp",
  });
