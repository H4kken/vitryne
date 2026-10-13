// SPDX-License-Identifier: AGPL-3.0-or-later
// What the M6 editor edits: names and labels, the fabric, the simulation settings. Every
// change goes through a command (document/commands.ts) on the store.

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
import { mainGarment } from '@/document/entities';
import type { DocState, DocumentStore } from '@/document/store';
import type { Selection } from '@/pattern/PatternPanel';
import { NumberField, TextField } from './fields';

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b px-4 py-4 last:border-b-0">
      <h2 className="text-xs font-semibold tracking-wide uppercase">{props.title}</h2>
      {props.children}
    </section>
  );
}

const FABRIC_UI: { field: FabricField; label: string; unit: string; scale?: number; min: number; max: number; log?: boolean }[] = [
  { field: 'density', label: 'Weight', unit: 'g/m²', scale: 1000, min: 30, max: 600 },
  { field: 'stretchWarp', label: 'Stretch stiffness, warp', unit: 'N/m', min: 100, max: 1e6, log: true },
  { field: 'stretchWeft', label: 'Stretch stiffness, weft', unit: 'N/m', min: 100, max: 1e6, log: true },
  { field: 'stretchShear', label: 'Shear stiffness', unit: 'N/m', min: 10, max: 1e6, log: true },
  { field: 'bendingWarp', label: 'Bending stiffness, warp', unit: 'µN·m', scale: 1e6, min: 0.1, max: 1000, log: true },
  { field: 'bendingWeft', label: 'Bending stiffness, weft', unit: 'µN·m', scale: 1e6, min: 0.1, max: 1000, log: true },
  { field: 'friction', label: 'Friction on the body', unit: '', min: 0, max: 1.5 },
];

function FabricSection({ store, fabric }: { store: DocumentStore; fabric: Fabric }) {
  return (
    <Section title="Fabric">
      <TextField label="Name" value={fabric.name} onCommit={(v) => store.execute((e) => renameFabric(e, fabric.id, v))} />
      <p className="text-muted-foreground text-xs">
        {fabric.category}
        {fabric.notes ? ` · ${fabric.notes}` : ''}
      </p>
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
    </Section>
  );
}

function PieceSection({ store, garment, pieceId }: { store: DocumentStore; garment: Garment; pieceId: string }) {
  const piece = garment.pieces.find((p) => p.id === pieceId);
  if (!piece) return null;
  return (
    <Section title="Piece">
      <TextField label="Name" value={piece.name} onCommit={(v) => store.execute((e) => renamePiece(e, garment.id, piece.id, v))} />
      {piece.cuts.map((c, i) => (
        <TextField
          key={c.id}
          label={`Cut ${i + 1}${c.mirrored ? ' (mirrored)' : ''}`}
          value={c.name ?? ''}
          placeholder={piece.name}
          onCommit={(v) => store.execute((e) => renameCut(e, garment.id, piece.id, c.id, v))}
        />
      ))}
    </Section>
  );
}

function SeamsSection({ store, garment }: { store: DocumentStore; garment: Garment }) {
  const seams = garment.seams ?? [];
  if (!seams.length) return null;
  return (
    <Section title={`Seams (${seams.length})`}>
      {seams.map((s, i) => (
        <TextField
          key={s.id}
          label={`Seam ${i + 1}`}
          value={s.name ?? ''}
          placeholder="Unnamed"
          onCommit={(v) => store.execute((e) => renameSeam(e, garment.id, s.id, v))}
        />
      ))}
    </Section>
  );
}

export function PropertiesPanel(props: { store: DocumentStore; doc: DocState; selection: Selection }) {
  const { store, doc, selection } = props;
  const e = doc.entities;
  if (doc.empty) return <div className="text-muted-foreground p-4 text-sm">Nothing open.</div>;
  const garment = mainGarment(e);
  const fabric = garment ? e.fabrics.find((f) => f.id === garment.fabric) : e.fabrics[0];
  return (
    <div className="h-full overflow-y-auto">
      {selection?.kind === 'piece' && garment && <PieceSection store={store} garment={garment} pieceId={selection.id} />}
      {e.project && (
        <Section title="Project">
          <TextField label="Name" value={e.project.name ?? ''} onCommit={(v) => store.execute((x) => renameProject(x, v))} />
        </Section>
      )}
      {fabric && <FabricSection store={store} fabric={fabric} />}
      {e.project && (
        <Section title="Simulation">
          <NumberField
            label="Mesh resolution"
            unit="vertices"
            value={targetVertices(e)}
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
          <div className="flex items-center justify-between">
            <Label htmlFor="self-collision" className="text-muted-foreground text-xs">
              Self-collision (cloth against itself)
            </Label>
            <Switch id="self-collision" checked={selfCollision(e)} onCheckedChange={(on) => store.execute((x) => setSelfCollision(x, on))} />
          </div>
        </Section>
      )}
      {garment && <SeamsSection store={store} garment={garment} />}
    </div>
  );
}
