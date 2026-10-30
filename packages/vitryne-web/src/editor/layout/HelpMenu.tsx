// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookOpen, CircleHelp, MessageSquareWarning } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GithubIcon } from "../icons/GithubIcon";
import { DOCS_URL, FEEDBACK_URL, REPO_URL } from "@/links";

/** The documentation, feedback and the source code, in the top bar and on the start screen. */
export function HelpMenu() {
  const links: [string, string, ComponentType][] = [
    ["Documentation", DOCS_URL, BookOpen],
    ["Send feedback or report a bug", FEEDBACK_URL, MessageSquareWarning],
    ["Source code", REPO_URL, GithubIcon],
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help and feedback">
          <CircleHelp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {links.map(([label, href, Icon]) => (
          <DropdownMenuItem key={href} asChild>
            <a href={href} target="_blank" rel="noreferrer">
              <span className="grow">{label}</span>
              <Icon />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
