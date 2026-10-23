// SPDX-License-Identifier: AGPL-3.0-or-later
// Search in the browser over the static index `pages/api/search.ts` writes at build time: no
// search service, no requests but that one file. It searches the current language's pages, in
// the current tab (lib/tabs.ts) to begin with; the footer switches tab, or all tabs when the
// selected one is clicked again.
import { useState } from "react";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  TagsList,
  TagsListItem,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useStaticSearch } from "fumadocs-core/search/client";
import { usePathname } from "fumadocs-core/framework";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { tabOfUrl, tabs } from "@/lib/tabs";

export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const [tag, setTag] = useState<string | undefined>(tabOfUrl(usePathname()));
  const search = useStaticSearch({ locale, tag });

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
        <SearchDialogFooter>
          <TagsList tag={tag} onTagChange={setTag} allowClear>
            {tabs.map((tab) => (
              <TagsListItem key={tab.tag} value={tab.tag}>
                {tab.label}
              </TagsListItem>
            ))}
          </TagsList>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}
