// SPDX-License-Identifier: AGPL-3.0-or-later

import { CircleHelp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FEEDBACK_URL, REPO_URL } from "@/links";

/** Feedback, the source code and the privacy policy, in the top bar and on the start screen. */
export function HelpMenu(props: { privacyPolicy: string | null }) {
  const links: [string, string][] = [
    ["Send feedback or report a bug", FEEDBACK_URL],
    ["Source code", REPO_URL],
  ];
  if (props.privacyPolicy) links.push(["Privacy policy", props.privacyPolicy]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Help and feedback">
          <CircleHelp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {links.map(([label, href]) => (
          <DropdownMenuItem key={href} asChild>
            <a href={href} target="_blank" rel="noreferrer">
              <span className="grow">{label}</span>
              <ExternalLink />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
