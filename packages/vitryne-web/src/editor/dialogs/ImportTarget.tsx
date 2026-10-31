// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";

/** With a project open: do the pieces join it, or make a new project? */
export function ImportTarget(props: {
  projectName: string;
  busy: boolean;
  onChoose: (into: "new" | "add") => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button disabled={props.busy} onClick={() => props.onChoose("add")}>
        Add the pieces to {props.projectName}
      </Button>
      <Button
        variant="outline"
        disabled={props.busy}
        onClick={() => props.onChoose("new")}
      >
        Create a new project
      </Button>
    </div>
  );
}
