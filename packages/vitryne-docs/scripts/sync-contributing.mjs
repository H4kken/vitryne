// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes content/docs/developers/contributing.md from the repository's CONTRIBUTING.md, which
// has to stay at the root (GitHub shows it to anyone opening a pull request). The H1 becomes the
// page title, links to pages of this site become site URLs, and links to other files in the
// repository point at GitHub. The output is git-ignored: edit CONTRIBUTING.md, not the copy.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const content = join(root, "packages/vitryne-docs/content/docs");
const github = "https://github.com/H4kken/vitryne";
const front = `---
title: "Contributing"
icon: GitMerge
description: "Building Vitryne, the checks, and how to send a change."
---

<!-- Generated from CONTRIBUTING.md by scripts/sync-contributing.mjs; edit that file. -->

`;

const source = join(root, "CONTRIBUTING.md");
const body = readFileSync(source, "utf8")
  .replace(/^# .*\n+/, "")
  .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, text, target) => {
    if (/^(https?:|mailto:|#|\/)/.test(target)) return whole;
    const [path, anchor = ""] = target.split("#");
    const file = resolve(dirname(source), path);
    const hash = anchor ? `#${anchor}` : "";
    if (file.startsWith(`${content}/`) && /\.mdx?$/.test(file)) {
      const page = relative(content, file).replace(/\.mdx?$/, "");
      return `[${text}](/${page}${hash})`;
    }
    if (!existsSync(file)) return whole;
    const kind = statSync(file).isDirectory() ? "tree" : "blob";
    return `[${text}](${github}/${kind}/main/${relative(root, file)}${hash})`;
  });

writeFileSync(join(content, "developers/contributing.md"), front + body);
