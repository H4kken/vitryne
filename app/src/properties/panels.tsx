// SPDX-License-Identifier: AGPL-3.0-or-later
// The panels the rail opens: what the editor can change today, in plain words. Every change
// goes through a command (document/commands.ts) on the store.

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Cut, Fabric, Garment, Piece } from "@/format/schema.gen";
import {
  applyFabricPreset,
  type ColorTarget,
  cutColor,
  type FabricField,
  fabricValue,
  findCut,
  followers,
  garmentColor,
  pieceColor,
  renameCut,
  renameFabric,
  renamePiece,
  renameProject,
  renameSeam,
  selfCollision,
  setColor,
  setCutFabric,
  setFabricValue,
  setMirrored,
  setPieceFabric,
  setPlacement,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
import { FABRIC_PRESETS, findPreset, matchingPreset } from "@/format/presets";
import type { Selection } from "@/pattern/PatternPanel";
import { PlaceSelect } from "@/placement/PlaceSelect";
import {
  degrees,
  type Place,
  PLACES,
  placeOf,
  radians,
  tidy,
} from "@/placement/places";
import { DEFAULT_CLOTH_COLOR } from "@/format/colors";
import { ColorField, NumberField, TextField } from "./fields";

/** How far a piece placed on another sits off it, mm (Rust `import::ON_TOP_LIFT_MM`). */
export const ON_TOP_LIFT_MM = 12;

export type PanelId = "fabric" | "pieces" | "seams" | "settings";

export const PANEL_TITLES: Record<PanelId, string> = {
  fabric: "Fabric",
  pieces: "Pieces",
  seams: "Seams",
  settings: "Settings",
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

/** Picks a colour for the garment or a piece: a picker's drag is one undo step, a swatch one each. */
function pickColor(
  store: DocumentStore,
  garmentId: string,
  target: ColorTarget,
) {
  return (color: string | undefined, dragging = false) => {
    const key = `color:${garmentId}:${target.kind === "piece" ? target.pieceId : "garment"}`;
    if (dragging) store.beginGesture(key);
    else store.endGesture();
    store.execute((e) => setColor(e, garmentId, target, color));
  };
}

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

export function FabricPanel({
  store,
  entities,
  fabric: initialFabric,
  garment,
  fabrics,
}: {
  store: DocumentStore;
  entities: Entities;
  fabric: Fabric | undefined;
  garment?: Garment;
  fabrics?: readonly Fabric[];
}) {
  const [selectedFabricId, setSelectedFabricId] = useState<string | null>(null);
  const activeId = selectedFabricId ?? initialFabric?.id;
  const fabric = fabrics?.find((f) => f.id === activeId) ?? initialFabric;

  if (!fabric) return <Intro>This garment has no fabric.</Intro>;

  const activePreset = matchingPreset(fabric);

  const pick = garment && pickColor(store, garment.id, { kind: "garment" });
  return (
    <div className="flex flex-col gap-5">
      {garment && pick && (
        <div className="flex flex-col gap-3 border-b pb-5">
          <Heading>Colour</Heading>
          <Intro>
            How the whole garment looks. A piece can have its own colour too
            (Pieces). The colour doesn't change the drape.
          </Intro>
          <ColorField
            label="Garment colour"
            value={garmentColor(entities, garment)}
            shown={DEFAULT_CLOTH_COLOR}
            onPick={pick}
            onDragEnd={() => store.endGesture()}
            onReset={{ label: "Remove the colour", run: () => pick(undefined) }}
          />
        </div>
      )}
      <Intro>
        The fabric changes how it hangs, folds and stretches. Pick a physical
        preset or fine tune below.
      </Intro>

      {fabrics && fabrics.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Fabric to edit
          </Label>
          <Select
            value={fabric.id}
            onValueChange={(id) => setSelectedFabricId(id)}
          >
            <SelectTrigger className="h-10 w-full rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white text-[14px]">
              <SelectValue placeholder="Choose fabric" />
            </SelectTrigger>
            <SelectContent>
              {fabrics.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name} {f.id === garment?.fabric ? "(Default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Heading>Presets</Heading>
          {activePreset ? (
            <span className="rounded-full bg-[#E1E4DE] px-2 py-0.5 text-[11px] font-medium text-foreground">
              {activePreset.category}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              Custom
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {FABRIC_PRESETS.map((p) => {
            const isSelected = activePreset?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  store.execute((e) => applyFabricPreset(e, fabric.id, p))
                }
                className={`flex flex-col items-start rounded-[10px] border p-2.5 text-left transition-all ${
                  isSelected
                    ? "border-[#14181F] bg-[#14181F] text-white shadow-sm"
                    : "border-[#E1E4DE] bg-white hover:border-[#B5B9B0] hover:bg-[#F9FAF8]"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`text-[13px] font-semibold ${isSelected ? "text-white" : "text-foreground"}`}
                  >
                    {p.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-medium tracking-wide ${isSelected ? "text-white/70" : "text-muted-foreground"}`}
                  >
                    {p.category}
                  </span>
                </div>
                <span
                  className={`text-[11px] mt-0.5 ${isSelected ? "text-white/80" : "text-muted-foreground"}`}
                >
                  {Math.round(p.density * 1000)} g/m² ·{" "}
                  {p.thickness ? `${p.thickness} mm · ` : ""}
                  {p.friction > 0.35 ? "Sturdy" : "Soft"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t pt-4">
        <Heading>Fine tune</Heading>
        <TextField
          label="Name"
          value={fabric.name}
          onCommit={(v) => store.execute((e) => renameFabric(e, fabric.id, v))}
        />
        {FABRIC_UI.map((f) => (
          <NumberField
            key={f.field}
            {...f}
            value={fabricValue(fabric, f.field)}
            onChange={(v, dragging) => {
              if (dragging)
                store.beginGesture(`fabric:${fabric.id}:${f.field}`);
              store.execute((e) => setFabricValue(e, fabric.id, f.field, v));
            }}
            onDragEnd={() => store.endGesture()}
          />
        ))}
        {fabric.notes && (
          <details className="text-muted-foreground text-[13px] leading-snug">
            <summary className="text-foreground cursor-pointer font-semibold">
              About these values
            </summary>
            <p className="mt-1.5 mb-0">{fabric.notes}</p>
          </details>
        )}
      </div>
    </div>
  );
}

/** The height slider's range for a region, mm along its axis (torso and head: above the floor). */
function topRange(region: string | undefined): [number, number] {
  if (region === "torso") return [600, 1800];
  if (region === "head") return [1200, 2000];
  if (region?.startsWith("leg-")) return [200, 1400];
  return [-400, 400];
}

/** A cut's name as people see it: its own, or its piece's. */
export function cutName(piece: Piece, cut: Cut): string {
  return cut.name ?? piece.name;
}

/** Where a cut starts, in a few words. */
function whereLabel(g: Garment, cut: Cut): string {
  const p = cut.placement;
  if (p.type === "follow") {
    const on = p.cut ? findCut(g, p.cut) : undefined;
    return on ? `On the ${cutName(on.piece, on.cut)}` : "On another piece";
  }
  const place = placeOf(p);
  return place ? PLACES[place].label : (p.region ?? "Somewhere");
}

export function PiecesPanel(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment | undefined;
  fabrics?: readonly Fabric[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Asks Rust for a fresh wrap of the cut at `place`, then makes it an edit. */
  onRewrap: (cutId: string, place: Place) => void;
  /** Switches to placing in 3D (null when already there). */
  onPlaceIn3d: (() => void) | null;
}) {
  const { store, garment, selection } = props;
  if (!garment) return <Intro>This project has no garment.</Intro>;
  const found = selection ? findCut(garment, selection.cutId) : undefined;
  const seams = garment.seams ?? [];
  return (
    <div className="flex flex-col gap-5">
      {found ? (
        <CutDetails
          {...props}
          garment={garment}
          piece={found.piece}
          cut={found.cut}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Intro>
            Pick a piece to name it and choose where it starts on the body:
            here, in the flat view, or with Select in 3D.
          </Intro>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {garment.pieces.flatMap((piece) =>
              piece.cuts.map((cut) => {
                const cutFabric = cut.fabric
                  ? (props.fabrics?.find((f) => f.id === cut.fabric) ??
                    findPreset(cut.fabric))
                  : undefined;
                return (
                  <li key={cut.id}>
                    <button
                      type="button"
                      onClick={() =>
                        props.onSelect({
                          kind: "cut",
                          pieceId: piece.id,
                          cutId: cut.id,
                        })
                      }
                      className="flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left hover:bg-[#F4F5F2]"
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full border border-black/10"
                          style={{
                            background:
                              cutColor(props.entities, garment, cut) ??
                              DEFAULT_CLOTH_COLOR,
                          }}
                        />
                        {cutName(piece, cut)}
                        {cut.mirrored ? " (mirrored)" : ""}
                      </span>
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[13px]">
                        <span>{whereLabel(garment, cut)}</span>
                        {cutFabric && (
                          <>
                            <span>·</span>
                            <span className="rounded bg-[#E1E4DE] px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                              {cutFabric.name}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      )}
      {seams.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <Heading>Seams</Heading>
          {seams.map((s, i) => (
            <TextField
              key={s.id}
              label={`Seam ${i + 1}`}
              value={s.name ?? ""}
              placeholder="Unnamed"
              onCommit={(v) =>
                store.execute((e) => renameSeam(e, garment.id, s.id, v))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CutDetails(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment;
  piece: Piece;
  cut: Cut;
  fabrics?: readonly Fabric[];
  onSelect: (s: Selection) => void;
  onRewrap: (cutId: string, place: Place) => void;
  onPlaceIn3d: (() => void) | null;
}) {
  const { store, garment: g, piece, cut } = props;
  const p = cut.placement;
  const place = placeOf(p);
  const blocked = followers(g, cut.id);
  const on = g.pieces.flatMap((pc) =>
    pc.cuts
      .filter((c) => !blocked.has(c.id))
      .map((c) => ({ key: c.id, label: cutName(pc, c) })),
  );
  const value =
    p.type === "follow" ? `on:${p.cut}` : place ? `one:${place}` : null;
  const defaultFabric =
    props.fabrics?.find((f) => f.id === g.fabric) ?? findPreset(g.fabric);
  const defaultFabricName = defaultFabric?.name ?? "Garment default";

  /** A slider or box for one number of the wrap. */
  const wrapField = (
    field: "angle" | "top" | "radius" | "rotation",
    v: number,
    dragging: boolean,
  ) => {
    if (dragging) store.beginGesture(`placement:${cut.id}:${field}`);
    store.execute((e) =>
      setPlacement(
        e,
        g.id,
        cut.id,
        tidy({ ...p, [field]: v }),
        undefined,
        `placement:${cut.id}:${field}`,
      ),
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => props.onSelect(null)}
        className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
      >
        All pieces
      </button>
      <TextField
        label="Piece name"
        value={piece.name}
        onCommit={(v) =>
          store.execute((e) => renamePiece(e, g.id, piece.id, v))
        }
      />
      {piece.cuts.length > 1 && (
        <TextField
          label={`This copy (${piece.cuts.indexOf(cut) + 1} of ${piece.cuts.length})`}
          value={cut.name ?? ""}
          placeholder={piece.name}
          onCommit={(v) =>
            store.execute((e) => renameCut(e, g.id, piece.id, cut.id, v))
          }
        />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cut-mirrored" className="text-[15px] font-semibold">
            Mirror image
          </Label>
          <span className="text-muted-foreground text-[13px] leading-snug">
            The other one of a left and right pair.
          </span>
        </div>
        <Switch
          id="cut-mirrored"
          checked={!!cut.mirrored}
          onCheckedChange={(v) =>
            store.execute((e) => setMirrored(e, g.id, cut.id, v))
          }
        />
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <Heading>Fabric</Heading>
        <Select
          value={cut.fabric ?? "default"}
          onValueChange={(val) => {
            const nextId = val === "default" ? undefined : val;
            store.execute((e) => setCutFabric(e, g.id, cut.id, nextId));
          }}
        >
          <SelectTrigger
            aria-label="Piece fabric"
            className="h-11 w-full rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white text-[15px]"
          >
            <SelectValue placeholder="Choose fabric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              Default ({defaultFabricName})
            </SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Presets</SelectLabel>
              {FABRIC_PRESETS.map((pr) => (
                <SelectItem key={pr.id} value={pr.id}>
                  {pr.name} ({pr.category}, {Math.round(pr.density * 1000)}{" "}
                  g/m²)
                </SelectItem>
              ))}
            </SelectGroup>
            {props.fabrics &&
              props.fabrics.some(
                (f) =>
                  f.id !== g.fabric &&
                  !FABRIC_PRESETS.some((pr) => pr.id === f.id),
              ) && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Custom fabrics in project</SelectLabel>
                    {props.fabrics
                      .filter(
                        (f) =>
                          f.id !== g.fabric &&
                          !FABRIC_PRESETS.some((pr) => pr.id === f.id),
                      )
                      .map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </>
              )}
          </SelectContent>
        </Select>
        {piece.cuts.length > 1 && (
          <button
            type="button"
            onClick={() =>
              store.execute((e) =>
                setPieceFabric(e, g.id, piece.id, cut.fabric),
              )
            }
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
          >
            Apply {cut.fabric ? "this fabric" : "default"} to all{" "}
            {piece.cuts.length} cuts of {piece.name}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t pt-4">
        <Heading>Colour</Heading>
        <ColorField
          label={
            piece.cuts.length > 1
              ? `Colour of all ${piece.cuts.length} ${piece.name}`
              : "Piece colour"
          }
          value={pieceColor(props.entities, piece)}
          shown={garmentColor(props.entities, g) ?? DEFAULT_CLOTH_COLOR}
          onPick={pickColor(store, g.id, { kind: "piece", pieceId: piece.id })}
          onDragEnd={() => store.endGesture()}
          onReset={{
            label: "Use the garment colour",
            run: () =>
              pickColor(store, g.id, { kind: "piece", pieceId: piece.id })(
                undefined,
              ),
          }}
        />
      </div>

      <div className="flex flex-col gap-4 border-t pt-4">
        <Heading>Where it starts</Heading>
        <PlaceSelect
          label="Where it starts on the body"
          value={value}
          placeholder={
            p.type === "wrap" ? (p.region ?? "Somewhere") : "On another piece"
          }
          options={{ one: true, pairs: false, on, leave: false }}
          onChange={(v) => {
            if (v.startsWith("one:"))
              props.onRewrap(cut.id, v.slice(4) as Place);
            else if (v.startsWith("on:")) {
              store.execute((e) =>
                setPlacement(e, g.id, cut.id, {
                  type: "follow",
                  cut: v.slice(3),
                  lift: ON_TOP_LIFT_MM,
                }),
              );
            }
          }}
        />
        {p.type === "wrap" ? (
          <>
            <NumberField
              label="Around the body"
              unit="°"
              ends={["Right", "Left"]}
              value={degrees(p.angle ?? 0)}
              min={-180}
              max={180}
              step={1}
              onChange={(v, dragging) =>
                wrapField("angle", radians(v), dragging)
              }
              onDragEnd={() => store.endGesture()}
            />
            <NumberField
              label="Height"
              unit="mm"
              ends={["Lower", "Higher"]}
              value={p.top ?? 0}
              min={Math.min(topRange(p.region)[0], Math.round(p.top ?? 0))}
              max={Math.max(topRange(p.region)[1], Math.round(p.top ?? 0))}
              step={1}
              onChange={(v, dragging) => wrapField("top", v, dragging)}
              onDragEnd={() => store.endGesture()}
            />
            <NumberField
              label="Distance from the body"
              unit="mm"
              ends={["Closer", "Further"]}
              value={p.radius ?? 0}
              min={20}
              max={400}
              step={1}
              onChange={(v, dragging) => wrapField("radius", v, dragging)}
              onDragEnd={() => store.endGesture()}
            />
            <NumberField
              label="Turn"
              unit="°"
              value={degrees(p.rotation ?? 0)}
              min={-180}
              max={180}
              step={1}
              onChange={(v, dragging) =>
                wrapField("rotation", radians(v), dragging)
              }
              onDragEnd={() => store.endGesture()}
            />
            {place && (
              <button
                type="button"
                onClick={() => props.onRewrap(cut.id, place)}
                className="border-input hover:border-foreground h-11 self-start rounded-[10px] border bg-white px-4 text-[15px] font-semibold"
              >
                Fit to the body again
              </button>
            )}
          </>
        ) : (
          <NumberField
            label="Lifted off it"
            unit="mm"
            value={p.lift ?? 0}
            min={0}
            max={60}
            step={1}
            onChange={(v, dragging) => {
              if (dragging) store.beginGesture(`placement:${cut.id}:lift`);
              store.execute((e) =>
                setPlacement(
                  e,
                  g.id,
                  cut.id,
                  { ...p, lift: v },
                  undefined,
                  `placement:${cut.id}:lift`,
                ),
              );
            }}
            onDragEnd={() => store.endGesture()}
          />
        )}
        {props.onPlaceIn3d && (
          <button
            type="button"
            onClick={props.onPlaceIn3d}
            className="border-input hover:border-foreground h-11 self-start rounded-[10px] border bg-white px-4 text-[15px] font-semibold"
          >
            Place it in 3D
          </button>
        )}
      </div>
    </div>
  );
}

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
        <Heading>Simulation</Heading>
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
