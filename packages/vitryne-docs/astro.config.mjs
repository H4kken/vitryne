// SPDX-License-Identifier: AGPL-3.0-or-later
// The docs site: Astro renders the pages statically, Fumadocs UI (React islands) draws the
// layout, search and table of contents (https://fumadocs.dev/docs/manual-installation/astro).
// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import {
  rehypeCode,
  remarkCodeTab,
  remarkHeading,
  remarkNpm,
  remarkStructure,
} from "fumadocs-core/mdx-plugins";
import convert from "npm-to-yarn";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// An `npm` code block becomes one tab per package manager; pnpm first (the repo's own), and the
// reader's pick is remembered across pages.
const packageManagers = ["pnpm", "npm", "yarn", "bun"].map((name) => ({
  name,
  command: (/** @type {string} */ cmd) =>
    cmd
      .split("\n")
      .map((line) => convert(line, /** @type {any} */ (name)))
      .join("\n"),
}));

/** @type {import("@astrojs/markdown-remark").RemarkPlugins} */
const remarkPlugins = [
  remarkHeading,
  remarkCodeTab,
  [remarkNpm, { packageManagers, persist: { id: "package-manager" } }],
  [remarkStructure, { exportAs: "structuredData" }],
  // `$...$` and `$$...$$` are formulas (the fabrics page), rendered by KaTeX at build time.
  remarkMath,
];
// Fumadocs highlights code itself (Shiki, at build time), so Astro's highlighter is off. A
// language Shiki has no grammar for (`caddy`, in the static hosting page) shows as plain text.
/** @type {import("@astrojs/markdown-remark").RehypePlugins} */
const rehypePlugins = [rehypeKatex, [rehypeCode, { fallbackLanguage: "text" }]];

export default defineConfig({
  markdown: {
    syntaxHighlight: false,
    processor: unified({ remarkPlugins, rehypePlugins }),
  },
  integrations: [
    react(),
    mdx({
      extendMarkdownConfig: true,
      syntaxHighlight: false,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
