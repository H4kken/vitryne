// SPDX-License-Identifier: AGPL-3.0-or-later
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Under the top bar while someone else's shared project is open: it can be looked at and draped
 * but not changed, and "Make a copy" makes it the person's own.
 */
export function ViewOnlyBar({
  name,
  busy,
  onCopy,
}: {
  name: string;
  busy: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-hover px-4 py-2 text-[14px]"
    >
      <Eye className="text-muted-foreground size-4 shrink-0" />
      <span className="grow">
        You&apos;re viewing <strong>{name}</strong>, shared with you. It
        can&apos;t be changed, but you can drape it and look around.
      </span>
      <Button size="sm" onClick={onCopy} disabled={busy}>
        Make a copy
      </Button>
    </div>
  );
}
