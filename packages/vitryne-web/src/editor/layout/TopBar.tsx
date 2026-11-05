// SPDX-License-Identifier: AGPL-3.0-or-later
// The top bar: back to the start, the project's name and save state, undo and redo, which
// views show, help, the account and Export.

import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SaveStatus } from "@/cloud/autosave";
import type { Cloud } from "@/cloud/useCloud";
import { renameProject } from "@/document/commands";
import { type DocState, DocumentStore } from "@/document/store";
import { cn } from "@/lib/utils";
import { useFiles } from "../hooks/useFiles";
import { Logo } from "../icons/Logo";
import { UndoIcon } from "../icons/UndoIcon";
import { RedoIcon } from "../icons/RedoIcon";
import { FlatIcon } from "../icons/FlatIcon";
import { CubeIcon } from "../icons/CubeIcon";
import { CloudButton } from "./CloudButton";
import { HelpMenu } from "./HelpMenu";
import { ThemeMenu } from "./ThemeMenu";
import { ProjectName } from "./ProjectName";
import { MOD, SHIFT } from "@/lib/keys";
import { IconButton } from "./IconButton";
import type { SplitView } from "../hooks/useSplitView";

/** The title bar's save state. */
function saveStateText(s: SaveStatus, doc: DocState, inCloud: boolean): string {
  if (doc.empty) return "";
  if (doc.readOnly) return "View only";
  switch (s.kind) {
    case "saving":
      return "Saving…";
    case "offline":
      return "Not saved yet: changes kept in this browser, trying again";
    case "stopped":
      return "Not saved";
    case "waiting":
      return "Changes not saved yet";
    case "saved":
      return doc.dirty
        ? "Changes not saved yet"
        : inCloud
          ? "Saved"
          : "Not saved: change something to keep it";
  }
}

export function TopBar(props: {
  doc: DocState;
  store: DocumentStore;
  files: ReturnType<typeof useFiles>;
  view: SplitView;
  cloud: Cloud;
  onAccount: () => void;
  onShare: () => void;
  /** The Share button, which the Share panel opens under. */
  shareRef: RefObject<HTMLButtonElement | null>;
}) {
  const { doc, store, files, cloud, onAccount, onShare, shareRef } = props;
  const { show2d, show3d, toggle2d, toggle3d } = props.view;
  const saveState = files.busy
    ? `${files.busy}…`
    : saveStateText(files.saveStatus, doc, !!files.ref?.cloud);
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Back to start"
            onClick={() => files.close()}
            className="flex items-center rounded-lg"
          >
            <Logo />
          </button>
        </TooltipTrigger>
        <TooltipContent>Back to files</TooltipContent>
      </Tooltip>
      <span className="mx-1 h-6 w-px bg-chip" />
      {doc.entities.project && !doc.readOnly ? (
        <ProjectName
          name={doc.entities.project.name ?? doc.fileName}
          onRename={(v) => {
            if (store.execute((e) => renameProject(e, v))) {
              files.save();
            }
          }}
        />
      ) : (
        <span className="max-w-[40vw] truncate text-[15px] font-semibold">
          {doc.entities.project?.name ?? doc.fileName}
        </span>
      )}
      <span
        className={cn(
          "truncate text-[13px]",
          doc.dirty ? "text-foreground" : "text-muted-foreground",
        )}
        title={files.ref?.name}
      >
        {saveState}
      </span>
      <span className="grow" />
      <IconButton
        label={
          doc.undoLabel ? `Undo: ${doc.undoLabel} (${MOD}Z)` : "Nothing to undo"
        }
        disabled={!doc.undoLabel}
        onClick={() => store.undo()}
      >
        <UndoIcon />
      </IconButton>
      <IconButton
        label={
          doc.redoLabel
            ? `Redo: ${doc.redoLabel} (${SHIFT}${MOD}Z)`
            : "Nothing to redo"
        }
        disabled={!doc.redoLabel}
        onClick={() => store.redo()}
      >
        <RedoIcon />
      </IconButton>
      <div
        role="group"
        aria-label="Toggle views"
        className="flex items-center rounded-[10px] border border-input bg-card p-0.5"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={show2d ? "secondary" : "ghost"}
              size="icon-sm"
              className={cn(
                "size-9 rounded-md transition-all",
                show2d
                  ? "bg-secondary text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={show2d ? "Hide 2D pattern" : "Show 2D pattern"}
              aria-pressed={show2d}
              onClick={toggle2d}
            >
              <FlatIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {show2d ? "Hide 2D pattern" : "Show 2D pattern"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={show3d ? "secondary" : "ghost"}
              size="icon-sm"
              className={cn(
                "size-9 rounded-md transition-all",
                show3d
                  ? "bg-secondary text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={show3d ? "Hide 3D drape" : "Show 3D drape"}
              aria-pressed={show3d}
              onClick={toggle3d}
            >
              <CubeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {show3d ? "Hide 3D drape" : "Show 3D drape"}
          </TooltipContent>
        </Tooltip>
      </div>
      <ThemeMenu />
      <HelpMenu />
      <CloudButton user={cloud.user} onClick={onAccount} />
      <Button
        ref={shareRef}
        className="px-3.5 font-semibold shadow-xs"
        onClick={onShare}
        disabled={doc.empty || doc.readOnly}
        aria-label="Share"
      >
        <span>Share</span>
      </Button>
    </header>
  );
}
