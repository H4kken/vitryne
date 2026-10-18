// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Without an account a new project replaces the draft: asked before it is. */
export function ReplaceDraftDialog({
  name,
  onAnswer,
  onAccount,
}: {
  /** The draft's name while asking, else null. */
  name: string | null;
  onAnswer: (go: boolean) => void;
  /** Create an account instead (then the new project doesn't replace the draft). */
  onAccount: () => void;
}) {
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(open) => !open && onAnswer(false)}
    >
      <DialogContent className="rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Replace your draft?
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            Without an account you keep one project. Your draft, {name}, is
            replaced as soon as you change the new one. Create a free account to
            keep both.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onAccount}>
            Create an account
          </Button>
          <Button onClick={() => onAnswer(true)}>Replace my draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
