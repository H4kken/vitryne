// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { fabricColor, fabricUse } from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { Garment } from "@/format/schema.gen";
import type { FabricView } from "../FabricPanel";
import { FabricSwatch } from "./FabricSwatch";
import { kindLine } from "./kindLine";
import { count } from "./count";

export function FabricList(props: {
  entities: Entities;
  garment: Garment | undefined;
  onView: (v: FabricView) => void;
}) {
  const { entities: e, garment: g } = props;
  return (
    <div className="flex flex-col gap-5">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {e.fabrics.map((f) => {
          const use = fabricUse(e, f.id);
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => props.onView({ kind: "fabric", id: f.id })}
                className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-hover"
              >
                <FabricSwatch color={fabricColor(e, f)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">
                      {f.name}
                    </span>
                    {g?.fabric === f.id && (
                      <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-[11px] font-medium">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground truncate text-[13px]">
                    {kindLine(f)} ·{" "}
                    {use.cuts ? count(use.cuts, "piece", "pieces") : "unused"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Button onClick={() => props.onView({ kind: "new" })}>
          New fabric
        </Button>
        <Button
          variant="outline"
          onClick={() => props.onView({ kind: "import" })}
        >
          From my projects
        </Button>
      </div>
    </div>
  );
}
