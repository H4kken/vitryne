// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectSummary } from "./backend";
import { deleteProject, duplicateProject, fetchAhead } from "./projects";
import type { Cloud } from "./useCloud";
import { errorMessage } from "./errorMessage";
import { formatBytes } from "./formatBytes";

/** The person's projects: open, duplicate (an account), delete. */
export function CloudProjectList(props: {
  cloud: Cloud;
  projects: ProjectSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = props.cloud.user && !props.cloud.user.anonymous;

  const duplicate = async (p: ProjectSummary) => {
    setWorking(p.id);
    setError(null);
    try {
      await duplicateProject(await props.cloud.backend(), p.id);
      props.cloud.refresh();
    } catch (e) {
      setError(`Could not duplicate ${p.name}: ${errorMessage(e)}`);
    } finally {
      setWorking(null);
    }
  };

  const remove = async (p: ProjectSummary) => {
    setWorking(p.id);
    setError(null);
    try {
      await deleteProject(await props.cloud.backend(), p.id);
      props.cloud.refresh();
    } catch (e) {
      setError(`Could not delete ${p.name}: ${errorMessage(e)}`);
    } finally {
      setWorking(null);
      setConfirm(null);
    }
  };

  if (!props.projects.length)
    return (
      <p className="text-muted-foreground m-0 text-sm">
        No projects yet. Change an example or import a pattern, and it is saved
        here.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {props.projects.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <button
              type="button"
              disabled={props.busy || working !== null}
              onClick={() => props.onOpen(p.id)}
              // Pointing at a project starts its download, so the click opens it sooner.
              onPointerEnter={() =>
                void props.cloud.backend().then(
                  (b) => fetchAhead(b, p.id),
                  () => undefined,
                )
              }
              onFocus={() =>
                void props.cloud.backend().then(
                  (b) => fetchAhead(b, p.id),
                  () => undefined,
                )
              }
              className="flex min-w-0 grow flex-col text-left disabled:opacity-60"
            >
              <span className="truncate text-[15px] font-semibold">
                {p.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {new Date(p.updatedAt).toLocaleString()} ·{" "}
                {formatBytes(p.bytes)}
              </span>
            </button>
            {confirm === p.id ? (
              <>
                <span className="text-sm">Delete for good?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={working !== null}
                  onClick={() => void remove(p)}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm(null)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy || working !== null}
                  onClick={() => props.onOpen(p.id)}
                >
                  Open
                </Button>
                {account && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Duplicate ${p.name}`}
                    disabled={working !== null}
                    onClick={() => void duplicate(p)}
                  >
                    <Copy className="size-4" />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${p.name}`}
                  disabled={working !== null}
                  onClick={() => setConfirm(p.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
