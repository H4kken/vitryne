// SPDX-License-Identifier: AGPL-3.0-or-later
// The React island that draws a page: Fumadocs' provider, docs layout (sidebar, nav) and page
// (table of contents). Light, dark, or the system's setting (the default), remembered by
// next-themes; layout.astro keeps the choice across client-side navigations.
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import type { Node, Root } from "fumadocs-core/page-tree";
import type { ReactNode } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import { navigate } from "astro:transitions/client";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import { defineI18nUI } from "fumadocs-ui/i18n";
import { i18n, languageNames } from "@/lib/i18n";
import SearchDialog from "./search";
import { Icon } from "./icon";

// Fumadocs' own labels ("Search", "On this page"...) come in English; another language gives
// its translations here next to its name.
const i18nUI = defineI18nUI(
  i18n,
  Object.fromEntries(
    Object.entries(languageNames).map(([code, displayName]) => [
      code,
      { displayName },
    ]),
  ),
);

/** The tree with its icon names (front matter, meta.json) turned into icons. */
function withIcons<T extends Root | Node>(node: T): T {
  const out: Record<string, unknown> = { ...node };
  if ("icon" in node && typeof node.icon === "string")
    out.icon = <Icon name={node.icon} />;
  if ("index" in node && node.index) out.index = withIcons(node.index);
  if ("children" in node) out.children = node.children.map(withIcons);
  return out as T;
}

export function Docs({
  tree,
  lang,
  children,
  pathname,
  params,
  page,
}: {
  tree: Root;
  lang: string;
  children: ReactNode;
  pathname: string;
  params: AstroProviderProps["params"];
  page?: DocsPageProps;
}) {
  return (
    <RootProvider
      pathname={pathname}
      params={params}
      navigate={navigate}
      theme={{ defaultTheme: "system", enableSystem: true }}
      search={{ SearchDialog }}
      i18n={i18nUI.provider(lang)}
    >
      <DocsLayout
        tree={withIcons(tree)}
        themeSwitch={{ mode: "light-dark-system" }}
        nav={{
          title: (
            <>
              <img src="/vitryne-logo-192.png" alt="" width={24} height={24} />
              <span className="font-display font-semibold">Vitryne</span>
            </>
          ),
        }}
        githubUrl="https://github.com/H4kken/vitryne"
        links={[
          {
            // Opens in a new tab (Fumadocs does for absolute URLs); the icon says so.
            text: (
              <span className="flex flex-1 items-center justify-between gap-1.5">
                Open the editor
                <SquareArrowOutUpRight aria-hidden />
              </span>
            ),
            url: "https://vitryne.app",
          },
        ]}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
