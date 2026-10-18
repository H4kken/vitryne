// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProjectFabric } from "@/cloud/fabrics";
import { importFabric } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import type { FabricView } from "../FabricPanel";
import { PanelIntro } from "@/components/PanelIntro";
import { PanelHeading } from "@/components/PanelHeading";
import { FabricSwatch } from "./FabricSwatch";
import { kindLine } from "./kindLine";
import { FabricBack } from "./FabricBack";

export function FromProjects(props: {
  store: DocumentStore;
  entities: Entities;
  onView: (v: FabricView) => void;
  loadOthers: (() => Promise<ProjectFabric[]>) | null;
}) {
  const { loadOthers, store } = props;
  const [found, setFound] = useState<ProjectFabric[] | string | null>(null);
  useEffect(() => {
    if (!loadOthers) return;
    let live = true;
    loadOthers().then(
      (f) => live && setFound(f),
      (err: unknown) =>
        live && setFound(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [loadOthers]);
  // What was added here, to show it as added (the list itself was found before).
  const [added, setAdded] = useState<Set<ProjectFabric>>(new Set());

  let body: React.ReactNode;
  if (!loadOthers)
    body = (
      <PanelIntro>
        With a free account you keep several projects, and every fabric you make
        can be used again in the others.
      </PanelIntro>
    );
  else if (found === null)
    body = <PanelIntro>Looking through your projects…</PanelIntro>;
  else if (typeof found === "string")
    body = <PanelIntro>Your projects couldn't be read: {found}</PanelIntro>;
  else if (found.length === 0)
    body = (
      <PanelIntro>
        Your other projects have no fabric this one doesn't have already.
      </PanelIntro>
    );
  else {
    const byProject = new Map<string, ProjectFabric[]>();
    for (const f of found)
      byProject.set(f.projectName, [
        ...(byProject.get(f.projectName) ?? []),
        f,
      ]);
    body = [...byProject].map(([project, list]) => (
      <div key={project} className="flex flex-col gap-1">
        <PanelHeading>{project}</PanelHeading>
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((src) => {
            const isAdded = added.has(src);
            return (
              <li
                key={src.fabric.id}
                className="flex items-center gap-3 py-1.5"
              >
                <FabricSwatch color={src.appearance?.color} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-semibold">
                    {src.fabric.name}
                  </span>
                  <span className="text-muted-foreground truncate text-[12px]">
                    {kindLine(src.fabric)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isAdded}
                  onClick={() => {
                    if (store.execute((x) => importFabric(x, src)))
                      setAdded(new Set(added).add(src));
                  }}
                >
                  {isAdded ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    ));
  }
  return (
    <div className="flex flex-col gap-5">
      <FabricBack onClick={() => props.onView({ kind: "list" })}>
        All fabrics
      </FabricBack>
      <h3 className="font-display m-0 text-lg font-semibold">
        From my projects
      </h3>
      {body}
    </div>
  );
}
