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
import { type DocState } from "@/document/store";
import { useFiles } from "../hooks/useFiles";

/** Leaving a project whose latest changes didn't reach the cloud: try again, leave, or stay. */
export function UnsavedDialog({
  files,
  doc,
}: {
  files: ReturnType<typeof useFiles>;
  doc: DocState;
}) {
  return (
    <Dialog
      open={!!files.unsaved}
      onOpenChange={(open) => !open && files.unsaved?.cancel()}
    >
      <DialogContent className="rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Your latest changes aren't saved
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            The latest changes to {doc.entities.project?.name ?? doc.fileName}{" "}
            haven't reached the cloud (
            {files.saveStatus.kind === "offline" ||
            files.saveStatus.kind === "stopped"
              ? files.saveStatus.text
              : "not saved yet"}
            ). They are lost if you leave without them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => files.unsaved?.cancel()}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => files.unsaved?.discard()}>
            Leave without them
          </Button>
          <Button onClick={() => void files.unsaved?.save()}>Try again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
