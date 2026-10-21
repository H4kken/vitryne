// SPDX-License-Identifier: AGPL-3.0-or-later
// The Settings panel the rail opens. Every change goes through a command (document/commands.ts)
// on the store.

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  renameProject,
  selfCollision,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { TextField } from "./TextField";
import { PanelHeading } from "@/components/PanelHeading";
import { NumberField } from "./NumberField";

export function SettingsPanel({
  store,
  entities,
}: {
  store: DocumentStore;
  entities: Entities;
}) {
  if (!entities.project) return null;
  return (
    <div className="flex flex-col gap-5">
      <TextField
        label="Project name"
        value={entities.project.name ?? ""}
        onCommit={(v) => store.execute((x) => renameProject(x, v))}
      />
      <div className="flex flex-col gap-5 border-t pt-4">
        <PanelHeading>Simulation</PanelHeading>
        <NumberField
          label="Detail"
          unit="points"
          ends={["Faster", "Finer"]}
          value={targetVertices(entities)}
          min={1000}
          max={40_000}
          step={500}
          integer
          onChange={(v, dragging) => {
            if (dragging) store.beginGesture("simulation:targetVertices");
            store.execute((x) => setTargetVertices(x, v));
          }}
          onDragEnd={() => store.endGesture()}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label
              htmlFor="self-collision"
              className="text-[15px] font-semibold"
            >
              Cloth against itself
            </Label>
            <span className="text-muted-foreground text-[13px] leading-snug">
              Layers can't pass through each other. Slower.
            </span>
          </div>
          <Switch
            id="self-collision"
            checked={selfCollision(entities)}
            onCheckedChange={(on) =>
              store.execute((x) => setSelfCollision(x, on))
            }
          />
        </div>
      </div>
    </div>
  );
}
