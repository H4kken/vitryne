# vitryne-docs

The documentation website: [Astro](https://astro.build) builds static pages and
[Fumadocs](https://fumadocs.dev) (React islands) draws the layout, sidebar, search and table of
contents. It uses the editor's look (colours and fonts from `packages/vitryne-web/src/index.css`).

| Path                                           | What                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [content/docs/](content/docs/)                 | The pages (`.mdx`, with `title` and `description` front matter) and `meta.json`, the sidebar order per folder.                                                                                                                                                   |
| [src/pages/](src/pages/)                       | `[...slug].astro` renders every page (and sends a folder URL without a page, like `/guide`, to its first page), `404.astro` the page for an unknown URL; `api/search.ts` writes the search index at build time; `og/docs/` makes each page's link-preview image. |
| [src/components/](src/components/)             | The HTML document (`layout.astro`), the Fumadocs island (`docs.tsx`) and `shell.astro`, which keeps it across navigations (the sidebar's open folders stay open), the search dialog.                                                                             |
| [src/styles/global.css](src/styles/global.css) | Tailwind, Fumadocs' shadcn preset, the editor's colour tokens and fonts.                                                                                                                                                                                         |

Search runs in the browser over that static index; the site makes no other requests.

## One sidebar, three sections

| Section        | For                                               | Folder                                         | URLs                             |
| -------------- | ------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| Introduction   | Everyone: what Vitryne is, what it needs          | `content/docs/` (`index.mdx`, `requirements…`) | `/`, `/requirements`             |
| Infos & Guides | People designing garments: no technical words     | `guide/`, `imports_exports/`                   | `/guide/…`, `/imports_exports/…` |
| Developers     | Contributors: how it works, the format, the rules | `developers/`                                  | `/developers/…`                  |

`content/docs/meta.json` lays the sidebar out: its `"---Name---"` entries are the section
headings, and each folder under them is a collapsible entry. A folder's URL without a page of its
own (`/guide`) goes to its first page. Search covers every page.

The pages in Developers are the only copy of those documents: `architecture` (`.mdx`: it uses the
file trees), `algorithms`, `cloud`, `fabrics`, `file-format`, `patents` and `maintaining` (`.md`), and
`docker-stack.mdx`. Self-hosting is the same: its pages (`self-hosting/`, including `static-hosting`)
are the only copy of the instructions for running an instance. Edit them here; the repository's code
comments and READMEs link to these files. The one exception is `contributing.md`: GitHub shows the
root `CONTRIBUTING.md` to anyone opening a pull request, so that file stays the source and
`scripts/sync-contributing.mjs` writes the page from it (the H1 becomes the `title`, links to pages
become site URLs, links into the repository point at GitHub; it runs before `dev`, `check` and
`build`, and its output is git-ignored). `docs/PROGRESS.md` stays on GitHub only: it is the
project's history, not documentation.

`make hygiene` fails on a broken link between markdown files (`tools/check/links.py`, which also
checks site links like `/developers/architecture`).

## Run and check

From the repository root:

```sh
make docs-dev     # dev server on http://localhost:4321
make docs         # astro check, then the static build in packages/vitryne-docs/dist
make fmt          # prettier (with the Astro plugin) here too
```

`make check-ci` runs `make docs` and the docs' prettier check.

## Writing a page

Add `<name>.mdx` with a `title` and a `description` to its folder, and list `<name>` in
its `meta.json`. In a Guide page, write for someone who sews or designs, not for a developer:
the outcome first, numbered steps, a picture, and no implementation words (WebGPU, XPBD,
`.vtry`); link to the Developers tab when one is unavoidable.

A folder's entries follow its `meta.json`: `"---Reference---"` is a section heading, `"...folder"`
lists a subfolder's pages flat under the current heading, and a plain `"folder"` shows it as a
collapsible entry instead (its own `meta.json` gives its title, icon and order). An `icon` (in the front matter, or `"icon"` in a folder's `meta.json`)
shows in the sidebar, and `<Card icon="Rocket" …>` puts one on a card: a Lucide name listed in [src/lib/icons.ts](src/lib/icons.ts) (add it
there first), or an image under `public/` such as `/icons/supabase.svg` for a logo. The build
fails on any other value. Fumadocs' components (`<Callout>`, `<Cards>`/`<Card>`, tabs on code
blocks) work without imports.
