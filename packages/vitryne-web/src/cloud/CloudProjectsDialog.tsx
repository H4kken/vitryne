// SPDX-License-Identifier: AGPL-3.0-or-later
// The person's cloud projects, in a dialog (packages/vitryne-docs/content/docs/developers/cloud.md).

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Cloud } from "./useCloud";
import { CloudProjectList } from "./CloudProjectList";

export function CloudProjectsDialog(props: {
  cloud: Cloud;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const { cloud, open } = props;
  // `backend` and `refresh` are stable; `cloud` itself changes with every new list.
  const { backend, refresh } = cloud;
  useEffect(() => {
    if (open)
      void backend().then(
        () => refresh(),
        () => undefined,
      );
  }, [open, backend, refresh]);
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[560px] rounded-[20px] p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">
            Your projects
          </DialogTitle>
          <DialogDescription className="text-body-text text-[15px]">
            {!cloud.user
              ? "Nothing saved from this browser yet. Sign in to see the projects in your account."
              : cloud.user.anonymous
                ? "Without an account you keep one project, your draft. Create a free account to keep several."
                : "Open one, duplicate it, or delete it."}
          </DialogDescription>
        </DialogHeader>
        {cloud.user && cloud.projects && (
          <div className="max-h-[50vh] overflow-y-auto">
            <CloudProjectList
              cloud={cloud}
              projects={cloud.projects}
              busy={props.busy}
              onOpen={(id) => {
                props.onOpenChange(false);
                props.onOpen(id);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
