// SPDX-License-Identifier: AGPL-3.0-or-later
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyFabricPreset,
  deleteFabric,
  type FabricField,
  fabricColor,
  fabricUse,
  fabricValue,
  renameFabric,
  setDefaultFabric,
  setFabricColor,
  setFabricValue,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { FABRIC_PRESETS, matchingPreset } from "@/format/presets";
import type { Fabric, Garment } from "@/format/schema.gen";
import type { FabricView } from "../FabricPanel";
import { FabricBack } from "./FabricBack";
import { FabricSwatch } from "./FabricSwatch";
import { count } from "./count";
import { TextField } from "../TextField";
import { ColorField } from "../ColorField";
import { NumberField } from "../NumberField";

const FABRIC_UI: {
  field: FabricField;
  label: string;
  unit: string;
  ends: [string, string];
  scale?: number;
  min: number;
  max: number;
  log?: boolean;
  step?: number;
}[] = [
  {
    field: "density",
    label: "Weight",
    unit: "g/m²",
    ends: ["Light", "Heavy"],
    scale: 1000,
    min: 30,
    max: 600,
  },
  {
    field: "thickness",
    label: "Thickness",
    unit: "mm",
    ends: ["Thin", "Thick"],
    min: 0.1,
    max: 5.0,
    step: 0.05,
  },
  // Stored in N/m (file-format.md), shown in kN/m: a woven's are in the thousands, not the millions.
  {
    field: "stretchWarp",
    label: "Stretch along the grain",
    unit: "kN/m",
    ends: ["Stretchy", "Firm"],
    scale: 1e-3,
    min: 0.1,
    max: 2000,
    log: true,
  },
  {
    field: "stretchWeft",
    label: "Stretch across the grain",
    unit: "kN/m",
    ends: ["Stretchy", "Firm"],
    scale: 1e-3,
    min: 0.1,
    max: 2000,
    log: true,
  },
  // Shear: how much the weave gives when pulled diagonally.
  {
    field: "stretchShear",
    label: "Stretch on the bias",
    unit: "kN/m",
    ends: ["Stretchy", "Firm"],
    scale: 1e-3,
    min: 0.01,
    max: 2000,
    log: true,
  },
  {
    field: "bendingWarp",
    label: "Stiffness along the grain",
    unit: "µN·m",
    ends: ["Drapey", "Stiff"],
    scale: 1e6,
    min: 0.1,
    max: 1000,
    log: true,
  },
  {
    field: "bendingWeft",
    label: "Stiffness across the grain",
    unit: "µN·m",
    ends: ["Drapey", "Stiff"],
    scale: 1e6,
    min: 0.1,
    max: 1000,
    log: true,
  },
  {
    field: "friction",
    label: "Grip on the body",
    unit: "",
    ends: ["Slides", "Grips"],
    min: 0,
    max: 1.5,
  },
];

export function FabricDetails(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  fabric: Fabric;
  onView: (v: FabricView) => void;
}) {
  const { store, entities: e, garment: g, fabric: f } = props;
  const use = fabricUse(e, f.id);
  const kind = matchingPreset(f);
  const colorKey = `fabric-color:${f.id}`;
  return (
    <div className="flex flex-col gap-5">
      <FabricBack onClick={() => props.onView({ kind: "list" })}>
        All fabrics
      </FabricBack>
      <div className="flex items-center gap-3">
        <FabricSwatch color={fabricColor(e, f)} size="size-10" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[17px] font-semibold">{f.name}</span>
          <span className="text-muted-foreground text-[13px]">
            {g?.fabric === f.id
              ? "The garment's fabric"
              : use.cuts
                ? `Used by ${count(use.cuts, "piece", "pieces")}`
                : "No piece uses it yet"}
          </span>
        </div>
      </div>
      <TextField
        label="Name"
        value={f.name}
        onCommit={(v) => store.execute((x) => renameFabric(x, f.id, v))}
      />
      <ColorField
        label="Colour"
        value={fabricColor(e, f)}
        shown={DEFAULT_CLOTH_COLOR}
        onPick={(c, dragging) => {
          if (dragging) store.beginGesture(colorKey);
          else store.endGesture();
          store.execute((x) => setFabricColor(x, f.id, c));
        }}
        onDragEnd={() => store.endGesture()}
      />
      <div className="flex flex-col gap-1.5">
        <Label className="text-sm font-semibold">Kind</Label>
        <Select
          value={kind?.id ?? "custom"}
          onValueChange={(id) => {
            const p = FABRIC_PRESETS.find((x) => x.id === id);
            if (p) store.execute((x) => applyFabricPreset(x, f.id, p));
          }}
        >
          <SelectTrigger
            aria-label="Kind"
            className="h-11 w-full rounded-[10px] border-[1.5px] border-border-strong bg-card text-[15px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FABRIC_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} ({Math.round(p.density * 1000)} g/m²)
              </SelectItem>
            ))}
            {!kind && (
              <SelectItem value="custom" disabled>
                Custom (fine tuned)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      {g && g.fabric !== f.id && (
        <Button
          variant="outline"
          onClick={() => store.execute((x) => setDefaultFabric(x, g.id, f.id))}
        >
          Use it for the whole garment
        </Button>
      )}
      <details className="border-t pt-4">
        <summary className="cursor-pointer text-[15px] font-semibold">
          Fine tune
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          {FABRIC_UI.map((u) => (
            <NumberField
              key={u.field}
              {...u}
              value={fabricValue(f, u.field)}
              onChange={(v, dragging) => {
                if (dragging) store.beginGesture(`fabric:${f.id}:${u.field}`);
                store.execute((x) => setFabricValue(x, f.id, u.field, v));
              }}
              onDragEnd={() => store.endGesture()}
            />
          ))}
          {f.notes && (
            <div className="text-muted-foreground text-[13px] leading-snug">
              <span className="text-foreground font-semibold">
                About these values.{" "}
              </span>
              {f.notes}
            </div>
          )}
        </div>
      </details>
      {!use.garmentDefault && use.cuts === 0 && (
        <button
          type="button"
          onClick={() => {
            if (store.execute((x) => deleteFabric(x, f.id)))
              props.onView({ kind: "list" });
          }}
          className="text-destructive self-start text-sm underline underline-offset-4"
        >
          Delete this fabric
        </button>
      )}
    </div>
  );
}
