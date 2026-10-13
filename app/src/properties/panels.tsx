// SPDX-License-Identifier: AGPL-3.0-or-later
// The panels the rail opens: what the editor can change today, in plain words. Every change
// goes through a command (document/commands.ts) on the store.

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Fabric, Garment } from '@/format/schema.gen';
import {
  type FabricField,
  fabricValue,
  renameCut,
  renameFabric,
  renamePiece,
  renameProject,
  renameSeam,
  selfCollision,
  setFabricValue,
  setSelfCollision,
  setTargetVertices,
  targetVertices,
} from '@/document/commands';
import type { Entities } from '@/document/entities';
import type { DocumentStore } from '@/document/store';
import type { Selection } from '@/pattern/PatternPanel';
import { NumberField, TextField } from './fields';

export type PanelId = 'fabric' | 'pieces' | 'settings';

export const PANEL_TITLES: Record<PanelId, string> = { fabric: 'Fabric', pieces: 'Pieces', settings: 'Settings' };

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground m-0 text-sm leading-snug">{children}</p>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted-foreground m-0 text-[13px] font-semibold tracking-[0.06em] uppercase">{children}</h3>;
}

const FABRIC_UI: { field: FabricField; label: string; unit: string; ends: [string, string]; scale?: number; min: number; max: number; log?: boolean }[] = [
  { field: 'density', label: 'Weight', unit: 'g/m²', ends: ['Light', 'Heavy'], scale: 1000, min: 30, max: 600 },
  { field: 'stretchWarp', label: 'Stretch along the grain', unit: 'N/m', ends: ['Stretchy', 'Firm'], min: 100, max: 1e6, log: true },
  { field: 'stretchWeft', label: 'Stretch across the grain', unit: 'N/m', ends: ['Stretchy', 'Firm'], min: 100, max: 1e6, log: true },
  { field: 'stretchShear', label: 'Give on the bias', unit: 'N/m', ends: ['Soft', 'Firm'], min: 10, max: 1e6, log: true },
  { field: 'bendingWarp', label: 'Stiffness along the grain', unit: 'µN·m', ends: ['Drapey', 'Stiff'], scale: 1e6, min: 0.1, max: 1000, log: true },
  { field: 'bendingWeft', label: 'Stiffness across the grain', unit: 'µN·m', ends: ['Drapey', 'Stiff'], scale: 1e6, min: 0.1, max: 1000, log: true },
  { field: 'friction', label: 'Grip on the body', unit: '', ends: ['Slides', 'Grips'], min: 0, max: 1.5 },
];

export function FabricPanel({ store, fabric }: { store: DocumentStore; fabric: Fabric | undefined }) {
  if (!fabric) return <Intro>This garment has no fabric.</Intro>;
  return (
    <div className="flex flex-col gap-5">
      <Intro>Changes how it hangs, folds and stretches. Move a slider and watch it settle.</Intro>
      <TextField label="Name" value={fabric.name} onCommit={(v) => store.execute((e) => renameFabric(e, fabric.id, v))} />
      {FABRIC_UI.map((f) => (
        <NumberField
          key={f.field}
          {...f}
          value={fabricValue(fabric, f.field)}
          onChange={(v, dragging) => {
            if (dragging) store.beginGesture(`fabric:${fabric.id}:${f.field}`);
            store.execute((e) => setFabricValue(e, fabric.id, f.field, v));
          }}
          onDragEnd={() => store.endGesture()}
        />
      ))}
      {fabric.notes && (
        <details className="text-muted-foreground text-[13px] leading-snug">
          <summary className="text-foreground cursor-pointer font-semibold">About these values</summary>
          <p className="mt-1.5 mb-0">{fabric.notes}</p>
        </details>
      )}
    </div>
  );
}

export function PiecesPanel(props: { store: DocumentStore; garment: Garment | undefined; selection: Selection; onShowFlat: (() => void) | null }) {
  const { store, garment, selection } = props;
  if (!garment) return <Intro>This project has no garment.</Intro>;
  const piece = selection ? garment.pieces.find((p) => p.id === selection.id) : undefined;
  const seams = garment.seams ?? [];
  return (
    <div className="flex flex-col gap-5">
      {piece ? (
        <div className="flex flex-col gap-4">
          <TextField label="Piece name" value={piece.name} onCommit={(v) => store.execute((e) => renamePiece(e, garment.id, piece.id, v))} />
          {piece.cuts.length > 1 &&
            piece.cuts.map((c, i) => (
              <TextField
                key={c.id}
                label={`Copy ${i + 1}${c.mirrored ? ' (mirrored)' : ''}`}
                value={c.name ?? ''}
                placeholder={piece.name}
                onCommit={(v) => store.execute((e) => renameCut(e, garment.id, piece.id, c.id, v))}
              />
            ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Intro>Pick a piece in the flat view to rename it.</Intro>
          {props.onShowFlat && (
            <button
              type="button"
              onClick={props.onShowFlat}
              className="border-input hover:border-foreground h-11 self-start rounded-[10px] border bg-white px-4 text-[15px] font-semibold"
            >
              Show flat pieces
            </button>
          )}
        </div>
      )}
      {seams.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <Heading>Seams</Heading>
          {seams.map((s, i) => (
            <TextField
              key={s.id}
              label={`Seam ${i + 1}`}
              value={s.name ?? ''}
              placeholder="Unnamed"
              onCommit={(v) => store.execute((e) => renameSeam(e, garment.id, s.id, v))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({ store, entities }: { store: DocumentStore; entities: Entities }) {
  if (!entities.project) return null;
  return (
    <div className="flex flex-col gap-5">
      <TextField label="Project name" value={entities.project.name ?? ''} onCommit={(v) => store.execute((x) => renameProject(x, v))} />
      <div className="flex flex-col gap-5 border-t pt-4">
        <Heading>Simulation</Heading>
        <NumberField
          label="Detail"
          unit="points"
          ends={['Faster', 'Finer']}
          value={targetVertices(entities)}
          min={1000}
          max={40_000}
          step={500}
          integer
          onChange={(v, dragging) => {
            if (dragging) store.beginGesture('simulation:targetVertices');
            store.execute((x) => setTargetVertices(x, v));
          }}
          onDragEnd={() => store.endGesture()}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="self-collision" className="text-[15px] font-semibold">
              Cloth against itself
            </Label>
            <span className="text-muted-foreground text-[13px] leading-snug">Layers can't pass through each other. Slower.</span>
          </div>
          <Switch id="self-collision" checked={selfCollision(entities)} onCheckedChange={(on) => store.execute((x) => setSelfCollision(x, on))} />
        </div>
      </div>
    </div>
  );
}
