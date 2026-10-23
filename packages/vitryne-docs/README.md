# vitryne-docs

The documentation website: [Astro](https://astro.build) builds static pages and
[Fumadocs](https://fumadocs.dev) (React islands) draws the layout, sidebar, search and table of
contents. It uses the editor's look (colours and fonts from `packages/vitryne-web/src/index.css`).

| Path                                           | What                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [content/docs/](content/docs/)                 | The pages (`.mdx`, with `title` and `description` front matter) and `meta.json`, the sidebar order per folder.                                |
| [src/pages/](src/pages/)                       | `[...slug].astro` renders every page; `api/search.ts` writes the search index at build time; `og/docs/` makes each page's link-preview image. |
| [src/components/](src/components/)             | The HTML document (`layout.astro`), the Fumadocs island (`docs.tsx`), the search dialog.                                                      |
| [src/styles/global.css](src/styles/global.css) | Tailwind, Fumadocs' shadcn preset, the editor's colour tokens and fonts.                                                                      |

Search runs in the browser over that static index; the site makes no other requests.

The `.md` pages under `self-hosting/`, `reference/` and `development/` are copies of the
repository's `docs/*.md` (each says which at the top): the H1 became the `title`, links between
them became site URLs, and links into the repository point at GitHub. An edit to one side
isn't carried to the other.

## Run and check

From the repository root:

```sh
make docs-dev     # dev server on http://localhost:4321
make docs         # astro check, then the static build in packages/vitryne-docs/dist
make fmt          # prettier (with the Astro plugin) here too
```

`make check-ci` runs `make docs` and the docs' prettier check.

## Writing a page

Add `content/docs/<name>.mdx` with a `title` and a `description`, and list `<name>` in that
folder's `meta.json`. Fumadocs' components (`<Callout>`, `<Cards>`/`<Card>`, tabs on code
blocks) work without imports.
