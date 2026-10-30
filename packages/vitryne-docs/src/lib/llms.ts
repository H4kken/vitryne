// SPDX-License-Identifier: AGPL-3.0-or-later
// What the site gives to language models (https://llmstxt.org): `/llms.txt`, an index of every
// page in sidebar order, `/llms-full.txt`, every page in one file, and `/<page>.md`, one page as
// the markdown it is written in. All three come from the same page source as the sidebar and the
// search, so they cannot drift from the site.
import type * as PageTree from "fumadocs-core/page-tree";
import { source } from "./source";

export const siteUrl = "https://docs.vitryne.app";
const language = "en";

const summary =
  "Vitryne is free, open-source (AGPL-3.0-or-later) garment design in the browser: a GPU cloth " +
  "solver (Rust, WGSL, WebGPU) and an editor where you draw or import a pattern, sew it and " +
  "drape it on an avatar. These docs have guides for people designing garments and developer " +
  "documentation: how it is built, the solver's algorithms, the file format, the cloud backend " +
  "and how to contribute.";

export interface LlmsPage {
  title: string;
  description?: string;
  /** The page's URL on the site, `/developers/architecture`. */
  url: string;
  /** The URL of its markdown, `/developers/architecture.md`. */
  markdownUrl: string;
  body: string;
}

export interface LlmsSection {
  title: string;
  pages: LlmsPage[];
}

/** The URL of a page's markdown: `/` is `/index.md`. */
export function markdownUrl(url: string): string {
  return `${url === "/" ? "/index" : url.replace(/\/$/, "")}.md`;
}

/** The pages in sidebar order, under the sidebar's section headings. */
export function getSections(): LlmsSection[] {
  const pages = new Map(
    source.getPages(language).map((page) => [page.url, page]),
  );
  const sections: LlmsSection[] = [];
  let current: LlmsSection | undefined;

  const add = (url: string) => {
    const page = pages.get(url);
    if (!page) return;
    current ??= sections[sections.push({ title: "Docs", pages: [] }) - 1];
    current.pages.push({
      title: page.data.title,
      description: page.data.description,
      url,
      markdownUrl: markdownUrl(url),
      body: (page.data._raw.body ?? "").trim(),
    });
  };
  const walk = (nodes: PageTree.Node[]) => {
    for (const node of nodes) {
      if (node.type === "separator") {
        current =
          sections[sections.push({ title: String(node.name), pages: [] }) - 1];
      } else if (node.type === "page") {
        add(node.url);
      } else {
        if (node.index) add(node.index.url);
        walk(node.children);
      }
    }
  };
  walk(source.getPageTree(language).children);
  return sections.filter((section) => section.pages.length > 0);
}

export function llmsIndex(): string {
  const lines = ["# Vitryne docs", "", `> ${summary}`, ""];
  for (const section of getSections()) {
    lines.push(`## ${section.title}`, "");
    for (const page of section.pages) {
      const description = page.description ? `: ${page.description}` : "";
      lines.push(
        `- [${page.title}](${siteUrl}${page.markdownUrl})${description}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Source",
    "",
    "- [GitHub repository](https://github.com/H4kken/vitryne): the code, the issues and the project's progress log",
    `- [Every page in one file](${siteUrl}/llms-full.txt)`,
    "",
  );
  return lines.join("\n");
}

export function llmsFull(): string {
  const parts = ["# Vitryne docs", "", `> ${summary}`, ""];
  for (const section of getSections()) {
    for (const page of section.pages) {
      parts.push(
        "---",
        "",
        `# ${page.title}`,
        "",
        `Source: ${siteUrl}${page.url}`,
        "",
        page.body,
        "",
      );
    }
  }
  return parts.join("\n");
}
