// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  addFabric,
  applyCommand,
  fabricName,
  mergeCommands,
  setPieceFabric,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { COLOR_SWATCHES, DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { COTTON_JERSEY, FABRIC_PRESETS } from "@/format/presets";
import type { Fabric, Garment } from "@/format/schema.gen";
import type { FabricView } from "../FabricPanel";
import { FabricBack } from "./FabricBack";
import { PanelHeading } from "@/components/PanelHeading";
import { ColorField } from "../ColorField";

/** What each preset is like, in a few words. */
const KIND_HINTS: Record<string, string> = {
  "Cotton jersey": "T-shirts: soft, follows the body",
  Denim: "Jeans: heavy, stands away in folds",
  "Poplin (shirting)": "Shirts: light, crisp small folds",
  Fleece: "Sweatshirts: thick, rounded folds",
  "Wool suiting": "Tailoring: fluid, clean creases",
};

export function NewFabric(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  onView: (v: FabricView) => void;
  onMadeForPiece: () => void;
  forPiece?: { id: string; name: string };
}) {
  const [preset, setPreset] = useState<Fabric>(COTTON_JERSEY);
  const [color, setColor] = useState<string>(
    COLOR_SWATCHES[0]?.color ?? DEFAULT_CLOTH_COLOR,
  );
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? fabricName(color, preset);
  const { store, garment: g, forPiece } = props;

  const create = () => {
    const ids = {
      fabric: crypto.randomUUID(),
      appearance: crypto.randomUUID(),
    };
    const spec = { preset, color, name: shownName };
    const ok = store.execute((e) => {
      const add = addFabric(e, spec, ids);
      if (!forPiece || !g) return add;
      const use = setPieceFabric(
        applyCommand(e, add),
        g.id,
        forPiece.id,
        ids.fabric,
      );
      return {
        ...mergeCommands(add, use),
        label: `Add ${shownName} to ${forPiece.name}`,
      };
    });
    if (!ok) return;
    if (forPiece) props.onMadeForPiece();
    else props.onView({ kind: "fabric", id: ids.fabric });
  };

  return (
    <div className="flex flex-col gap-5">
      <FabricBack onClick={() => props.onView({ kind: "list" })}>
        All fabrics
      </FabricBack>
      <h3 className="font-display m-0 text-lg font-semibold">
        {forPiece ? `New fabric for ${forPiece.name}` : "New fabric"}
      </h3>
      <div className="flex flex-col gap-2">
        <PanelHeading>Kind</PanelHeading>
        <div
          role="radiogroup"
          aria-label="Kind"
          className="flex flex-col gap-1.5"
        >
          {FABRIC_PRESETS.map((p) => {
            const on = p.id === preset.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPreset(p)}
                className={`flex flex-col items-start rounded-[10px] border p-2.5 text-left transition-colors ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-line"
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-[14px] font-semibold">{p.name}</span>
                  <span
                    className={`text-[11px] ${on ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  >
                    {Math.round(p.density * 1000)} g/m²
                  </span>
                </span>
                <span
                  className={`text-[12px] ${on ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                >
                  {KIND_HINTS[p.name] ?? p.category}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <PanelHeading>Colour</PanelHeading>
        <ColorField
          label="Colour"
          value={color}
          shown={color}
          onPick={(c) => setColor(c)}
          onDragEnd={() => {}}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-fabric-name" className="text-sm font-semibold">
          Name
        </Label>
        <input
          id="new-fabric-name"
          className="h-11 rounded-[10px] border-[1.5px] border-border-strong bg-card px-3 text-[15px]"
          value={shownName}
          onChange={(ev) => setName(ev.target.value)}
        />
      </div>
      <Button onClick={create} disabled={shownName.trim() === ""}>
        {forPiece
          ? `Make it and use it for ${forPiece.name}`
          : "Make this fabric"}
      </Button>
    </div>
  );
}
