// SPDX-License-Identifier: AGPL-3.0-or-later
// The panels the rail opens: what the editor can change today, in plain words. Every change
// goes through a command (document/commands.ts) on the store.

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
import type { Cut, Garment, Piece } from "@/format/schema.gen";
import {
  cutColor,
  cutFabric,
  fabricColor,
  findCut,
  followers,
  renameCut,
  renamePiece,
  renameProject,
  renameSeam,
  selfCollision,
  setMirrored,
  setPieceFabric,
  setPlacement,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from "@/document/commands";
import type { Entities } from "@/document/entities";
import type { DocumentStore } from "@/document/store";
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
import { NumberField, TextField } from "./fields";

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
  selection: Selection;
  /** Opens the Fabric panel on a new fabric for a piece. */
  onNewFabric: (piece: { id: string; name: string }) => void;
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
                const own = cut.fabric
                  ? cutFabric(props.entities, garment, cut)
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
                        {own && (
                          <>
                            <span>·</span>
                            <span className="rounded bg-[#E1E4DE] px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                              {own.name}
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

/** A fabric in a list: its colour and name. */
function FabricOption({
  color,
  name,
}: {
  color: string | undefined;
  name: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-full border border-black/10"
        style={{ background: color ?? DEFAULT_CLOTH_COLOR }}
      />
      {name}
    </span>
  );
}

function CutDetails(props: {
  store: DocumentStore;
  entities: Entities;
  garment: Garment;
  piece: Piece;
  cut: Cut;
  onNewFabric: (piece: { id: string; name: string }) => void;
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
  const fabrics = props.entities.fabrics;
  const garmentFabric = fabrics.find((f) => f.id === g.fabric);

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
        {/* <Heading>Fabric</Heading> */}
        <Select
          value={cut.fabric ?? "garment"}
          onValueChange={(val) => {
            if (val === "new")
              return props.onNewFabric({ id: piece.id, name: piece.name });
            const next = val === "garment" ? undefined : val;
            // A piece's copies (left and right) stay in one fabric.
            store.execute((e) => setPieceFabric(e, g.id, piece.id, next));
          }}
        >
          <SelectTrigger
            aria-label="Piece fabric"
            className="h-11 w-full rounded-[10px] border-[1.5px] border-[#D5D9D1] bg-white text-[15px]"
          >
            <SelectValue placeholder="Choose fabric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="garment">
              <FabricOption
                color={
                  garmentFabric && fabricColor(props.entities, garmentFabric)
                }
                name={`Garment's (${garmentFabric?.name ?? "default"})`}
              />
            </SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Fabrics in this project</SelectLabel>
              {fabrics
                .filter((f) => f.id !== g.fabric)
                .map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    <FabricOption
                      color={fabricColor(props.entities, f)}
                      name={f.name}
                    />
                  </SelectItem>
                ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="new">New fabric…</SelectItem>
          </SelectContent>
        </Select>
        {piece.cuts.some((c) => c.fabric !== cut.fabric) && (
          <button
            type="button"
            onClick={() =>
              store.execute((e) =>
                setPieceFabric(e, g.id, piece.id, cut.fabric),
              )
            }
            className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-4"
          >
            The copies of {piece.name} differ: give all of them this one
          </button>
        )}
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
