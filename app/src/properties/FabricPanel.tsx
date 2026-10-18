// SPDX-License-Identifier: AGPL-3.0-or-later
// The Fabric panel: the project's fabrics, each a kind (how it hangs) and a colour (how it
// looks). Make one from a preset, or copy one from another project; the Pieces panel then gives
// fabrics to pieces. Every change goes through a command (document/commands.ts).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectFabric } from "@/cloud/fabrics";
import {
  addFabric,
  applyCommand,
  applyFabricPreset,
  deleteFabric,
  type FabricField,
  fabricColor,
  fabricName,
  fabricUse,
  fabricValue,
  importFabric,
  mergeCommands,
  renameFabric,
  setDefaultFabric,
  setFabricColor,
  setFabricValue,
  setPieceFabric,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { COLOR_SWATCHES, DEFAULT_CLOTH_COLOR } from "@/format/colors";
import {
  COTTON_JERSEY,
  FABRIC_PRESETS,
  matchingPreset,
} from "@/format/presets";
import type { Fabric, Garment } from "@/format/schema.gen";
import { ColorField, NumberField, TextField } from "./fields";

/** Which part of the panel shows. `forPiece`: a new fabric is for that piece (from Pieces). */
export type FabricView =
  | { kind: "list" }
  | { kind: "new"; forPiece?: { id: string; name: string } }
  | { kind: "fabric"; id: string }
  | { kind: "import" };

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
  // Stored in N/m (FORMAT.md), shown in kN/m: a woven's are in the thousands, not the millions.
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

/** What each preset is like, in a few words. */
const KIND_HINTS: Record<string, string> = {
  "Cotton jersey": "T-shirts: soft, follows the body",
  Denim: "Jeans: heavy, stands away in folds",
  "Poplin (shirting)": "Shirts: light, crisp small folds",
  Fleece: "Sweatshirts: thick, rounded folds",
  "Wool suiting": "Tailoring: fluid, clean creases",
};

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground m-0 text-sm leading-snug">{children}</p>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground m-0 text-[13px] font-semibold tracking-[0.06em] uppercase">
      {children}
    </h3>
  );
}

function Back({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
    >
      {children}
    </button>
  );
}

function Swatch({
  color,
  size = "size-8",
}: {
  color: string | undefined;
  size?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${size} shrink-0 rounded-full border border-black/10`}
      style={{ background: color ?? DEFAULT_CLOTH_COLOR }}
    />
  );
}

/** The kind and weight of a fabric, in a few words. */
function kindLine(f: Fabric): string {
  const kind = matchingPreset(f)?.name ?? `Custom ${f.category}`;
  return `${kind} · ${Math.round(f.density * 1000)} g/m²`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function FabricPanel(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  view: FabricView;
  onView: (v: FabricView) => void;
  /** Gives the new fabric to the piece it was made for, then shows that piece. */
  onMadeForPiece: () => void;
  /** The fabrics of the person's other projects; null without an account. */
  loadOthers: (() => Promise<ProjectFabric[]>) | null;
}) {
  const { view } = props;
  if (view.kind === "new")
    return <NewFabric {...props} forPiece={view.forPiece} />;
  if (view.kind === "import") return <FromProjects {...props} />;
  if (view.kind === "fabric") {
    const f = props.entities.fabrics.find((x) => x.id === view.id);
    if (f) return <FabricDetails {...props} fabric={f} />;
  }
  return <FabricList {...props} />;
}

function FabricList(props: {
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
                className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[#F4F5F2]"
              >
                <Swatch color={fabricColor(e, f)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">
                      {f.name}
                    </span>
                    {g?.fabric === f.id && (
                      <span className="shrink-0 rounded-full bg-[#E1E4DE] px-2 py-0.5 text-[11px] font-medium">
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

function NewFabric(props: {
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
      <Back onClick={() => props.onView({ kind: "list" })}>All fabrics</Back>
      <h3 className="font-display m-0 text-lg font-semibold">
        {forPiece ? `New fabric for ${forPiece.name}` : "New fabric"}
      </h3>
      <div className="flex flex-col gap-2">
        <Heading>Kind</Heading>
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
                    ? "border-[#14181F] bg-[#14181F] text-white"
                    : "border-[#E1E4DE] bg-white hover:border-[#B5B9B0]"
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-[14px] font-semibold">{p.name}</span>
                  <span
                    className={`text-[11px] ${on ? "text-white/70" : "text-muted-foreground"}`}
                  >
                    {Math.round(p.density * 1000)} g/m²
                  </span>
                </span>
                <span
                  className={`text-[12px] ${on ? "text-white/80" : "text-muted-foreground"}`}
                >
                  {KIND_HINTS[p.name] ?? p.category}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Heading>Colour</Heading>
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
          className="h-11 rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-card px-3 text-[15px]"
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

function FabricDetails(props: {
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
      <Back onClick={() => props.onView({ kind: "list" })}>All fabrics</Back>
      <div className="flex items-center gap-3">
        <Swatch color={fabricColor(e, f)} size="size-10" />
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
            className="h-11 w-full rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white text-[15px]"
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

function FromProjects(props: {
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
      <Intro>
        With a free account you keep several projects, and every fabric you make
        can be used again in the others.
      </Intro>
    );
  else if (found === null) body = <Intro>Looking through your projects…</Intro>;
  else if (typeof found === "string")
    body = <Intro>Your projects couldn't be read: {found}</Intro>;
  else if (found.length === 0)
    body = (
      <Intro>
        Your other projects have no fabric this one doesn't have already.
      </Intro>
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
        <Heading>{project}</Heading>
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((src) => {
            const isAdded = added.has(src);
            return (
              <li
                key={src.fabric.id}
                className="flex items-center gap-3 py-1.5"
              >
                <Swatch color={src.appearance?.color} />
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
      <Back onClick={() => props.onView({ kind: "list" })}>All fabrics</Back>
      <h3 className="font-display m-0 text-lg font-semibold">
        From my projects
      </h3>
      {body}
    </div>
  );
}
