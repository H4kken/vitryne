// SPDX-License-Identifier: AGPL-3.0-or-later
// The person's projects on the start screen, as cards: a thumbnail of the drape (the project's
// own image, made by the editor once a drape settled), the name and when it was last edited.
// A click opens the project; the ⋯ menu, or a right click on the card, opens it (here or in a
// new tab), renames, duplicates and exports (an account) or deletes it. An anonymous user's one draft is a card like any other.

import { Fragment, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectSummary } from "./backend";
import {
  deleteProject,
  duplicateProject,
  fetchAhead,
  fileName,
  projectZip,
  renameProject,
} from "./projects";
import type { Cloud } from "./useCloud";
import { errorMessage } from "./errorMessage";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { RenameField } from "./RenameField";
import { editedAgo } from "./editedAgo";

export function ProjectGrid(props: {
  cloud: Cloud;
  projects: ProjectSummary[];
  title: string;
  /** Shown under the title (an anonymous user's one draft). */
  note?: React.ReactNode;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const { cloud } = props;
  const [sort, setSort] = useState<"edited" | "name">("edited");
  const account = !!cloud.user && !cloud.user.anonymous;
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const renameField = useRef<HTMLInputElement | null>(null);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  const [focusRename, setFocusRename] = useState(false);

  const act = async (
    p: ProjectSummary,
    what: string,
    run: () => Promise<void>,
  ) => {
    setWorking(p.id);
    setError(null);
    try {
      await run();
      cloud.refresh();
    } catch (e) {
      setError(`Could not ${what} ${p.name}: ${errorMessage(e)}`);
    } finally {
      setWorking(null);
    }
  };
  const exportFile = (p: ProjectSummary) =>
    act(p, "export", async () => {
      const z = await projectZip(await cloud.backend(), p.id);
      const url = URL.createObjectURL(
        new Blob([z.bytes], { type: "application/vnd.vitryne.project+zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(z.name, new Set());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  /** What the ⋯ menu and the right-click menu offer for `p`. */
  const entries = (p: ProjectSummary) => {
    const items: {
      label: string;
      icon: React.ReactNode;
      onSelect: () => void;
      destructive?: boolean;
      /** A separator comes first. */
      apart?: boolean;
    }[] = [
      {
        label: "Open",
        icon: <FolderOpen />,
        onSelect: () => props.onOpen(p.id),
      },
      {
        label: "Open in a new tab",
        icon: <ExternalLink />,
        onSelect: () =>
          void window.open(`/design/${p.id}`, "_blank", "noopener"),
      },
      {
        label: "Rename",
        icon: <Pencil />,
        onSelect: () => {
          setFocusRename(true);
          setRenaming(p.id);
        },
      },
    ];
    // An anonymous user keeps one project: nothing to duplicate into, nothing to export.
    if (account)
      items.push(
        {
          label: "Duplicate",
          icon: <Copy />,
          onSelect: () =>
            void act(
              p,
              "duplicate",
              async () =>
                void (await duplicateProject(await cloud.backend(), p.id)),
            ),
        },
        {
          label: "Export (.vtry)",
          icon: <Download />,
          onSelect: () => void exportFile(p),
        },
      );
    items.push({
      label: "Delete…",
      icon: <Trash2 />,
      onSelect: () => setDeleting(p),
      destructive: true,
      apart: true,
    });
    return items;
  };
  /** Rename was picked: once the menu has closed, the focus goes to the name field. */
  const afterClose = (e: Event) => {
    if (!focusRename) return;
    setFocusRename(false);
    e.preventDefault();
    renameField.current?.focus();
  };

  const list =
    sort === "name"
      ? [...props.projects].sort((a, b) => a.name.localeCompare(b.name))
      : props.projects;
  return (
    <section aria-label={props.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <h2 className="font-display m-0 grow text-[22px] font-semibold">
          {props.title}
        </h2>
        {props.projects.length > 1 && (
          <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
            Sort by
            <span className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "edited" | "name")}
                // The browser's own arrow sits against the edge: draw one with room.
                className="text-foreground appearance-none rounded-lg border border-border-strong bg-card py-1 pr-8 pl-3 text-sm font-medium"
              >
                <option value="edited">Last edited</option>
                <option value="name">Name</option>
              </select>
              <ChevronDown
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
              />
            </span>
          </label>
        )}
      </div>
      {props.note}
      {!props.projects.length && (
        <p className="text-muted-foreground m-0 rounded-2xl border border-dashed border-border-strong px-5 py-8 text-center text-[15px]">
          Your projects will appear here. Start from an example or import a
          pattern: it is saved as soon as you change it.
        </p>
      )}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-0">
        {list.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger
              asChild
              // Ctrl-click on a Mac is a right click too; a busy card has no menu.
              onContextMenu={(e) => {
                if (working !== null) e.preventDefault();
              }}
            >
              <li className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[transform,box-shadow] duration-150 focus-within:shadow-[0_10px_24px_rgba(20,24,31,.10)] hover:-translate-y-[3px] hover:shadow-[0_10px_24px_rgba(20,24,31,.10)]">
                <button
                  type="button"
                  aria-label={`Open ${p.name}`}
                  disabled={props.busy || working === p.id}
                  onClick={() => props.onOpen(p.id)}
                  // Pointing at a project starts its download, so the click opens it sooner.
                  onPointerEnter={() =>
                    void cloud.backend().then(
                      (b) => fetchAhead(b, p.id),
                      () => undefined,
                    )
                  }
                  onFocus={() =>
                    void cloud.backend().then(
                      (b) => fetchAhead(b, p.id),
                      () => undefined,
                    )
                  }
                  className="block cursor-pointer outline-none disabled:cursor-default disabled:opacity-60"
                >
                  <ProjectThumbnail cloud={cloud} sha={p.thumbnail} />
                </button>
                <div className="flex items-start gap-1 px-4 pt-3 pb-3.5">
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    {renaming === p.id ? (
                      <RenameField
                        ref={renameField}
                        name={p.name}
                        onDone={(name) => {
                          setRenaming(null);
                          if (name && name !== p.name)
                            void act(p, "rename", async () =>
                              renameProject(await cloud.backend(), p.id, name),
                            );
                        }}
                      />
                    ) : (
                      <span
                        className="truncate text-[15px] font-semibold"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {working === p.id ? "Working…" : editedAgo(p.updatedAt)}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`More for ${p.name}`}
                        disabled={working !== null}
                        className="-mr-1.5 shrink-0"
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-52"
                      onCloseAutoFocus={afterClose}
                    >
                      {entries(p).map((m) => (
                        <Fragment key={m.label}>
                          {m.apart && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            variant={m.destructive ? "destructive" : "default"}
                            onSelect={m.onSelect}
                          >
                            {m.icon} {m.label}
                          </DropdownMenuItem>
                        </Fragment>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52" onCloseAutoFocus={afterClose}>
              {entries(p).map((m) => (
                <Fragment key={m.label}>
                  {m.apart && <ContextMenuSeparator />}
                  <ContextMenuItem
                    variant={m.destructive ? "destructive" : "default"}
                    onSelect={m.onSelect}
                  >
                    {m.icon} {m.label}
                  </ContextMenuItem>
                </Fragment>
              ))}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </ul>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent
          className="rounded-[20px] p-6"
          // Enter confirms: the dialog starts on Delete, not on the first button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            deleteButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              Delete {deleting?.name}?
            </DialogTitle>
            <DialogDescription className="text-body-text text-[15px]">
              It is deleted for good, in every browser. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              ref={deleteButton}
              variant="destructive"
              onClick={() => {
                const p = deleting;
                setDeleting(null);
                if (p)
                  void act(p, "delete", async () =>
                    deleteProject(await cloud.backend(), p.id),
                  );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
