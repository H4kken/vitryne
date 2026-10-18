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

/** The open project is open in another tab, which saves it: one tab at a time edits a project. */
export function BlockedDialog({
  files,
  doc,
}: {
  files: ReturnType<typeof useFiles>;
  doc: DocState;
}) {
  return (
    <Dialog open={!!files.blocked && !doc.empty}>
      <DialogContent
        className="rounded-[20px] p-6"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Open in another tab
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {files.blocked === "taken"
              ? `${doc.entities.project?.name ?? doc.fileName} was opened in another tab, which now saves it. Changes made here from now on wouldn't be saved.`
              : `${doc.entities.project?.name ?? doc.fileName} is open in another tab of this browser. One tab at a time edits a project.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => files.close()}>
            Close the project
          </Button>
          <Button onClick={() => void files.takeOver()}>
            Open here instead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
