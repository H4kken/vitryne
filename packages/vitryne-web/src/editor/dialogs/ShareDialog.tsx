// SPDX-License-Identifier: AGPL-3.0-or-later
// Dialog to share a project by link. Every project is private; turning sharing on makes its own
// address, /design/<id>, open for anyone who has it, view only (they can make a copy of their
// own). Turning it off ends that at once. The switch is saved when it is flipped.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { shareUrl } from "@/cloud/projects";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** The saved project; null while the document isn't in the cloud yet. */
  projectId: string | null;
  /** Whether the link is on now. */
  shared: boolean;
  /** Turns the link on or off; throws what went wrong. */
  setShared: (shared: boolean) => Promise<void>;
}

export function ShareDialog({
  open,
  onOpenChange,
  projectName,
  projectId,
  shared,
  setShared,
}: ShareDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = projectId ? shareUrl(projectId) : "";

  const flip = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setShared(on);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: the field is there to select and copy by hand.
      setError("Could not copy; select the link and copy it.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] rounded-2xl bg-card p-6 shadow-xl">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="font-display text-xl font-semibold">
            Share
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-[14px]">
            {projectName} is private. Turn on the link to let anyone you send it
            to look at it in 3D.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center justify-between rounded-xl bg-hover px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor="share-link"
                className="cursor-pointer text-[14px] font-medium"
              >
                Anyone with the link can view
              </Label>
              <span className="text-muted-foreground text-[12px]">
                {shared ? "Shared" : "Private: only you can open it"}
              </span>
            </div>
            <Switch
              id="share-link"
              checked={shared}
              disabled={busy || !projectId}
              onCheckedChange={(on) => void flip(on)}
            />
          </div>

          {shared && (
            <div className="flex gap-2">
              <Input
                readOnly
                aria-label="Share link"
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={() => void copy()} className="min-w-20">
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}

          <div className="rounded-xl border border-border bg-hover p-3.5 text-[13px] leading-relaxed text-body-text">
            <p className="m-0">
              People with the link see the project as it is saved, with its
              fabrics, and can drape it and look around. They can&apos;t change
              yours; they can make a copy of their own. Turn the link off and it
              stops working at once. Anyone who has the link can also get the
              project&apos;s files, so don&apos;t share what must stay secret.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 flex flex-row justify-end gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
