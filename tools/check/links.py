#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Markdown links (`make hygiene`): every relative link in a tracked .md/.mdx file points at a
tracked file or folder, spelled exactly (so a case mismatch fails here, not on GitHub), and every
site link (`/developers/architecture`) at a page of the docs site. The archive in docs/history/
keeps its old links and is skipped."""
import os
import re
import subprocess
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
os.chdir(root)
tracked = subprocess.check_output(["git", "ls-files"], text=True).split("\n")
files = set(tracked)
folders = {os.path.dirname(f) for f in tracked}
while True:
    parents = {os.path.dirname(f) for f in folders if f} - folders
    if not parents:
        break
    folders |= parents

content = "packages/vitryne-docs/content/docs/"
# contributing.md is generated from CONTRIBUTING.md by the docs package (scripts/sync-contributing.mjs).
pages = {"developers/contributing"}
for f in files:
    if f.startswith(content) and f.endswith((".md", ".mdx")):
        page = f[len(content):].rsplit(".", 1)[0]
        pages.add(page.removesuffix("/index"))
pages.add("")

link = re.compile(r"\]\(([^)\s]+)\)")
fence = re.compile(r"^(```|~~~)")
bad = []
for f in tracked:
    if not f.endswith((".md", ".mdx")) or f.startswith("docs/history/"):
        continue
    if not os.path.isfile(f):
        continue
    in_code = False
    for n, line in enumerate(open(f, encoding="utf-8"), 1):
        if fence.match(line.strip()):
            in_code = not in_code
        if in_code:
            continue
        for target in link.findall(line):
            if re.match(r"(https?:|mailto:|#)", target):
                continue
            path = target.split("#")[0].split("?")[0]
            if target.startswith("/"):
                if f.startswith(content) and path.strip("/") not in pages and not os.path.exists(f"packages/vitryne-docs/public{path}"):
                    bad.append(f"{f}:{n}: no docs page {target}")
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(f), path))
            if resolved not in files and resolved not in folders:
                bad.append(f"{f}:{n}: {target} is not a tracked file or folder")
if bad:
    print("check: FAILED: broken markdown links:\n  " + "\n  ".join(bad), file=sys.stderr)
    sys.exit(1)
print("links ok")
