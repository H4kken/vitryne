// SPDX-License-Identifier: AGPL-3.0-or-later
// The React island that draws a page: Fumadocs' provider, docs layout (sidebar, nav) and page
// (table of contents). Light, dark, or the system's setting (the default), remembered by
// next-themes; layout.astro keeps the choice across client-side navigations.
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import type { Root } from "fumadocs-core/page-tree";
import type { ReactNode } from "react";
import { navigate } from "astro:transitions/client";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import { defineI18nUI } from "fumadocs-ui/i18n";
import { i18n, languageNames } from "@/lib/i18n";
import SearchDialog from "./search";

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
        tree={tree}
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
        links={[{ text: "Open the editor", url: "https://vitryne.app" }]}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
