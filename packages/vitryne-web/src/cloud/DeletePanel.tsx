// SPDX-License-Identifier: AGPL-3.0-or-later

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeletePanel(props: {
  working: string | null;
  onExport: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      <p className="bg-danger-soft text-danger-soft-foreground m-0 rounded-xl px-3.5 py-3">
        This deletes your account and every project stored with it, for good.
        Files you exported are not touched.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={!!props.working}
        onClick={props.onExport}
      >
        <Download /> Download everything first
      </Button>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={props.onKeep}>
          Keep my account
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={!!props.working}
          onClick={props.onDelete}
        >
          {props.working ?? "Delete everything"}
        </Button>
      </div>
    </div>
  );
}
