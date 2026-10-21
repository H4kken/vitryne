// SPDX-License-Identifier: AGPL-3.0-or-later
// The person's projects on the start screen, as cards: a thumbnail of the drape (the project's
// own image, made by the editor once a drape settled), the name and when it was last edited.
// A click opens the project; the ⋯ menu renames, duplicates and exports (an account) or
// deletes it. An anonymous user's one draft is a card like any other.

import { useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Rename was picked: once the menu has closed, the focus goes to the name field. */
  const renameField = useRef<HTMLInputElement | null>(null);
  const toRename = useRef(false);

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
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "edited" | "name")}
              className="text-foreground rounded-lg border border-[#D5D9D1] bg-white px-2 py-1 text-sm font-medium"
            >
              <option value="edited">Last edited</option>
              <option value="name">Name</option>
            </select>
          </label>
        )}
      </div>
      {props.note}
      {!props.projects.length && (
        <p className="text-muted-foreground m-0 rounded-2xl border border-dashed border-[#D5D9D1] px-5 py-8 text-center text-[15px]">
          Your projects will appear here. Start from an example or import a
          pattern: it is saved as soon as you change it.
        </p>
      )}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-0">
        {list.map((p) => (
          <li
            key={p.id}
            className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E1E4DE] bg-white transition-[transform,box-shadow] duration-150 focus-within:shadow-[0_10px_24px_rgba(20,24,31,.10)] hover:-translate-y-[3px] hover:shadow-[0_10px_24px_rgba(20,24,31,.10)]"
          >
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
                  className="w-48"
                  onCloseAutoFocus={(e) => {
                    if (!toRename.current) return;
                    toRename.current = false;
                    e.preventDefault();
                    renameField.current?.focus();
                  }}
                >
                  <DropdownMenuItem onSelect={() => props.onOpen(p.id)}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      toRename.current = true;
                      setRenaming(p.id);
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  {account && (
                    <>
                      <DropdownMenuItem
                        onSelect={() =>
                          void act(
                            p,
                            "duplicate",
                            async () =>
                              void (await duplicateProject(
                                await cloud.backend(),
                                p.id,
                              )),
                          )
                        }
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void exportFile(p)}>
                        Export (.vtry)
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(p)}
                  >
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="m-0 text-sm text-[#8A2410]">
          {error}
        </p>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="rounded-[20px] p-6">
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
