// SPDX-License-Identifier: AGPL-3.0-or-later
// The link part of the Share panel, like Canva's: who can open the project (only you, or anyone
// with the link, view only) and a Copy link button. Every project is private; the link is the
// project's own address, /design/<id>. Switching it off ends it at once. The choice is saved
// when it is made.

import { useState } from "react";
import { Check, Globe, Link2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shareUrl } from "@/cloud/projects";
import { AccessItem } from "./AccessItem";

export interface LinkAccessProps {
  /** The saved project; null while the document isn't in the cloud yet. */
  projectId: string | null;
  /** Whether the link is on now. */
  shared: boolean;
  /** Turns the link on or off; throws what went wrong. */
  setShared: (shared: boolean) => Promise<void>;
}

export function LinkAccess({ projectId, shared, setShared }: LinkAccessProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const change = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await setShared(value === "link");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!projectId) return;
    try {
      await navigator.clipboard.writeText(shareUrl(projectId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link; open the project's address instead.");
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Link access">
      <span className="text-[13px] font-semibold">Access level</span>
      <Select
        value={shared ? "link" : "private"}
        onValueChange={(v) => void change(v)}
        disabled={busy || !projectId}
      >
        <SelectTrigger
          aria-label="Access level"
          className="h-12 w-full rounded-xl border-0 bg-hover px-3 text-[14px] dark:bg-hover dark:hover:bg-hover"
        >
          <SelectValue>
            <span className="flex items-center gap-3">
              {shared ? (
                <Globe className="size-5 text-foreground" />
              ) : (
                <Lock className="size-5 text-foreground" />
              )}
              {shared ? "Anyone with the link" : "Only you can open it"}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          sideOffset={6}
          className="w-(--radix-select-trigger-width) rounded-xl p-0 shadow-xl"
        >
          <AccessItem
            value="private"
            icon={<Lock className="size-5" />}
            title="Only you can open it"
          >
            Only you can open this project, signed in to your account.
          </AccessItem>
          <AccessItem
            value="link"
            icon={<Globe className="size-5" />}
            title="Anyone with the link"
          >
            Anyone can see it in 3D with this link, and make a copy of their
            own. <strong className="text-foreground">No account needed.</strong>
          </AccessItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        className="w-full gap-2 font-semibold"
        disabled={!shared || !projectId}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
        {copied ? "Link copied" : "Copy link"}
      </Button>
      {shared && (
        <p className="text-muted-foreground m-0 text-[12px] leading-relaxed">
          Turn the link off and it stops working at once. Anyone who has it can
          also get the project&apos;s files, so don&apos;t share what must stay
          secret.
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </section>
  );
}
